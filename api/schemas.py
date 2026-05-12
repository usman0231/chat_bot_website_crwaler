"""Pydantic request/response models for the bot API."""

from typing import Literal

from pydantic import BaseModel, Field, HttpUrl


class CreateBotRequest(BaseModel):
    website_url: HttpUrl
    website_name: str = Field(..., min_length=1, max_length=100)
    max_pages: int | None = Field(None, ge=1, le=200)


class CreateBotResponse(BaseModel):
    bot_id: str
    status: Literal["training"]
    website_name: str


class StatusResponse(BaseModel):
    bot_id: str
    website_name: str
    status: Literal["training", "ready", "failed"]
    pages: int | None = None
    chunks: int | None = None
    error: str | None = None


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)


class ChatResponse(BaseModel):
    answer: str
    sources: list[str]
    in_scope: bool
    match_quality: Literal["strong", "weak", "none"]
