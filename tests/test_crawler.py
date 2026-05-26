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

    async def wait_for_load_state(self, _state, timeout=None):
        return None

    async def query_selector(self, _selector):
        return None

    async def query_selector_all(self, _selector):
        return []

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
    """The Playwright wrapper should return whatever rendered HTML the page yields,
    plus a (possibly empty) list of discovered pagination URLs."""
    from ingest.crawler import _fetch_rendered, extract_title_and_text

    html = "<html><head><title>JS Loaded</title></head><body><main><p>SPA content.</p></main></body></html>"
    ctx = _FakeContext(html)

    html_out, pagination_links = await _fetch_rendered(ctx, "https://x.com/a")
    assert html_out == html
    assert pagination_links == []
    assert ctx.opened == 1

    title, text = extract_title_and_text(html_out)
    assert title == "JS Loaded"
    assert "SPA content." in text


def test_normalize_url_strips_tracking_params():
    from ingest.crawler import normalize_url

    assert (
        normalize_url("https://x.com/p?id=42&utm_source=newsletter&fbclid=abc")
        == "https://x.com/p?id=42"
    )
    assert (
        normalize_url("https://x.com/blog/post/?ref=twitter#section")
        == "https://x.com/blog/post"
    )
    assert normalize_url("https://x.com/") == "https://x.com/"


def test_is_pagination_url():
    from ingest.crawler import is_pagination_url

    assert is_pagination_url("https://x.com/blog?page=2")
    assert is_pagination_url("https://x.com/blog?p=4")
    assert is_pagination_url("https://x.com/blog/page/3/")
    assert is_pagination_url("https://x.com/shop?offset=20")
    assert not is_pagination_url("https://x.com/blog/post-1")
    assert not is_pagination_url("https://x.com/about")


@pytest.mark.integration
async def test_crawl_real_browser_smoke():
    """Hits a real site through Playwright. Run with: pytest -m integration"""
    from ingest.crawler import crawl

    pages = await crawl("https://example.com", max_pages=1)
    assert pages
    assert "Example Domain" in pages[0]["text"]
