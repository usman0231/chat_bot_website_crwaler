"""Tests for ingest.crawler."""

import os

os.environ.setdefault("DEMO_API_KEY", "test-key")

import pytest

from ingest.crawler import deduplicate, extract_title_and_text, same_domain


def test_same_domain_matching():
    assert same_domain("https://example.com/a", "https://example.com/b")
    assert same_domain("https://blog.example.com/x", "https://example.com/y")
    assert not same_domain("https://example.com/", "https://other.org/")


def test_extract_strips_navigation_tags():
    html = """
    <html><head><title>Hello</title></head>
    <body>
      <header>HEADER_TEXT</header>
      <nav>NAV_TEXT</nav>
      <script>alert('x')</script>
      <style>.a{}</style>
      <main><p>Real content here.</p></main>
      <aside>ASIDE_TEXT</aside>
      <footer>FOOTER_TEXT</footer>
    </body></html>
    """
    title, text = extract_title_and_text(html)
    assert title == "Hello"
    assert "Real content here." in text
    for junk in ("HEADER_TEXT", "NAV_TEXT", "ASIDE_TEXT", "FOOTER_TEXT", "alert"):
        assert junk not in text


def test_deduplicate_removes_duplicate_urls():
    pages = [
        {"url": "https://x.com/a", "title": "A", "text": "1"},
        {"url": "https://x.com/b", "title": "B", "text": "2"},
        {"url": "https://x.com/a", "title": "A2", "text": "1again"},
    ]
    out = deduplicate(pages)
    assert [p["url"] for p in out] == ["https://x.com/a", "https://x.com/b"]
    assert out[0]["title"] == "A"  # first occurrence kept


class _FakePage:
    def __init__(self, html):
        self._html = html

    async def route(self, _pattern, _handler):
        return None

    async def goto(self, _url, wait_until=None, timeout=None):
        return None

    async def content(self):
        return self._html

    async def close(self):
        return None


class _FakeContext:
    def __init__(self, html):
        self._html = html
        self.opened = 0

    async def new_page(self):
        self.opened += 1
        return _FakePage(self._html)


async def test_fetch_rendered_returns_extractable_html():
    """The Playwright wrapper should return whatever rendered HTML the page yields."""
    from ingest.crawler import _fetch_rendered, extract_title_and_text

    html = "<html><head><title>JS Loaded</title></head><body><main><p>SPA content.</p></main></body></html>"
    ctx = _FakeContext(html)

    out = await _fetch_rendered(ctx, "https://x.com/a")
    assert out == html
    assert ctx.opened == 1

    title, text = extract_title_and_text(out)
    assert title == "JS Loaded"
    assert "SPA content." in text


@pytest.mark.integration
async def test_crawl_real_browser_smoke():
    """Hits a real site through Playwright. Run with: pytest -m integration"""
    from ingest.crawler import crawl

    pages = await crawl("https://example.com", max_pages=1)
    assert pages
    assert "Example Domain" in pages[0]["text"]
