"""
Async website crawler — Playwright-backed for SPA-rendered content.

Public API:
    crawl(root_url: str, max_pages: int) -> list[dict]   # [{url,title,text}]

Robots.txt and sitemap.xml are still fetched via httpx (they're static XML).
HTML pages are fetched through a single headless Chromium browser so JS
rendering completes before we extract text. Pagination links (?page=2,
/page/2/, "Next", "Load more" buttons) are discovered per-page and merged
into the crawl queue.

CLI:
    python -m ingest.crawler <url> [--max N]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import re
import sys
from collections import deque
from pathlib import Path
from typing import Callable, Iterable
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse
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


# --------------------------------------------------------------------------
# URL normalisation + pagination detection
# --------------------------------------------------------------------------

# Tracking params that shouldn't influence dedup (same content, different
# attribution noise). Stripping them prevents crawling the same page twice
# via different campaign links.
_TRACKING_PARAMS = frozenset(
    {
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "utm_id",
        "fbclid",
        "gclid",
        "mc_cid",
        "mc_eid",
        "ref",
        "source",
        "_ga",
        "_gl",
        "yclid",
    }
)


_PAGINATION_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p, re.IGNORECASE)
    for p in (
        r"[?&]page=\d+",
        r"[?&]p=\d+",
        r"[?&]pg=\d+",
        r"/page/\d+/?$",
        r"/p/\d+/?$",
        r"[?&]offset=\d+",
        r"[?&]start=\d+",
    )
)


def is_pagination_url(url: str) -> bool:
    """True if the URL looks like a paginated variant (page=2, /page/2/, etc.)."""
    if not url:
        return False
    return any(p.search(url) for p in _PAGINATION_PATTERNS)


def normalize_url(url: str) -> str:
    """Aggressive normaliser:
    * drops fragment (#section)
    * strips tracking params (utm_*, fbclid, gclid, ref, source, …)
    * strips trailing slash (but never the bare "https://host/")
    Returns an empty string on unparseable input.
    """
    if not url:
        return ""
    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        return ""

    params = [
        (k, v)
        for k, v in parse_qsl(parsed.query, keep_blank_values=True)
        if k.lower() not in _TRACKING_PARAMS
    ]
    cleaned = parsed._replace(
        query=urlencode(params, doseq=True),
        fragment="",
    )
    out = urlunparse(cleaned)

    # Preserve a trailing slash on the bare-host case so "https://x.com" and
    # "https://x.com/" don't accidentally become identical pre-strip and then
    # invalid post-strip.
    if cleaned.path in ("", "/"):
        if not cleaned.path:
            out = urlunparse(cleaned._replace(path="/"))
    elif out.endswith("/"):
        out = out.rstrip("/")
    return out


# Back-compat alias — older code paths called this ``_normalize``.
_normalize = normalize_url


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


def _extract_links(html: str, base_url: str) -> list[str]:
    soup = BeautifulSoup(html, "lxml")
    out = []
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith(("mailto:", "javascript:", "tel:")):
            continue
        absolute = urljoin(base_url, href)
        norm = normalize_url(absolute)
        if norm and urlparse(norm).scheme in ("http", "https"):
            out.append(norm)
    return out


# --------------------------------------------------------------------------
# robots / sitemap
# --------------------------------------------------------------------------


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


# --------------------------------------------------------------------------
# Per-page fetch with Playwright (handles "Load more" + pagination links)
# --------------------------------------------------------------------------

# Selectors are Playwright-extended CSS — `:has-text(...)` is theirs, not W3C.
_NEXT_PAGE_SELECTORS: tuple[str, ...] = (
    'a[rel="next"]',
    'a:has-text("Next")',
    'a:has-text("›")',
    'a:has-text("»")',
    ".pagination a.next",
    ".next-page",
    '[aria-label="Next page"]',
    '[aria-label="Next"]',
)

_LOAD_MORE_SELECTORS: tuple[str, ...] = (
    'button:has-text("Load more")',
    'button:has-text("Show more")',
    'a:has-text("Load more")',
    'a:has-text("Show more")',
    '[data-testid="load-more"]',
)

# Cap on consecutive "Load more" clicks per page so a broken/infinite-scroll
# site can't pin one Playwright tab forever.
_MAX_LOAD_MORE_CLICKS = 5


async def _try_load_more(page, current_url: str) -> None:
    """Click visible 'Load more' / 'Show more' buttons up to a small cap.

    Returns once no further button is found or the cap is hit. Failures
    (selector errors, navigation aborts) are swallowed — the worst outcome
    is that we miss the extra content, not that we break the crawl.
    """
    for click_no in range(_MAX_LOAD_MORE_CLICKS):
        clicked = False
        for selector in _LOAD_MORE_SELECTORS:
            try:
                element = await page.query_selector(selector)
            except Exception:
                element = None
            if element is None:
                continue
            try:
                is_visible = await element.is_visible()
            except Exception:
                is_visible = False
            if not is_visible:
                continue
            log.info(
                "Clicking 'Load more' on %s (round %d)", current_url, click_no + 1
            )
            try:
                await element.click()
                await page.wait_for_load_state("networkidle", timeout=8000)
                clicked = True
                break
            except Exception as e:
                log.debug("load-more click failed: %s", e)
        if not clicked:
            return


async def _collect_pagination_links(page, base_url: str) -> list[str]:
    """Pull next/pagination URLs out of the rendered DOM."""
    found: list[str] = []

    # 1. Explicit "next" selectors.
    for selector in _NEXT_PAGE_SELECTORS:
        try:
            element = await page.query_selector(selector)
        except Exception:
            element = None
        if element is None:
            continue
        try:
            href = await element.get_attribute("href")
        except Exception:
            href = None
        if not href:
            continue
        absolute = urljoin(base_url, href)
        norm = normalize_url(absolute)
        if norm:
            log.info("Found pagination link (next): %s", norm)
            found.append(norm)

    # 2. Any <a> whose href looks like a pagination variant.
    try:
        anchors = await page.query_selector_all("a[href]")
    except Exception:
        anchors = []
    for anchor in anchors:
        try:
            href = await anchor.get_attribute("href")
        except Exception:
            href = None
        if not href:
            continue
        absolute = urljoin(base_url, href)
        if is_pagination_url(absolute):
            norm = normalize_url(absolute)
            if norm and norm not in found:
                log.info("Found pagination link: %s", norm)
                found.append(norm)

    return found


async def _fetch_rendered(context, url: str) -> tuple[str | None, list[str]]:
    """Open a fresh page, click any "Load more" controls, then return the
    final HTML plus a list of discovered pagination URLs.

    Returns ``(None, [])`` on hard navigation failures so callers can skip
    the URL without losing the pagination side channel.
    """
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
                return None, []

        try:
            await _try_load_more(page, url)
        except Exception as e:
            log.debug("_try_load_more raised on %s: %s", url, e)

        try:
            pagination_links = await _collect_pagination_links(page, url)
        except Exception as e:
            log.debug("_collect_pagination_links raised on %s: %s", url, e)
            pagination_links = []

        try:
            html = await page.content()
        except Exception as e:
            log.warning("content() failed for %s: %s", url, e)
            return None, pagination_links

        return html, pagination_links
    finally:
        try:
            await page.close()
        except Exception:
            pass


ProgressCallback = Callable[[int, int], None]


async def crawl(
    root_url: str,
    max_pages: int,
    progress_callback: ProgressCallback | None = None,
) -> list[dict]:
    """Crawl `root_url` (same domain only), up to `max_pages`. Returns list of {url,title,text}.

    If `progress_callback` is given, it is called as `callback(pages_crawled, pages_total)`
    after each page is successfully fetched. `pages_total` is the best known upper bound:
    the seed count from the sitemap (capped at `max_pages`) if we have one, otherwise
    `max_pages` itself.
    """
    from playwright.async_api import async_playwright

    def _report(crawled: int, total: int) -> None:
        if progress_callback is None:
            return
        try:
            progress_callback(crawled, total)
        except Exception:
            log.debug("progress_callback raised; ignoring", exc_info=True)

    root_url = normalize_url(root_url)
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

        queue: deque[str] = deque(
            normalize_url(u) for u in seed_urls if normalize_url(u)
        )
        seen: set[str] = set()
        results: list[dict] = []
        sem = asyncio.Semaphore(settings.crawl_concurrency)

        pages_total = min(max_pages, len(queue)) if len(queue) > 1 else max_pages
        _report(0, pages_total)

        playwright = await async_playwright().start()
        browser = None
        try:
            browser = await playwright.chromium.launch(headless=True)
            context = await browser.new_context(user_agent=_USER_AGENT)

            async def fetch_one(u: str) -> tuple[str, str | None, list[str]]:
                async with sem:
                    html, pagination_links = await _fetch_rendered(context, u)
                return u, html, pagination_links

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
                for url, html, pagination_links in fetched:
                    # Pagination links discovered while loading the page —
                    # surface them even on pages that failed to extract.
                    for link in pagination_links:
                        if (
                            link
                            and link not in seen
                            and same_domain(link, root_url)
                            and allowed(link)
                        ):
                            queue.append(link)

                    if html is None:
                        continue
                    title, text = extract_title_and_text(html)
                    results.append({"url": url, "title": title, "text": text})
                    pages_total = max(pages_total, len(results))
                    pages_total = min(
                        max_pages,
                        max(pages_total, len(results) + len(queue)),
                    )
                    _report(len(results), pages_total)
                    if len(results) >= max_pages:
                        break
                    for link in _extract_links(html, url):
                        if (
                            link not in seen
                            and same_domain(link, root_url)
                            and allowed(link)
                        ):
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
