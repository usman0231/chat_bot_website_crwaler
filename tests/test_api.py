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

    async def fake_crawl(url, max_pages):
        return [
            {"url": "http://t/a", "title": "A", "text": "a" * 200},
            {"url": "http://t/b", "title": "B", "text": "b" * 200},
        ]

    def fake_ingest(bot_id, pages):
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


def test_chat_success_with_mocked_bot(client, monkeypatch):
    bot_id = client.post("/bot/create", json=PAYLOAD, headers=HEADERS).json()["bot_id"]
    assert _wait_for_status(client, bot_id, "ready") is not None

    from core import llm

    monkeypatch.setattr(llm, "ping", lambda: True)

    class FakeBot:
        def __init__(self, *a, **kw):
            pass

        def answer(self, q):
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
