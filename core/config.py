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

    # ----- Groq (cloud Whisper STT) -----
    # In practice this is the same key as LLM_API_KEY when Groq is the
    # backend; the stt module reads LLM_API_KEY directly. Exposed here so
    # GROQ_API_KEY can be set explicitly when the two diverge.
    groq_api_key: str = Field(default="")

    # ----- API auth -----
    demo_api_key: str = Field(..., description="Legacy/admin API key — still recognised as a fallback")
    jwt_secret: str = Field(
        default="dev-only-change-me-please-this-is-not-secure",
        description="HS256 secret for user JWTs (set JWT_SECRET in .env)",
    )
    auth_db_path: str = Field(default="./data/auth.db")

    # ----- Stripe -----
    stripe_secret_key: str = Field(default="", description="sk_test_… or sk_live_…")
    stripe_publishable_key: str = Field(default="")
    stripe_webhook_secret: str = Field(default="")
    stripe_price_pro: str = Field(default="", description="Stripe price id for the Pro tier")
    stripe_price_enterprise: str = Field(default="")
    app_base_url: str = Field(default="http://localhost:3000")

    # ----- Embeddings -----
    embed_model: str = Field(default="sentence-transformers/all-MiniLM-L6-v2")
    # Chunked processing so large sites don't exceed ChromaDB's max batch
    # size (a SQLite variable-limit ceiling, ~5461). chroma_batch_size is an
    # upper bound — it's clamped down to the client's reported max at write
    # time, so a conservative default is safe on any environment.
    embed_batch_size: int = Field(default=512, ge=1)
    chroma_batch_size: int = Field(default=500, ge=1)

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

    # ----- Voice calling -----
    # faster-whisper config — override device to "cpu" + compute_type to "int8"
    # on machines without an NVIDIA GPU / CUDA toolkit. Note: large-v3 on
    # CPU+int8 is very slow (5–15s per turn) — drop back to "medium" or
    # "small" if your hardware can't reach acceptable latency.
    whisper_model: str = Field(default="large-v3")
    whisper_device: str = Field(default="cuda")
    whisper_compute_type: str = Field(default="float16")
    whisper_initial_prompt: str = Field(
        default="The following is a customer service conversation.",
        description="Decoder priming prompt; biases vocabulary/style.",
    )
    vad_silence_ms: int = Field(default=500, ge=200, le=5000)
    voice_sample_rate: int = Field(default=16000)

    # ElevenLabs — primary TTS backend.
    elevenlabs_api_key: str = Field(default="")
    # Sarah — a *premade* voice that works on free/starter ElevenLabs keys.
    # (Rachel 21m00… and the professional Serafina voice 402 on free plans,
    # which is why bots with no per-bot voice_id used to all sound wrong.)
    elevenlabs_default_voice: str = Field(default="EXAVITQu4vr4xnSDxMaL")  # Sarah
    # Turbo v2.5 = faster + more natural English. Drop back to
    # eleven_multilingual_v2 if you need stronger Urdu / other-language
    # phonetics; turbo is English-leaning.
    elevenlabs_model: str = Field(default="eleven_turbo_v2_5")
    elevenlabs_output_format: str = Field(default="mp3_22050_32")

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
