"""API key auth dependency."""

from fastapi import Header, HTTPException

from core.config import settings


def require_api_key(x_api_key: str | None = Header(default=None, alias="X-API-Key")) -> None:
    if not x_api_key or x_api_key != settings.demo_api_key:
        raise HTTPException(401, "Invalid API key")
