"""User signup/login/me + per-user API key reveal and rotation."""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from api import auth, auth_db, registry
from api.jwt_utils import create_token
from api.tiers import limits_for

router = APIRouter(prefix="/auth", tags=["auth"])

_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def _validate_email(v: str) -> str:
    v = v.strip().lower()
    if not _EMAIL_RE.match(v):
        raise ValueError("Invalid email format")
    if len(v) > 254:
        raise ValueError("Email too long")
    return v


class SignupRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=8, max_length=200)
    name: str = Field(..., min_length=1, max_length=50)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        return _validate_email(v)


class LoginRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=1, max_length=200)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        return _validate_email(v)


class PublicUser(BaseModel):
    id: str
    email: str
    name: str


class TierUsage(BaseModel):
    bots: int
    max_bots: int
    max_pages_per_bot: int
    messages_this_month: int
    monthly_messages: int


class MeResponse(BaseModel):
    id: str
    email: str
    name: str
    api_key: str
    tier: str
    subscription_status: str
    usage: TierUsage


class AuthResponse(BaseModel):
    token: str
    user: PublicUser


class ApiKeyResponse(BaseModel):
    api_key: str
    masked: str


def _public_user(user: auth_db.User) -> PublicUser:
    return PublicUser(id=user.id, email=user.email, name=user.name)


def _mask_key(key: str) -> str:
    if not key:
        return "sb_••••"
    last4 = key[-4:] if len(key) >= 4 else key
    return f"sb_••••••••••••{last4}"


def _count_user_bots(user_id: str) -> int:
    reg = registry.load_registry()
    return sum(1 for entry in reg.values() if entry.get("user_id") == user_id)


def _me_payload(user: auth_db.User) -> MeResponse:
    auth_db.reset_monthly_counter_if_needed(user.id)
    fresh = auth_db.get_user_by_id(user.id) or user
    limits = limits_for(fresh.tier)
    return MeResponse(
        id=fresh.id,
        email=fresh.email,
        name=fresh.name,
        api_key=fresh.api_key,
        tier=fresh.tier,
        subscription_status=fresh.subscription_status,
        usage=TierUsage(
            bots=_count_user_bots(fresh.id),
            max_bots=limits["max_bots"],
            max_pages_per_bot=limits["max_pages_per_bot"],
            messages_this_month=fresh.messages_this_month,
            monthly_messages=limits["monthly_messages"],
        ),
    )


@router.post("/signup", response_model=AuthResponse)
def signup(req: SignupRequest) -> AuthResponse:
    try:
        user = auth_db.create_user(req.email, req.password, req.name)
    except auth_db.EmailAlreadyRegisteredError as e:
        raise HTTPException(409, "Email already registered") from e
    token = create_token(user.id)
    return AuthResponse(token=token, user=_public_user(user))


@router.post("/login", response_model=AuthResponse)
def login(req: LoginRequest) -> AuthResponse:
    user = auth_db.verify_password(req.email, req.password)
    if user is None:
        raise HTTPException(401, "Invalid email or password")
    token = create_token(user.id)
    return AuthResponse(token=token, user=_public_user(user))


@router.get("/me", response_model=MeResponse)
def me(user: auth_db.User = Depends(auth.require_user)) -> MeResponse:
    return _me_payload(user)


@router.get("/api-key", response_model=ApiKeyResponse)
def api_key(user: auth_db.User = Depends(auth.require_user)) -> ApiKeyResponse:
    return ApiKeyResponse(api_key=user.api_key, masked=_mask_key(user.api_key))


@router.post("/api-key/rotate", response_model=ApiKeyResponse)
def rotate_api_key(
    user: auth_db.User = Depends(auth.require_user),
) -> ApiKeyResponse:
    old_key = user.api_key
    updated = auth_db.rotate_api_key(user.id)
    if updated is None:
        raise HTTPException(404, "User not found")
    # Old key must stop working immediately, even across the 60s cache.
    auth.invalidate_api_key_cache(old_key, updated.api_key)
    return ApiKeyResponse(
        api_key=updated.api_key, masked=_mask_key(updated.api_key)
    )
