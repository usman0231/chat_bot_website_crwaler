"""Tests for the FastAPI bot endpoints."""

import os
import time

os.environ.setdefault("DEMO_API_KEY", "test-key")

import pytest


@pytest.fixture
def client(tmp_path, monkeypatch):
    from core.config import settings

    monkeypatch.setattr(settings, "chroma_path", str(tmp_path / "chroma"))
    monkeypatch.setattr(settings, "bots_registry_path", str(tmp_path / "bots.json"))
    monkeypatch.setattr(settings, "demo_api_key", "test-key")

    async def fake_crawl(url, max_pages, progress_callback=None):
        if progress_callback is not None:
            progress_callback(0, 2)
            progress_callback(1, 2)
            progress_callback(2, 2)
        return [
            {"url": "http://t/a", "title": "A", "text": "a" * 200},
            {"url": "http://t/b", "title": "B", "text": "b" * 200},
        ]

    def fake_ingest(bot_id, pages, phase_callback=None):
        if phase_callback is not None:
            phase_callback("indexing")
        return {"bot_id": bot_id, "pages": 2, "chunks": 4}

    from ingest import crawler, pipeline

    monkeypatch.setattr(crawler, "crawl", fake_crawl)
    monkeypatch.setattr(pipeline, "ingest_website", fake_ingest)

    from fastapi.testclient import TestClient

    from api import main as api_main

    api_main._bot_cache.clear()
    return TestClient(api_main.app)


HEADERS = {"X-API-Key": "test-key"}
PAYLOAD = {"website_url": "https://example.com", "website_name": "Example"}


def _wait_for_status(client, bot_id, target, timeout=5.0):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        r = client.get(f"/bot/{bot_id}/status", headers=HEADERS)
        if r.status_code == 200:
            last = r.json()
            if last["status"] == target:
                return last
        time.sleep(0.1)
    return last


def test_unauthorized_returns_401(client):
    r = client.post("/bot/create", json=PAYLOAD)
    assert r.status_code == 401


def test_create_returns_training(client):
    r = client.post("/bot/create", json=PAYLOAD, headers=HEADERS)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "training"
    assert body["bot_id"].startswith("bot_")
    assert body["website_name"] == "Example"


def test_status_eventually_ready(client):
    bot_id = client.post("/bot/create", json=PAYLOAD, headers=HEADERS).json()["bot_id"]
    final = _wait_for_status(client, bot_id, "ready")
    assert final is not None
    assert final["status"] == "ready"
    assert final["pages"] == 2
    assert final["chunks"] == 4


def test_chat_before_ready_returns_409(client):
    # Seed a registry entry directly in 'training' state. (TestClient runs
    # BackgroundTasks synchronously, so we can't catch the in-flight window
    # via /bot/create.)
    from api import registry

    bot_id = "bot_inflight01"
    registry.update_bot(
        bot_id,
        website_url="https://example.com",
        website_name="Example",
        status="training",
        pages=None,
        chunks=None,
        error=None,
    )
    r = client.post(f"/bot/{bot_id}/chat", json={"message": "hi"}, headers=HEADERS)
    assert r.status_code == 409
    assert "not ready" in r.json()["detail"]


def test_chat_404_for_unknown_bot(client):
    r = client.post(
        "/bot/bot_doesnotexist/chat", json={"message": "hi"}, headers=HEADERS
    )
    assert r.status_code == 404


def test_create_validation(client):
    r = client.post(
        "/bot/create", json={"website_url": "https://x.com"}, headers=HEADERS
    )
    assert r.status_code == 422


def test_create_then_status_progresses_stage(client):
    bot_id = client.post("/bot/create", json=PAYLOAD, headers=HEADERS).json()["bot_id"]
    final = _wait_for_status(client, bot_id, "ready")
    assert final is not None
    # Fields exposed by the new schema:
    assert "stage" in final
    assert "pages_crawled" in final
    assert "pages_total" in final
    assert "elapsed_seconds" in final
    # The fake crawl reports progress for 2 pages, then we ingest, then "done".
    assert final["stage"] == "done"
    assert final["pages_crawled"] == 2
    assert final["pages_total"] == 2
    assert final["elapsed_seconds"] is not None
    assert final["elapsed_seconds"] >= 0


def test_list_bots_requires_key(client):
    r = client.get("/bots")
    assert r.status_code == 401


def test_list_bots_returns_list(client):
    # Empty to start
    r = client.get("/bots", headers=HEADERS)
    assert r.status_code == 200
    assert r.json() == {"bots": []}

    # Create one and confirm it appears with the expected fields
    bot_id = client.post("/bot/create", json=PAYLOAD, headers=HEADERS).json()["bot_id"]
    r = client.get("/bots", headers=HEADERS)
    assert r.status_code == 200
    body = r.json()
    assert "bots" in body and isinstance(body["bots"], list)
    match = next((b for b in body["bots"] if b["bot_id"] == bot_id), None)
    assert match is not None
    assert match["website_url"].startswith("https://example.com")
    assert match["website_name"] == "Example"
    assert match["status"] in ("training", "ready")
    assert match["created_at"] is not None


def test_delete_bot_removes_from_registry(client):
    bot_id = client.post("/bot/create", json=PAYLOAD, headers=HEADERS).json()["bot_id"]
    assert _wait_for_status(client, bot_id, "ready") is not None

    r = client.delete(f"/bot/{bot_id}", headers=HEADERS)
    assert r.status_code == 200
    body = r.json()
    assert body == {"bot_id": bot_id, "deleted": True}

    # Subsequent status lookup should 404
    r = client.get(f"/bot/{bot_id}/status", headers=HEADERS)
    assert r.status_code == 404

    # Registry should no longer contain the bot
    from api import registry

    assert bot_id not in registry.load_registry()


def test_delete_bot_unknown_returns_404(client):
    r = client.delete("/bot/bot_nope/", headers=HEADERS)
    # FastAPI rejects trailing slash mismatch, so use the canonical path
    r = client.delete("/bot/bot_nope", headers=HEADERS)
    assert r.status_code == 404


def test_get_sources_returns_grouped_pages(client, monkeypatch):
    bot_id = client.post("/bot/create", json=PAYLOAD, headers=HEADERS).json()["bot_id"]
    assert _wait_for_status(client, bot_id, "ready") is not None

    # Stub out chromadb to return controlled metadatas
    class FakeCollection:
        def peek(self, limit=1000):
            return {
                "metadatas": [
                    {"url": "http://t/a", "title": "Page A", "chunk_index": 0},
                    {"url": "http://t/a", "title": "Page A", "chunk_index": 1},
                    {"url": "http://t/b", "title": "Page B", "chunk_index": 0},
                ]
            }

    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        def get_collection(self, name):
            return FakeCollection()

    import chromadb

    monkeypatch.setattr(chromadb, "PersistentClient", FakeClient)

    r = client.get(f"/bot/{bot_id}/sources", headers=HEADERS)
    assert r.status_code == 200
    body = r.json()
    assert body["bot_id"] == bot_id
    sources = body["sources"]
    assert len(sources) == 2
    by_url = {s["url"]: s for s in sources}
    assert by_url["http://t/a"]["chunk_count"] == 2
    assert by_url["http://t/a"]["title"] == "Page A"
    assert by_url["http://t/b"]["chunk_count"] == 1


def test_get_sources_requires_key(client):
    r = client.get("/bot/anything/sources")
    assert r.status_code == 401


def test_recrawl_resets_status_to_training(client):
    bot_id = client.post("/bot/create", json=PAYLOAD, headers=HEADERS).json()["bot_id"]
    final = _wait_for_status(client, bot_id, "ready")
    assert final is not None and final["status"] == "ready"

    # Prime the cache so we can confirm it gets evicted
    from api import main as api_main

    api_main._bot_cache[bot_id] = object()

    r = client.post(f"/bot/{bot_id}/recrawl", headers=HEADERS)
    assert r.status_code == 200
    body = r.json()
    assert body == {"bot_id": bot_id, "status": "training"}
    assert bot_id not in api_main._bot_cache

    # Re-crawl reuses fake_crawl + fake_ingest, so we should reach "ready" again
    final2 = _wait_for_status(client, bot_id, "ready")
    assert final2 is not None
    assert final2["pages"] == 2


def test_recrawl_unknown_bot_returns_404(client):
    r = client.post("/bot/bot_doesnotexist/recrawl", headers=HEADERS)
    assert r.status_code == 404


def test_chat_success_with_mocked_bot(client, monkeypatch):
    bot_id = client.post("/bot/create", json=PAYLOAD, headers=HEADERS).json()["bot_id"]
    assert _wait_for_status(client, bot_id, "ready") is not None

    from core import llm

    monkeypatch.setattr(llm, "ping", lambda: True)

    class FakeBot:
        def __init__(self, *a, **kw):
            pass

        def answer(self, q, *, history=None):
            return {
                "answer": "fixed",
                "sources": ["http://t/a"],
                "in_scope": True,
                "retrieved_count": 1,
                "best_distance": 0.1,
                "match_quality": "strong",
            }

    from core import rag

    monkeypatch.setattr(rag, "WebsiteBot", FakeBot)

    from api import main as api_main

    api_main._bot_cache.clear()

    r = client.post(f"/bot/{bot_id}/chat", json={"message": "hello"}, headers=HEADERS)
    assert r.status_code == 200
    body = r.json()
    assert body == {
        "answer": "fixed",
        "sources": ["http://t/a"],
        "in_scope": True,
        "match_quality": "strong",
    }
