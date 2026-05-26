"""Heuristic budget extractor for voice queries.

Pulls the upper-bound budget out of phrases like "under 60k",
"less than Rs. 50,000", "below 25000 rupees", "30k budget", etc.
Returned amount is in rupees (the dominant Pakistani-store currency in the
training-corpus the user works with).

Returns None when no budget signal is found. The caller decides what to do
with it — typically append a BUDGET CONSTRAINT system_suffix passed into
``WebsiteBot.answer``.
"""

from __future__ import annotations

import re

# Patterns capture the numeric amount as group(1). We test in priority
# order — the first match wins. Each pattern's full match is inspected
# afterwards to decide if 'k' (thousands) applies.
_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"under\s+(?:rs\.?\s*)?(\d+(?:,\d+)*(?:\.\d+)?)\s*k?", re.IGNORECASE),
    re.compile(r"less\s+than\s+(?:rs\.?\s*)?(\d+(?:,\d+)*(?:\.\d+)?)\s*k?", re.IGNORECASE),
    re.compile(r"below\s+(?:rs\.?\s*)?(\d+(?:,\d+)*(?:\.\d+)?)\s*k?", re.IGNORECASE),
    re.compile(r"budget\s+(?:of\s+)?(?:rs\.?\s*)?(\d+(?:,\d+)*(?:\.\d+)?)\s*k?", re.IGNORECASE),
    re.compile(r"(?:rs\.?\s*)?(\d+(?:,\d+)*(?:\.\d+)?)\s*k\s+budget", re.IGNORECASE),
    re.compile(r"(\d+(?:,\d+)*)\s*(?:rs|pkr|rupees)\b", re.IGNORECASE),
)


def extract_budget(text: str) -> float | None:
    """Return the user's stated upper-bound budget (rupees), or None.

    Multipliers: a trailing ``k`` directly after the number (with optional
    whitespace) means ×1000. We only apply this when the ``k`` is adjacent
    to the captured digits — not anywhere in the surrounding phrase — so
    e.g. ``"keep it under 50000"`` doesn't accidentally inflate.
    """
    if not text:
        return None
    for pattern in _PATTERNS:
        match = pattern.search(text)
        if match is None:
            continue
        amount_str = match.group(1).replace(",", "")
        try:
            amount = float(amount_str)
        except ValueError:
            continue
        # Look only at the slice immediately after the digit group for 'k'.
        tail = match.group(0)[match.end(1) - match.start(0) :]
        if re.match(r"\s*k\b", tail, re.IGNORECASE):
            amount *= 1000
        if amount <= 0:
            continue
        return amount
    return None
