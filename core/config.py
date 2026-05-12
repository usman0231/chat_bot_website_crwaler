"""
Central configuration loader.

Reads from environment variables (or .env file) using pydantic-settings.
Import `settings` anywhere in the project to access config values.

Example:
    from core.config import settings
    print(settings.llm_model)
"""

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All runtime configuration. Loaded once at import time."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ----- Local LLM via Ollama (OpenAI-compatible API) -----
    llm_base_url: str = Field(default="http://localhost:11434/v1")
    llm_api_key: str = Field(default="ollama")  # Ollama ignores this; just non-empty
    llm_model: str = Field(default="qwen2.5:7b")

    # ----- API auth -----
    demo_api_key: str = Field(..., description="Shared API key for /bot/* endpoints")

    # ----- Embeddings -----
    embed_model: str = Field(default="sentence-transformers/all-MiniLM-L6-v2")

    # ----- Crawler -----
    max_pages: int = Field(default=30, ge=1, le=1000)
    crawl_concurrency: int = Field(default=5, ge=1, le=50)
    http_timeout: float = Field(default=10.0, gt=0)
    browser_timeout: int = Field(default=15, ge=5, le=60)

    # ----- RAG -----
    top_k: int = Field(default=4, ge=1, le=20)
    max_distance: float = Field(default=0.65, ge=0, le=2)

    # ----- Storage -----
    chroma_path: str = Field(default="./data/chroma")
    bots_registry_path: str = Field(default="./data/bots.json")

    # ----- Server -----
    host: str = Field(default="0.0.0.0")
    port: int = Field(default=8000)
    log_level: str = Field(default="info")

    @property
    def chroma_dir(self) -> Path:
        p = Path(self.chroma_path)
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def registry_file(self) -> Path:
        p = Path(self.bots_registry_path)
        p.parent.mkdir(parents=True, exist_ok=True)
        return p


# Single instance imported everywhere.
settings = Settings()  # type: ignore[call-arg]
