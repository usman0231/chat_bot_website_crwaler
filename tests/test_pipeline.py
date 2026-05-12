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

    pages = [
        {"url": "https://x.com/short", "title": "Short", "text": "tiny"},
        {"url": "https://x.com/empty", "title": "Empty", "text": ""},
        {"url": "https://x.com/ok", "title": "OK", "text": "x" * 600},
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

    smaller = [{"url": "https://x.com/only", "title": "Only", "text": "y" * 600}]
    result = ingest_website("reset-bot", smaller)
    second_count = client.get_collection("reset-bot").count()
    assert second_count == result["chunks"]
    assert second_count < first_count
