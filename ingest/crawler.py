"""
Async website crawler — Playwright-backed for SPA-rendered content.

Public API:
    crawl(root_url: str, max_pages: int) -> list[dict]   # [{url,title,text}]

Robots.txt and sitemap.xml are still fetched via httpx (they're static XML).
HTML pages are fetched through a single headless Chromium browser so JS
rendering completes before we extract text.

CLI:
    python -m ingest.crawler <url> [--max N]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from collections import deque
from pathlib import Path
from typing import Iterable
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser
from xml.etree import ElementTree as ET

import httpx
import tldextract
from bs4 import BeautifulSoup

from core.config import settings

log = logging.getLogger(__name__)

_STRIP_TAGS = ("script", "style", "nav", "footer", "header", "aside")
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)
_BLOCKED_RESOURCE_RE = (
    "**/*.{png,jpg,jpeg,gif,svg,webp,ico,woff,woff2,ttf,otf,eot,mp4,webm,mp3}"
)


def _registered_domain(url: str) -> str:
    ext = tldextract.extract(url)
    return ext.top_domain_under_public_suffix.lower()


def same_domain(url_a: str, url_b: str) -> bool:
    a = _registered_domain(url_a)
    b = _registered_domain(url_b)
    return bool(a) and a == b


def extract_title_and_text(html: str) -> tuple[str, str]:
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(_STRIP_TAGS):
        tag.decompose()
    title = (soup.title.string.strip() if soup.title and soup.title.string else "")
    text = " ".join(soup.get_text(separator=" ").split())
    return title, text


def _normalize(url: str) -> str:
    p = urlparse(url)
    if not p.scheme or not p.netloc:
        return ""
    return p._replace(fragment="").geturl()


def _extract_links(html: str, base_url: str) -> list[str]:
    soup = BeautifulSoup(html, "lxml")
    out = []
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith(("mailto:", "javascript:", "tel:")):
            continue
        absolute = urljoin(base_url, href)
        norm = _normalize(absolute)
        if norm and urlparse(norm).scheme in ("http", "https"):
            out.append(norm)
    return out


async def _load_robots(client: httpx.AsyncClient, root_url: str) -> RobotFileParser:
    rp = RobotFileParser()
    parsed = urlparse(root_url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    rp.set_url(robots_url)
    try:
        r = await client.get(robots_url)
        if r.status_code == 200:
            rp.parse(r.text.splitlines())
        else:
            rp.parse([])
    except httpx.HTTPError:
        rp.parse([])
    return rp


async def _try_sitemap(client: httpx.AsyncClient, root_url: str) -> list[str]:
    parsed = urlparse(root_url)
    sitemap_url = f"{parsed.scheme}://{parsed.netloc}/sitemap.xml"
    try:
        r = await client.get(sitemap_url)
        if r.status_code != 200 or not r.text.strip():
            return []
        return _parse_sitemap(r.text)
    except (httpx.HTTPError, ET.ParseError):
        return []


def _parse_sitemap(xml_text: str) -> list[str]:
    urls: list[str] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return urls
    for elem in root.iter():
        tag = elem.tag.split("}", 1)[-1]
        if tag == "loc" and elem.text:
            urls.append(elem.text.strip())
    return urls


def deduplicate(pages: Iterable[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for p in pages:
        u = p.get("url")
        if u and u not in seen:
            seen.add(u)
            out.append(p)
    return out


async def _fetch_rendered(context, url: str) -> str | None:
    """Open a fresh page in the shared context, return rendered HTML or None."""
    timeout_ms = settings.browser_timeout * 1000
    page = await context.new_page()
    try:
        await page.route(_BLOCKED_RESOURCE_RE, lambda route: route.abort())
        try:
            await page.goto(url, wait_until="networkidle", timeout=timeout_ms)
        except Exception as e:
            log.warning("networkidle failed for %s (%s); retrying domcontentloaded", url, e)
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            except Exception as e2:
                log.warning("skipping %s after retry failure: %s", url, e2)
                return None
        try:
            return await page.content()
        except Exception as e:
            log.warning("content() failed for %s: %s", url, e)
            return None
    finally:
        try:
            await page.close()
        except Exception:
            pass


async def crawl(root_url: str, max_pages: int) -> list[dict]:
    """Crawl `root_url` (same domain only), up to `max_pages`. Returns list of {url,title,text}."""
    from playwright.async_api import async_playwright

    root_url = _normalize(root_url)
    if not root_url:
        return []

    timeout = httpx.Timeout(settings.http_timeout)
    headers = {"User-Agent": _USER_AGENT}

    async with httpx.AsyncClient(
        follow_redirects=True, timeout=timeout, headers=headers
    ) as http_client:
        rp = await _load_robots(http_client, root_url)

        def allowed(u: str) -> bool:
            try:
                return rp.can_fetch(_USER_AGENT, u)
            except Exception:
                return True

        seeded = await _try_sitemap(http_client, root_url)
        seed_urls = [u for u in seeded if same_domain(u, root_url) and allowed(u)]
        if not seed_urls:
            seed_urls = [root_url]

        queue: deque[str] = deque(_normalize(u) for u in seed_urls if _normalize(u))
        seen: set[str] = set()
        results: list[dict] = []
        sem = asyncio.Semaphore(settings.crawl_concurrency)

        playwright = await async_playwright().start()
        browser = None
        try:
            browser = await playwright.chromium.launch(headless=True)
            context = await browser.new_context(user_agent=_USER_AGENT)

            async def fetch_one(u: str) -> tuple[str, str | None]:
                async with sem:
                    html = await _fetch_rendered(context, u)
                return u, html

            while queue and len(results) < max_pages:
                batch: list[str] = []
                while (
                    queue
                    and len(batch) < settings.crawl_concurrency
                    and len(results) + len(batch) < max_pages
                ):
                    u = queue.popleft()
                    if u in seen or not allowed(u) or not same_domain(u, root_url):
                        continue
                    seen.add(u)
                    batch.append(u)
                if not batch:
                    continue

                fetched = await asyncio.gather(*(fetch_one(u) for u in batch))
                for url, html in fetched:
                    if html is None:
                        continue
                    title, text = extract_title_and_text(html)
                    results.append({"url": url, "title": title, "text": text})
                    if len(results) >= max_pages:
                        break
                    for link in _extract_links(html, url):
                        if link not in seen and same_domain(link, root_url):
                            queue.append(link)
        finally:
            if browser is not None:
                try:
                    await browser.close()
                except Exception:
                    pass
            try:
                await playwright.stop()
            except Exception:
                pass

        return deduplicate(results)


def _cli(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="ingest.crawler", description="Crawl a website.")
    parser.add_argument("url", help="Root URL to crawl")
    parser.add_argument("--max", type=int, default=settings.max_pages, help="Max pages")
    args = parser.parse_args(argv)

    pages = asyncio.run(crawl(args.url, args.max))
    domain = _registered_domain(args.url) or urlparse(args.url).netloc or "site"
    out_dir = Path("data/crawled")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{domain}.json"
    out_path.write_text(json.dumps(pages, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Crawled {len(pages)} pages -> {out_path}")
    return 0


def main() -> None:
    sys.exit(_cli(sys.argv[1:]))


if __name__ == "__main__":
    main()
