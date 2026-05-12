"""
Sanity tests for Day 1 setup.

Run with: `pytest -q`

These don't require Ollama to be running — they only check that the
project imports, config loads, and the FastAPI app starts. The LLM
integration is exercised manually with a real Ollama instance later.
"""


def test_imports():
    """All packages importable."""
    import api  # noqa: F401
    import core  # noqa: F401
    import ingest  # noqa: F401


def test_config_loads(monkeypatch):
    """Settings should load using defaults + the one required value."""
    monkeypatch.setenv("DEMO_API_KEY", "test-key")

    # Re-import to pick up patched env
    import importlib

    from core import config

    importlib.reload(config)

    assert config.settings.demo_api_key == "test-key"
    assert config.settings.llm_base_url.startswith("http")
    assert config.settings.llm_model  # non-empty string
    assert config.settings.top_k >= 1
    assert 0 <= config.settings.max_distance <= 2


def test_health_endpoint(monkeypatch):
    """FastAPI app starts and /health responds."""
    monkeypatch.setenv("DEMO_API_KEY", "test-key")

    import importlib

    from core import config

    importlib.reload(config)

    from fastapi.testclient import TestClient

    from api import main as api_main

    importlib.reload(api_main)
    client = TestClient(api_main.app)

    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "healthy"}


def test_root_endpoint_shows_model(monkeypatch):
    """Root should report the configured model name (sanity for ops)."""
    monkeypatch.setenv("DEMO_API_KEY", "test-key")
    monkeypatch.setenv("LLM_MODEL", "qwen2.5:7b")

    import importlib

    from core import config

    importlib.reload(config)

    from fastapi.testclient import TestClient

    from api import main as api_main

    importlib.reload(api_main)
    client = TestClient(api_main.app)

    body = client.get("/").json()
    assert body["model"] == "qwen2.5:7b"
    assert body["status"] == "ok"
