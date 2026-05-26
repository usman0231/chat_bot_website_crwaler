"""Silero VAD — per-chunk speech detection with stateful session tracking.

Model loads lazily on first ``VADProcessor`` construction so the API can
start even if torch/silero deps aren't installed yet. ``process_chunk``
accepts 100ms slices of 16kHz mono float32 audio and reports
speech_start / speech_end events with the buffered utterance.
"""

from __future__ import annotations

import logging
from typing import Any

import numpy as np

log = logging.getLogger(__name__)

_vad_model: Any = None
_vad_utils: Any = None


def get_vad():
    """Load the Silero VAD model on demand."""
    global _vad_model, _vad_utils
    if _vad_model is None:
        import torch

        log.info("Loading silero-vad model")
        _vad_model, _vad_utils = torch.hub.load(
            "snakers4/silero-vad",
            model="silero_vad",
            force_reload=False,
            trust_repo=True,
        )
    return _vad_model, _vad_utils


_SILERO_WINDOW = 512  # Silero v5 expects exactly 512 samples @ 16 kHz
_SILERO_WINDOW_MS = _SILERO_WINDOW * 1000 // 16000  # 32 ms


class VADProcessor:
    """Stateful VAD for a single call session.

    Detects when the user starts and stops speaking. Incoming chunks can be
    any length (the browser's ScriptProcessor delivers a power-of-two buffer
    that doesn't line up with the model's 512-sample window); we slice into
    512-sample windows internally and emit a single ``speech_start`` /
    ``speech_end`` event per buffer when state transitions.
    """

    def __init__(
        self,
        sample_rate: int = 16000,
        silence_threshold_ms: int = 500,
        speech_prob_threshold: float = 0.40,
    ):
        self.model, _ = get_vad()
        # Silero VAD is stateful and the model is a process-global singleton;
        # zero it out so leftover hidden state from a prior session doesn't
        # leak into this one.
        self._reset_model_states()
        self.sample_rate = sample_rate
        self.silence_threshold_ms = silence_threshold_ms
        self.speech_prob_threshold = speech_prob_threshold

        self.audio_buffer: list[np.ndarray] = []
        self.window_carry: np.ndarray = np.zeros(0, dtype=np.float32)
        self.is_speaking = False
        self.silence_windows = 0
        self.silence_windows_threshold = max(
            1, silence_threshold_ms // _SILERO_WINDOW_MS
        )

    def _reset_model_states(self) -> None:
        reset = getattr(self.model, "reset_states", None)
        if callable(reset):
            try:
                reset()
            except Exception as e:
                log.debug("VAD reset_states failed: %s", e)

    def _speech_prob(self, window: np.ndarray) -> float:
        import torch

        # np.frombuffer (the producer upstream) returns a non-writable view.
        # PyTorch warns once and then suppresses, but the cleanest fix is to
        # ensure we always hand it a writable, contiguous buffer.
        if not window.flags.writeable or not window.flags.c_contiguous:
            window = np.ascontiguousarray(window).copy()
        try:
            return float(self.model(torch.from_numpy(window), self.sample_rate).item())
        except Exception as e:
            log.debug("VAD inference failed (%s); treating as silence", e)
            return 0.0

    def process_chunk(self, audio_chunk: np.ndarray) -> dict:
        """Process one chunk. Returns ``{event, audio}``.

        ``event`` is one of None, "speech_start", "speech_end". When
        ``event`` is "speech_end" the buffered utterance is returned in
        ``audio`` as raw float32 bytes ready for the STT pipeline.
        """
        if audio_chunk.dtype != np.float32:
            audio_chunk = audio_chunk.astype(np.float32, copy=False)

        # Combine the carry from last call with the new buffer, slice into
        # exact 512-sample windows, and stash any tail for next time.
        combined = (
            np.concatenate((self.window_carry, audio_chunk))
            if self.window_carry.size
            else audio_chunk
        )
        n_windows = combined.size // _SILERO_WINDOW
        if n_windows == 0:
            self.window_carry = combined
            self.audio_buffer.append(audio_chunk)
            return {"event": None, "audio": None}

        used = n_windows * _SILERO_WINDOW
        self.window_carry = combined[used:].copy()
        self.audio_buffer.append(audio_chunk)

        event: str | None = None
        speech_end_audio: bytes | None = None

        for i in range(n_windows):
            window = combined[i * _SILERO_WINDOW : (i + 1) * _SILERO_WINDOW]
            is_speech = self._speech_prob(window) > self.speech_prob_threshold

            if is_speech:
                if not self.is_speaking:
                    self.is_speaking = True
                    self.silence_windows = 0
                    if event is None:
                        event = "speech_start"
                else:
                    self.silence_windows = 0
            else:
                if self.is_speaking:
                    self.silence_windows += 1
                    if self.silence_windows >= self.silence_windows_threshold:
                        self.is_speaking = False
                        complete_audio = np.concatenate(self.audio_buffer)
                        self.audio_buffer = []
                        self.silence_windows = 0
                        event = "speech_end"
                        speech_end_audio = complete_audio.tobytes()
                        break

        return {"event": event, "audio": speech_end_audio}

    def reset(self):
        self.audio_buffer = []
        self.window_carry = np.zeros(0, dtype=np.float32)
        self.is_speaking = False
        self.silence_windows = 0
        self._reset_model_states()
