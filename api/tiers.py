"""Tier limits.

Keep this dict small and obvious — it's the single source of truth for
billing-driven feature caps. The webhook + ``/auth/me`` both rely on it.
"""

from __future__ import annotations

from typing import TypedDict


class TierLimits(TypedDict):
    max_bots: int
    max_pages_per_bot: int
    monthly_messages: int


TIER_LIMITS: dict[str, TierLimits] = {
    "free": {"max_bots": 1, "max_pages_per_bot": 25, "monthly_messages": 100},
    "pro": {"max_bots": 10, "max_pages_per_bot": 100, "monthly_messages": 5000},
    "enterprise": {
        "max_bots": 999,
        "max_pages_per_bot": 9999,
        "monthly_messages": 999_999,
    },
}


def limits_for(tier: str) -> TierLimits:
    return TIER_LIMITS.get(tier, TIER_LIMITS["free"])
