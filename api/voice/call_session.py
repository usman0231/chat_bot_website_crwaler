"""Call-session state container.

Tracks state machine, conversation history (capped at 6 turns / 12 messages
to match the chat endpoint), and detected language across the call.
"""

from __future__ import annotations

from enum import Enum


class CallState(str, Enum):
    IDLE = "idle"
    LISTENING = "listening"
    PROCESSING = "processing"
    SPEAKING = "speaking"
    INTERRUPTED = "interrupted"


class CallSession:
    HISTORY_MAX_MESSAGES = 12  # 6 user turns + 6 bot turns
    HISTORY_RETURN_MESSAGES = 6

    def __init__(self, bot_id: str, website_name: str):
        self.bot_id = bot_id
        self.website_name = website_name
        self.state = CallState.IDLE
        self.detected_language = "en"
        self.conversation_history: list[dict] = []
        self.turn_count = 0

    def add_turn(self, user_text: str, bot_text: str) -> None:
        self.conversation_history.append({"role": "user", "content": user_text})
        self.conversation_history.append({"role": "bot", "content": bot_text})
        if len(self.conversation_history) > self.HISTORY_MAX_MESSAGES:
            self.conversation_history = self.conversation_history[
                -self.HISTORY_MAX_MESSAGES :
            ]
        self.turn_count += 1

    def get_history(self) -> list[dict]:
        """Recent history in the OpenAI ``{"role", "content"}`` shape.

        ``bot.answer`` passes ``history`` straight into ``llm.chat`` (Ollama's
        OpenAI-compatible API), so we must use ``assistant`` here — Ollama
        will silently mishandle the custom ``bot`` role used by the HTTP
        chat endpoint and the model returns nonsense or nothing at all.
        """
        recent = self.conversation_history[-self.HISTORY_RETURN_MESSAGES :]
        return [
            {
                "role": "assistant" if m["role"] == "bot" else "user",
                "content": m["content"],
            }
            for m in recent
        ]
