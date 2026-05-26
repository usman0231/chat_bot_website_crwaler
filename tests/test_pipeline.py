"""Tests for ingest.pipeline."""

import os

os.environ.setdefault("DEMO_API_KEY", "test-key")

import chromadb
import pytest


@pytest.fixture(autouse=True)
def isolate_chroma(tmp_path, monkeypatch):
    from core.config import settings

    monkeypatch.setattr(settings, "chroma_path", str(tmp_path / "chroma"))
    yield


def _sample_pages():
    long_text = (
        "Visionara builds custom AI assistants for websites. "
        "It crawls site content, embeds it, and answers questions strictly from that content. "
    ) * 5
    return [
        {"url": "https://x.com/a", "title": "Page A", "text": long_text},
        {"url": "https://x.com/b", "title": "Page B", "text": long_text + " Second page."},
    ]


def test_chunks_have_metadata():
    from core.config import settings
    from ingest.pipeline import ingest_website

    pages = _sample_pages()
    result = ingest_website("test-bot", pages)
    assert result["pages"] == 2
    assert result["chunks"] >= 2

    client = chromadb.PersistentClient(path=str(settings.chroma_dir))
    coll = client.get_collection("test-bot")
    got = coll.get(include=["metadatas"])
    assert len(got["ids"]) == result["chunks"]
    for meta in got["metadatas"]:
        assert meta["url"].startswith("https://")
        assert meta["title"] in ("Page A", "Page B")
        assert "chunk_index" in meta
        assert "page_index" in meta


def test_short_pages_skipped():
    from ingest.pipeline import ingest_website

    realistic = (
        "Our team specialises in building web applications, mobile apps, and "
        "AI-powered chatbots for small businesses. Get in touch for a quote. "
    ) * 5
    pages = [
        {"url": "https://x.com/short", "title": "Short", "text": "tiny"},
        {"url": "https://x.com/empty", "title": "Empty", "text": ""},
        {"url": "https://x.com/ok", "title": "OK", "text": realistic},
    ]
    result = ingest_website("test-bot-2", pages)
    assert result["pages"] == 1
    assert result["chunks"] >= 1


def test_collection_reset():
    from core.config import settings
    from ingest.pipeline import ingest_website

    ingest_website("reset-bot", _sample_pages())
    client = chromadb.PersistentClient(path=str(settings.chroma_dir))
    first_count = client.get_collection("reset-bot").count()
    assert first_count > 0

    smaller = [
        {
            "url": "https://x.com/only",
            "title": "Only",
            "text": (
                "We offer a 30-day money-back guarantee on all plans. "
                "Cancel at any time directly from your billing portal. "
            )
            * 6,
        }
    ]
    result = ingest_website("reset-bot", smaller)
    second_count = client.get_collection("reset-bot").count()
    assert second_count == result["chunks"]
    assert second_count < first_count


def test_low_quality_chunks_filtered():
    from ingest.pipeline import _is_low_quality_chunk

    # Real content keeps.
    assert not _is_low_quality_chunk(
        "Visionara builds custom AI assistants for websites. "
        "It crawls site content, embeds it, and answers questions "
        "strictly from that website's text. Contact us for a quote."
    )

    # Junk drops.
    assert _is_low_quality_chunk("Loading...")
    assert _is_low_quality_chunk("Lorem ipsum dolor sit amet")
    assert _is_low_quality_chunk("Price: $X — coming soon")
    assert _is_low_quality_chunk("{{price}} per month — sign up today")
    assert _is_low_quality_chunk("x" * 200)  # one unique char
    assert _is_low_quality_chunk("123 456 789 012 345 678 901 234")  # numeric


def test_extract_prices_finds_currency_strings():
    from ingest.pipeline import _extract_prices

    text = "Pro plan is $29/month, Enterprise is $99.00, ENT €120 /mo."
    prices = _extract_prices(text)
    assert "$29" in prices
    assert "$99.00" in prices
    assert "€120" in prices
