"""HS256 JWT helpers for user sessions."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import jwt

from core.config import settings

_ALGORITHM = "HS256"
_TOKEN_TTL = timedelta(days=7)


def create_token(user_id: str) -> str:
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": user_id,
        "iat": int(now.timestamp()),
        "exp": int((now + _TOKEN_TTL).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=_ALGORITHM)


def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[_ALGORITHM])
    except jwt.PyJWTError:
        return None
