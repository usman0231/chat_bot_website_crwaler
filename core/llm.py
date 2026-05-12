"""
LLM client — wraps the OpenAI SDK against Ollama's /v1 endpoint.

Why this exists as a separate module:
- All LLM calls flow through one place. Easy to log, retry, or swap providers.
- If you later move from Ollama to (say) llama.cpp server or vLLM, only this
  file changes.

Ollama exposes an OpenAI-compatible HTTP API by default on port 11434. The
OpenAI Python SDK works against it unchanged — just point base_url at it.
See: https://github.com/ollama/ollama/blob/main/docs/openai.md
"""

from openai import OpenAI

from core.config import settings

_client = OpenAI(
    base_url=settings.llm_base_url,
    api_key=settings.llm_api_key,  # Ollama ignores this but the SDK requires non-empty
    timeout=120,  # local 7B models can be slow on first token; be generous
)


def chat(system: str, user: str, *, temperature: float = 0.2) -> str:
    """
    Single-turn chat call.

    Args:
        system: The strict system prompt (guardrails go here).
        user:   The user message (usually: context + question for RAG).
        temperature: Lower = more deterministic. 0.2 is a good default for
                     RAG so the model sticks closer to the retrieved context.

    Returns:
        Assistant's reply as a plain string.

    Raises:
        openai.OpenAIError: Network / Ollama failures bubble up.
    """
    resp = _client.chat.completions.create(
        model=settings.llm_model,
        temperature=temperature,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    return resp.choices[0].message.content or ""


def ping() -> bool:
    """Quick health check — returns True if Ollama is reachable and the model is loaded."""
    try:
        chat(system="Reply with the single word: ok", user="ping", temperature=0)
        return True
    except Exception:
        return False
