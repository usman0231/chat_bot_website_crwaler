"""Auth dependencies.

Two authentication schemes coexist; both ultimately resolve to a ``User``:

  * ``X-API-Key: sb_…`` — the user's own per-user widget/API key
  * ``Authorization: Bearer <jwt>`` — a browser session token

``require_auth_either`` accepts either, looks up the user, stashes
``request.state.user_id`` on the request, and returns the resolved User.
The X-API-Key path is cached briefly (TTL 60s) so the widget's
high-frequency calls don't slam SQLite.

A small legacy fallback: if ``X-API-Key`` matches ``settings.demo_api_key``
exactly (the pre-multi-user shared key), we accept it as anonymous
"admin/system" access. Useful while migrating widget installs.
"""

from __future__ import annotations

import threading
import time
from typing import Any

from fastapi import Header, HTTPException, Request

from api import auth_db
from api.jwt_utils import decode_token
from core.config import settings

_API_KEY_TTL_SECONDS = 60.0

_cache_lock = threading.Lock()
_api_key_cache: dict[str, tuple[float, auth_db.User | None]] = {}


def _cached_user_for_key(key: str) -> auth_db.User | None:
    now = time.monotonic()
    with _cache_lock:
        hit = _api_key_cache.get(key)
        if hit is not None:
            expires_at, user = hit
            if expires_at > now:
                return user
    user = auth_db.get_user_by_api_key(key)
    with _cache_lock:
        _api_key_cache[key] = (now + _API_KEY_TTL_SECONDS, user)
        # Cheap bound to avoid unbounded growth in pathological scenarios.
        if len(_api_key_cache) > 1024:
            _api_key_cache.clear()
    return user


def invalidate_api_key_cache(*keys: str) -> None:
    """Drop cached entries — used after rotate/update to avoid serving stale state."""
    with _cache_lock:
        if not keys:
            _api_key_cache.clear()
            return
        for k in keys:
            _api_key_cache.pop(k, None)


def _parse_bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip() or None


def _user_from_jwt(authorization: str | None) -> auth_db.User | None:
    token = _parse_bearer(authorization)
    if not token:
        return None
    payload: dict[str, Any] | None = decode_token(token)
    if not payload:
        raise HTTPException(401, "Invalid or expired token")
    user_id = payload.get("sub")
    if not isinstance(user_id, str):
        raise HTTPException(401, "Invalid token payload")
    user = auth_db.get_user_by_id(user_id)
    if user is None:
        raise HTTPException(401, "User no longer exists")
    return user


def require_user(
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> auth_db.User:
    """Decode a Bearer JWT and resolve to a User. 401 on any failure."""
    user = _user_from_jwt(authorization)
    if user is None:
        raise HTTPException(401, "Missing bearer token")
    return user


def require_auth_either(
    request: Request,
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> auth_db.User | None:
    """Accept either a Bearer JWT or per-user X-API-Key.

    Returns the resolved User. The only case where ``None`` is returned is
    the legacy shared-key fallback (X-API-Key matches DEMO_API_KEY) — that
    path is kept so the original widget installation can still talk to
    shared bots while the new per-user keys roll out.
    """
    user = _user_from_jwt(authorization)
    if user is not None:
        request.state.user_id = user.id
        return user

    if x_api_key:
        cached = _cached_user_for_key(x_api_key)
        if cached is not None:
            request.state.user_id = cached.id
            return cached
        if settings.demo_api_key and x_api_key == settings.demo_api_key:
            # Legacy admin/widget access — no associated user.
            request.state.user_id = None
            return None

    raise HTTPException(401, "Authentication required")
