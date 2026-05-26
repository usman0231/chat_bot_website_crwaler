"""Tests for /auth/* endpoints and JWT-scoped bot access."""

import os

os.environ.setdefault("DEMO_API_KEY", "test-key")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-please-rotate")

import pytest


@pytest.fixture
def client(tmp_path, monkeypatch):
    from core.config import settings

    monkeypatch.setattr(settings, "chroma_path", str(tmp_path / "chroma"))
    monkeypatch.setattr(settings, "bots_registry_path", str(tmp_path / "bots.json"))
    monkeypatch.setattr(settings, "auth_db_path", str(tmp_path / "auth.db"))
    monkeypatch.setattr(settings, "demo_api_key", "test-key")
    monkeypatch.setattr(settings, "jwt_secret", "test-jwt-secret-please-rotate")

    # Force re-init of the auth_db module's cached state.
    from api import auth_db

    monkeypatch.setattr(auth_db, "_initialised", False)

    async def fake_crawl(url, max_pages, progress_callback=None):
        if progress_callback is not None:
            progress_callback(0, 1)
            progress_callback(1, 1)
        return [{"url": "http://t/a", "title": "A", "text": "a" * 200}]

    def fake_ingest(bot_id, pages, phase_callback=None):
        if phase_callback is not None:
            phase_callback("indexing")
        return {"bot_id": bot_id, "pages": 1, "chunks": 2}

    from ingest import crawler, pipeline

    monkeypatch.setattr(crawler, "crawl", fake_crawl)
    monkeypatch.setattr(pipeline, "ingest_website", fake_ingest)

    from fastapi.testclient import TestClient

    from api import main as api_main

    api_main._bot_cache.clear()
    return TestClient(api_main.app)


SIGNUP_A = {
    "email": "alice@example.com",
    "password": "alice-secret-1",
    "name": "Alice",
}
SIGNUP_B = {
    "email": "bob@example.com",
    "password": "bob-secret-1",
    "name": "Bob",
}


def _signup(client, payload):
    r = client.post("/auth/signup", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------- signup ----------


def test_signup_returns_token(client):
    body = _signup(client, SIGNUP_A)
    assert "token" in body and isinstance(body["token"], str) and body["token"]
    assert body["user"]["email"] == "alice@example.com"
    assert body["user"]["name"] == "Alice"
    assert body["user"]["id"].startswith("usr_")


def test_signup_duplicate_email_409(client):
    _signup(client, SIGNUP_A)
    r = client.post("/auth/signup", json=SIGNUP_A)
    assert r.status_code == 409
    assert "already" in r.json()["detail"].lower()


def test_signup_validates_password_length(client):
    r = client.post(
        "/auth/signup",
        json={"email": "x@y.com", "password": "short", "name": "X"},
    )
    assert r.status_code == 422


def test_signup_validates_email_format(client):
    r = client.post(
        "/auth/signup",
        json={"email": "not-an-email", "password": "longenough1", "name": "X"},
    )
    assert r.status_code == 422


# ---------- login ----------


def test_login_correct_password(client):
    _signup(client, SIGNUP_A)
    r = client.post(
        "/auth/login",
        json={"email": SIGNUP_A["email"], "password": SIGNUP_A["password"]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["token"]
    assert body["user"]["email"] == "alice@example.com"


def test_login_wrong_password_401(client):
    _signup(client, SIGNUP_A)
    r = client.post(
        "/auth/login",
        json={"email": SIGNUP_A["email"], "password": "wrong-pass-1"},
    )
    assert r.status_code == 401
    assert r.json()["detail"] == "Invalid email or password"


def test_login_nonexistent_email_401(client):
    r = client.post(
        "/auth/login",
        json={"email": "noone@example.com", "password": "whatever-1"},
    )
    assert r.status_code == 401
    assert r.json()["detail"] == "Invalid email or password"


# ---------- /auth/me ----------


def test_me_returns_user(client):
    body = _signup(client, SIGNUP_A)
    r = client.get("/auth/me", headers=_bearer(body["token"]))
    assert r.status_code == 200
    me = r.json()
    assert me["email"] == "alice@example.com"
    assert me["name"] == "Alice"
    assert me["id"] == body["user"]["id"]


def test_me_invalid_token_401(client):
    r = client.get("/auth/me", headers=_bearer("not-a-real-token"))
    assert r.status_code == 401


def test_me_missing_token_401(client):
    r = client.get("/auth/me")
    assert r.status_code == 401


# ---------- /auth/api-key ----------


def test_api_key_requires_auth(client):
    r = client.get("/auth/api-key")
    assert r.status_code == 401


def test_api_key_returns_value(client):
    body = _signup(client, SIGNUP_A)
    r = client.get("/auth/api-key", headers=_bearer(body["token"]))
    assert r.status_code == 200
    payload = r.json()
    # Each user now gets their own per-user API key, generated on signup.
    assert payload["api_key"].startswith("sb_")
    assert payload["masked"].startswith("sb_")
    assert payload["masked"].endswith(payload["api_key"][-4:])


# ---------- per-user bot isolation ----------


def test_user_only_sees_own_bots(client):
    # Seed a shared (no user_id) bot directly in the registry.
    from api import registry

    registry.update_bot(
        "bot_shared001",
        website_url="https://visionara.test/",
        website_name="visionara",
        status="ready",
        pages=1,
        chunks=2,
        created_at="2026-01-01T00:00:00+00:00",
    )

    a = _signup(client, SIGNUP_A)
    b = _signup(client, SIGNUP_B)

    # User A creates a bot.
    r = client.post(
        "/bot/create",
        json={"website_url": "https://a.example.com", "website_name": "A site"},
        headers=_bearer(a["token"]),
    )
    assert r.status_code == 200, r.text
    a_bot_id = r.json()["bot_id"]

    # User B's /bots: should include the shared bot but NOT A's bot.
    r = client.get("/bots", headers=_bearer(b["token"]))
    assert r.status_code == 200
    ids = {b["bot_id"] for b in r.json()["bots"]}
    assert "bot_shared001" in ids
    assert a_bot_id not in ids

    # User A's /bots: should include both their bot and the shared bot.
    r = client.get("/bots", headers=_bearer(a["token"]))
    assert r.status_code == 200
    ids = {b["bot_id"] for b in r.json()["bots"]}
    assert a_bot_id in ids
    assert "bot_shared001" in ids


def test_user_b_cannot_access_user_a_bot(client):
    a = _signup(client, SIGNUP_A)
    b = _signup(client, SIGNUP_B)

    r = client.post(
        "/bot/create",
        json={"website_url": "https://a.example.com", "website_name": "A site"},
        headers=_bearer(a["token"]),
    )
    a_bot_id = r.json()["bot_id"]

    r = client.get(f"/bot/{a_bot_id}/status", headers=_bearer(b["token"]))
    assert r.status_code == 403

    r = client.delete(f"/bot/{a_bot_id}", headers=_bearer(b["token"]))
    assert r.status_code == 403


def test_api_key_caller_sees_all_bots(client):
    a = _signup(client, SIGNUP_A)
    r = client.post(
        "/bot/create",
        json={"website_url": "https://a.example.com", "website_name": "A site"},
        headers=_bearer(a["token"]),
    )
    a_bot_id = r.json()["bot_id"]

    # Admin/widget access via X-API-Key — should see A's bot too.
    r = client.get("/bots", headers={"X-API-Key": "test-key"})
    assert r.status_code == 200
    ids = {b["bot_id"] for b in r.json()["bots"]}
    assert a_bot_id in ids


# ---------- per-user API keys ----------


def test_signup_generates_api_key(client):
    body = _signup(client, SIGNUP_A)
    r = client.get("/auth/me", headers=_bearer(body["token"]))
    assert r.status_code == 200
    me = r.json()
    assert me["api_key"].startswith("sb_")
    assert len(me["api_key"]) > 10


def test_api_key_grants_access_to_own_bots(client):
    body = _signup(client, SIGNUP_A)
    me = client.get("/auth/me", headers=_bearer(body["token"])).json()
    api_key = me["api_key"]

    # Create a bot via JWT
    r = client.post(
        "/bot/create",
        json={"website_url": "https://a.example.com", "website_name": "A"},
        headers=_bearer(body["token"]),
    )
    bot_id = r.json()["bot_id"]

    # The per-user API key should grant access to that bot's status.
    r = client.get(f"/bot/{bot_id}/status", headers={"X-API-Key": api_key})
    assert r.status_code == 200


def test_old_key_rejected_after_rotate(client):
    body = _signup(client, SIGNUP_A)
    me = client.get("/auth/me", headers=_bearer(body["token"])).json()
    old_key = me["api_key"]

    # Confirm the old key works.
    r = client.get("/bots", headers={"X-API-Key": old_key})
    assert r.status_code == 200

    # Rotate.
    r = client.post("/auth/api-key/rotate", headers=_bearer(body["token"]))
    assert r.status_code == 200
    new_key = r.json()["api_key"]
    assert new_key != old_key
    assert new_key.startswith("sb_")

    # Old key must immediately stop working.
    r = client.get("/bots", headers={"X-API-Key": old_key})
    assert r.status_code == 401

    # New key works.
    r = client.get("/bots", headers={"X-API-Key": new_key})
    assert r.status_code == 200


# ---------- tier limits ----------


def test_free_user_bot_limit_enforced(client):
    body = _signup(client, SIGNUP_A)
    r = client.post(
        "/bot/create",
        json={"website_url": "https://a.example.com", "website_name": "A"},
        headers=_bearer(body["token"]),
    )
    assert r.status_code == 200

    r = client.post(
        "/bot/create",
        json={"website_url": "https://b.example.com", "website_name": "B"},
        headers=_bearer(body["token"]),
    )
    assert r.status_code == 403
    assert "free" in r.json()["detail"].lower()


def test_pro_user_can_create_more_bots(client):
    from api import auth_db

    body = _signup(client, SIGNUP_A)
    user_id = body["user"]["id"]
    auth_db.apply_subscription_update(user_id, tier="pro")
    for i in range(3):
        r = client.post(
            "/bot/create",
            json={
                "website_url": f"https://{i}.example.com",
                "website_name": f"site-{i}",
            },
            headers=_bearer(body["token"]),
        )
        assert r.status_code == 200, r.text


def test_message_quota_enforced(client, monkeypatch):
    from api import auth_db
    from core import llm, rag

    monkeypatch.setattr(llm, "ping", lambda: True)

    class FakeBot:
        def __init__(self, *a, **kw):
            pass

        def answer(self, q, *, history=None):
            return {
                "answer": "ok",
                "sources": [],
                "in_scope": True,
                "retrieved_count": 0,
                "best_distance": 0.0,
                "match_quality": "strong",
            }

    monkeypatch.setattr(rag, "WebsiteBot", FakeBot)

    body = _signup(client, SIGNUP_A)
    user_id = body["user"]["id"]

    # Create a bot and wait for it to reach "ready".
    r = client.post(
        "/bot/create",
        json={"website_url": "https://a.example.com", "website_name": "A"},
        headers=_bearer(body["token"]),
    )
    bot_id = r.json()["bot_id"]

    import time as _time

    deadline = _time.time() + 5
    while _time.time() < deadline:
        s = client.get(
            f"/bot/{bot_id}/status", headers=_bearer(body["token"])
        ).json()
        if s["status"] == "ready":
            break
        _time.sleep(0.05)

    # Pretend the user is right at the limit.
    from api.tiers import limits_for

    limit = limits_for("free")["monthly_messages"]
    with auth_db._connect() as conn:
        conn.execute(
            "UPDATE users SET messages_this_month = ?, messages_month_reset = ?"
            " WHERE id = ?",
            (limit, auth_db._current_month_key(), user_id),
        )
        conn.commit()

    r = client.post(
        f"/bot/{bot_id}/chat",
        json={"message": "hi"},
        headers=_bearer(body["token"]),
    )
    assert r.status_code == 429
    assert "limit" in r.json()["detail"].lower()


def test_me_reports_usage_and_tier(client):
    body = _signup(client, SIGNUP_A)
    r = client.get("/auth/me", headers=_bearer(body["token"]))
    assert r.status_code == 200
    me = r.json()
    assert me["tier"] == "free"
    assert me["subscription_status"] == "active"
    assert me["usage"]["max_bots"] == 1
    assert me["usage"]["max_pages_per_bot"] == 25
    assert me["usage"]["monthly_messages"] == 100
    assert me["usage"]["bots"] == 0


# ---------- Stripe ----------


def test_create_payment_intent_returns_client_secret(client, monkeypatch):
    from core.config import settings

    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_dummy")
    monkeypatch.setattr(settings, "stripe_publishable_key", "pk_test_dummy")
    monkeypatch.setattr(settings, "stripe_price_pro", "price_test_pro")

    captured: dict = {}

    class FakeCustomer:
        @staticmethod
        def create(**kw):
            captured["customer_kw"] = kw
            return type("C", (), {"id": "cus_test_123"})()

    class FakeIntent:
        client_secret = "pi_test_secret_xyz"

    class FakeInvoice:
        payment_intent = FakeIntent()
        amount_due = 2900
        currency = "usd"

    class FakeSubscription:
        id = "sub_test_001"
        latest_invoice = FakeInvoice()

        @staticmethod
        def create(**kw):
            captured["sub_kw"] = kw
            return FakeSubscription()

    import stripe as _stripe

    monkeypatch.setattr(_stripe, "Customer", FakeCustomer)
    monkeypatch.setattr(_stripe, "Subscription", FakeSubscription)

    body = _signup(client, SIGNUP_A)
    r = client.post(
        "/stripe/payment/create-intent",
        json={"tier": "pro"},
        headers=_bearer(body["token"]),
    )
    assert r.status_code == 200, r.text
    payload = r.json()
    assert payload["client_secret"] == "pi_test_secret_xyz"
    assert payload["subscription_id"] == "sub_test_001"
    assert payload["publishable_key"] == "pk_test_dummy"
    assert payload["tier"] == "pro"
    assert payload["amount"] == 2900
    assert payload["currency"] == "usd"

    assert captured["customer_kw"]["email"] == "alice@example.com"
    sub_kw = captured["sub_kw"]
    assert sub_kw["items"][0]["price"] == "price_test_pro"
    assert sub_kw["payment_behavior"] == "default_incomplete"
    assert sub_kw["metadata"]["user_id"] == body["user"]["id"]
    assert sub_kw["metadata"]["tier"] == "pro"

    from api import auth_db

    user = auth_db.get_user_by_id(body["user"]["id"])
    assert user is not None
    assert user.stripe_customer_id == "cus_test_123"


def test_payment_confirm_activates_tier(client, monkeypatch):
    from core.config import settings

    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_dummy")

    body = _signup(client, SIGNUP_A)
    user_id = body["user"]["id"]

    # Pretend the customer was already created during create-intent.
    from api import auth_db

    auth_db.set_stripe_customer(user_id, "cus_test_xyz")

    class FakeMetadata:
        def get(self, key, default=None):
            return {"user_id": user_id, "tier": "pro"}.get(key, default)

    class FakeSubscription:
        id = "sub_active_001"
        status = "active"
        customer = "cus_test_xyz"
        metadata = FakeMetadata()

        @staticmethod
        def retrieve(_sub_id):
            return FakeSubscription()

    import stripe as _stripe

    monkeypatch.setattr(_stripe, "Subscription", FakeSubscription)

    r = client.post(
        "/stripe/payment/confirm",
        json={"subscription_id": "sub_active_001"},
        headers=_bearer(body["token"]),
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"tier": "pro", "status": "active"}

    user = auth_db.get_user_by_id(user_id)
    assert user is not None
    assert user.tier == "pro"
    assert user.stripe_subscription_id == "sub_active_001"


def test_payment_confirm_keeps_free_when_incomplete(client, monkeypatch):
    from core.config import settings

    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_dummy")

    body = _signup(client, SIGNUP_A)
    user_id = body["user"]["id"]
    from api import auth_db

    auth_db.set_stripe_customer(user_id, "cus_test_xyz")

    class FakeMetadata:
        def get(self, key, default=None):
            return {"user_id": user_id, "tier": "pro"}.get(key, default)

    class FakeSubscription:
        id = "sub_pending_002"
        status = "incomplete"
        customer = "cus_test_xyz"
        metadata = FakeMetadata()

        @staticmethod
        def retrieve(_sub_id):
            return FakeSubscription()

    import stripe as _stripe

    monkeypatch.setattr(_stripe, "Subscription", FakeSubscription)

    r = client.post(
        "/stripe/payment/confirm",
        json={"subscription_id": "sub_pending_002"},
        headers=_bearer(body["token"]),
    )
    assert r.status_code == 200, r.text
    # Tier doesn't flip until status is active.
    assert r.json()["tier"] == "free"
    assert r.json()["status"] == "incomplete"


def test_webhook_updates_tier(client):
    from api import auth_db
    from api.stripe_endpoints import handle_event

    body = _signup(client, SIGNUP_A)
    user_id = body["user"]["id"]

    event = {
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "metadata": {"user_id": user_id, "tier": "pro"},
                "subscription": "sub_test_001",
            }
        },
    }
    handle_event(event)
    user = auth_db.get_user_by_id(user_id)
    assert user is not None
    assert user.tier == "pro"
    assert user.stripe_subscription_id == "sub_test_001"
    assert user.subscription_status == "active"

    # Cancellation drops back to free.
    handle_event(
        {
            "type": "customer.subscription.deleted",
            "data": {"object": {"metadata": {"user_id": user_id}}},
        }
    )
    user = auth_db.get_user_by_id(user_id)
    assert user is not None
    assert user.tier == "free"
    assert user.stripe_subscription_id is None
    assert user.subscription_status == "canceled"


def test_webhook_subscription_updated_to_active_sets_tier(client):
    """The Elements flow doesn't fire checkout.session.completed — the
    durable signal is subscription.updated transitioning to 'active'."""
    from api import auth_db
    from api.stripe_endpoints import handle_event

    body = _signup(client, SIGNUP_A)
    user_id = body["user"]["id"]

    handle_event(
        {
            "type": "customer.subscription.updated",
            "data": {
                "object": {
                    "id": "sub_elements_001",
                    "status": "active",
                    "metadata": {"user_id": user_id, "tier": "pro"},
                }
            },
        }
    )
    user = auth_db.get_user_by_id(user_id)
    assert user is not None
    assert user.tier == "pro"
    assert user.stripe_subscription_id == "sub_elements_001"
    assert user.subscription_status == "active"
