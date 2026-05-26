"""Pydantic request/response models for the bot API."""

from typing import Literal

from pydantic import BaseModel, Field, HttpUrl


class CreateBotRequest(BaseModel):
    website_url: HttpUrl
    website_name: str = Field(..., min_length=1, max_length=100)
    # Upper bound matches the Enterprise tier cap (max_pages_per_bot=9999).
    # The /bot/create handler clamps this down to the caller's actual tier.
    max_pages: int | None = Field(None, ge=1, le=10000)


class CreateBotResponse(BaseModel):
    bot_id: str
    status: Literal["training"]
    website_name: str


class StatusResponse(BaseModel):
    bot_id: str
    website_name: str
    status: Literal["training", "ready", "failed"]
    stage: Literal["queued", "crawling", "embedding", "indexing", "done"] | None = None
    pages_crawled: int | None = None
    pages_total: int | None = None
    pages: int | None = None
    chunks: int | None = None
    elapsed_seconds: float | None = None
    error: str | None = None
    created_at: str | None = None
    suggested_questions: list[str] = []
    voice_id: str | None = None


class BotSummary(BaseModel):
    bot_id: str
    website_url: str = ""
    website_name: str = ""
    status: Literal["training", "ready", "failed"]
    pages: int | None = None
    chunks: int | None = None
    created_at: str | None = None
    error: str | None = None
    user_id: str | None = None
    shared: bool = False


class ListBotsResponse(BaseModel):
    bots: list[BotSummary]


class ChatHistoryMessage(BaseModel):
    role: Literal["user", "bot"]
    content: str = Field(..., max_length=10_000)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    history: list[ChatHistoryMessage] = Field(default_factory=list)


class ChatResponse(BaseModel):
    answer: str
    sources: list[str]
    in_scope: bool
    match_quality: Literal["strong", "weak", "none", "greeting", "farewell", "meta"]


class SourcePage(BaseModel):
    url: str
    title: str
    chunk_count: int


class SourcesResponse(BaseModel):
    bot_id: str
    sources: list[SourcePage]


class DeleteBotResponse(BaseModel):
    bot_id: str
    deleted: bool


class RecrawlResponse(BaseModel):
    bot_id: str
    status: Literal["training"]


class UpdateQuestionsRequest(BaseModel):
    questions: list[str] = Field(..., min_length=1, max_length=8)

    @classmethod
    def _clean(cls, q: str) -> str:
        return q.strip()


class UpdateQuestionsResponse(BaseModel):
    bot_id: str
    questions: list[str]


class RegenerateQuestionsResponse(BaseModel):
    bot_id: str
    questions: list[str]


class UpdateVoiceRequest(BaseModel):
    # ElevenLabs voice IDs are 20-char tokens; min_length=10 rejects junk
    # while staying comfortably under any real id length.
    voice_id: str = Field(..., min_length=10, max_length=64)


class UpdateVoiceResponse(BaseModel):
    bot_id: str
    voice_id: str
