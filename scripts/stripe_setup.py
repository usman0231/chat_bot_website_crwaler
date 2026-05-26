"""One-time Stripe setup.

Idempotent: re-running won't create duplicates. Uses ``stripe.Product.search``
to find existing products by name and reuses their ``default_price``.

Usage:
    python scripts/stripe_setup.py

After running, restart the backend so it picks up the new STRIPE_PRICE_* env
values.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = PROJECT_ROOT / ".env"


PRODUCTS = [
    {
        "tier": "pro",
        "env_var": "STRIPE_PRICE_PRO",
        "name": "SiteBot Pro",
        "description": "10 bots, 100 pages per bot, 5,000 messages/month",
        "amount_cents": 2900,  # $29.00
    },
    {
        "tier": "enterprise",
        "env_var": "STRIPE_PRICE_ENTERPRISE",
        "name": "SiteBot Enterprise",
        "description": "Unlimited bots, unlimited pages, unlimited messages",
        "amount_cents": 9900,  # $99.00
    },
]


def _find_existing_product(name: str):
    """Return an existing product matching ``name`` exactly, else None.

    Falls back to listing products if Search isn't available on the account
    (some restricted keys don't have access to the Search API).
    """
    import stripe

    try:
        results = stripe.Product.search(query=f'name:"{name}"', limit=10)
        for product in results.auto_paging_iter():
            if product.name == name and product.active:
                return product
    except stripe.InvalidRequestError:
        # Search index can take a moment to populate after creation, or the
        # API key may not have access — fall through to a paginated list.
        pass
    except AttributeError:
        # Older stripe SDKs.
        pass

    for product in stripe.Product.list(limit=100, active=True).auto_paging_iter():
        if product.name == name:
            return product
    return None


def _recurring_interval(price) -> str | None:
    """Stripe returns ``recurring`` as a StripeObject — neither a dict nor a
    plain attr — so use the safest possible access."""
    recurring = getattr(price, "recurring", None)
    if recurring is None:
        return None
    try:
        return recurring["interval"]
    except (KeyError, TypeError):
        return getattr(recurring, "interval", None)


def _find_active_recurring_price(product_id: str, amount_cents: int):
    """Return an existing active monthly USD price matching amount, or None."""
    import stripe

    for price in stripe.Price.list(
        product=product_id, active=True, limit=100
    ).auto_paging_iter():
        if (
            price.unit_amount == amount_cents
            and price.currency == "usd"
            and _recurring_interval(price) == "month"
        ):
            return price
    return None


def _ensure_product_and_price(spec: dict) -> tuple[str, str]:
    import stripe

    product = _find_existing_product(spec["name"])
    if product is None:
        product = stripe.Product.create(
            name=spec["name"],
            description=spec["description"],
        )
        print(f"  + Created product {product.id}")
    else:
        print(f"  · Reusing product {product.id}")

    # Try default_price first.
    price = None
    default_price_id = getattr(product, "default_price", None)
    if isinstance(default_price_id, str):
        try:
            candidate = stripe.Price.retrieve(default_price_id)
            if (
                candidate.active
                and candidate.unit_amount == spec["amount_cents"]
                and candidate.currency == "usd"
                and _recurring_interval(candidate) == "month"
            ):
                price = candidate
        except stripe.InvalidRequestError:
            pass

    if price is None:
        price = _find_active_recurring_price(product.id, spec["amount_cents"])

    if price is None:
        price = stripe.Price.create(
            product=product.id,
            unit_amount=spec["amount_cents"],
            currency="usd",
            recurring={"interval": "month"},
        )
        print(f"  + Created price {price.id}")
        # Make it the default for the product so the dashboard shows it cleanly.
        try:
            stripe.Product.modify(product.id, default_price=price.id)
        except stripe.StripeError:
            pass
    else:
        print(f"  · Reusing price {price.id}")

    return product.id, price.id


def _update_env(updates: dict[str, str]) -> None:
    if not ENV_PATH.exists():
        print(f"!! {ENV_PATH} does not exist — creating it.")
        ENV_PATH.write_text("", encoding="utf-8")

    content = ENV_PATH.read_text(encoding="utf-8")

    for key, value in updates.items():
        pattern = re.compile(rf"^{re.escape(key)}=.*$", re.MULTILINE)
        new_line = f"{key}={value}"
        if pattern.search(content):
            content = pattern.sub(new_line, content)
        else:
            if content and not content.endswith("\n"):
                content += "\n"
            content += new_line + "\n"

    ENV_PATH.write_text(content, encoding="utf-8")


def main() -> int:
    load_dotenv(ENV_PATH)
    secret_key = os.environ.get("STRIPE_SECRET_KEY", "").strip()
    if not secret_key:
        print(
            "STRIPE_SECRET_KEY is not set in .env. Add your test secret key"
            " (sk_test_...) and re-run."
        )
        return 1

    try:
        import stripe
    except ImportError:
        print("The 'stripe' package is not installed. Run: pip install stripe")
        return 1

    stripe.api_key = secret_key

    summary: list[tuple[dict, str, str]] = []
    for spec in PRODUCTS:
        print(f"\n{spec['name']}:")
        product_id, price_id = _ensure_product_and_price(spec)
        summary.append((spec, product_id, price_id))

    updates = {spec["env_var"]: price_id for spec, _, price_id in summary}
    _update_env(updates)

    print()
    for spec, product_id, price_id in summary:
        dollars = spec["amount_cents"] / 100
        label = spec["name"].replace("SiteBot ", "")
        print(f"✅ {label} product: {product_id}")
        print(f"✅ {label} price: {price_id} (${dollars:.0f}/mo)")
    print("✅ .env updated automatically")
    print("\nRun this script again anytime — it won't create duplicates.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
