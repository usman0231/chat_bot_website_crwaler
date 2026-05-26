"""Stripe billing: Checkout, Billing Portal, webhook.

The webhook is the source of truth for tier state. ``/stripe/checkout/create``
just hands the user off to Stripe; we don't optimistically flip tiers until
the ``checkout.session.completed`` event arrives.
"""

from __future__ import annotations

import logging

import stripe
from fastapi import APIRouter, Depends, HTTPException, Header, Request
from pydantic import BaseModel, Field

from api import auth, auth_db
from core.config import settings

log = logging.getLogger(__name__)

router = APIRouter(prefix="/stripe", tags=["billing"])


_PRICE_IDS: dict[str, str] = {}


def _refresh_price_ids() -> None:
    _PRICE_IDS["pro"] = settings.stripe_price_pro
    _PRICE_IDS["enterprise"] = settings.stripe_price_enterprise


def _price_for(tier: str) -> str:
    _refresh_price_ids()
    price = _PRICE_IDS.get(tier, "")
    if not price:
        raise HTTPException(400, f"No Stripe price configured for tier '{tier}'")
    return price


# Pinned API version where Invoice.payment_intent still exists. Newer
# versions (2025-03-31.basil and later) removed it in favour of
# Invoice.confirmation_secret; the retrieval code below handles both, but
# pinning keeps the wire format consistent and predictable.
_STRIPE_API_VERSION = "2024-06-20"


def _configure_stripe() -> None:
    if not settings.stripe_secret_key:
        raise HTTPException(503, "Stripe is not configured on this server")
    stripe.api_key = settings.stripe_secret_key
    stripe.api_version = _STRIPE_API_VERSION


def _ensure_customer(user: auth_db.User) -> str:
    """Return a Stripe customer id, creating one if needed and persisting it."""
    if user.stripe_customer_id:
        return user.stripe_customer_id
    customer = stripe.Customer.create(
        email=user.email,
        name=user.name,
        metadata={"user_id": user.id},
    )
    auth_db.set_stripe_customer(user.id, customer.id)
    return customer.id


class CheckoutRequest(BaseModel):
    tier: str = Field(..., pattern="^(pro|enterprise)$")


class PaymentIntentResponse(BaseModel):
    client_secret: str
    subscription_id: str
    publishable_key: str
    tier: str
    amount: int  # cents
    currency: str


class ConfirmRequest(BaseModel):
    subscription_id: str = Field(..., min_length=4, max_length=120)


class ConfirmResponse(BaseModel):
    tier: str
    status: str


class PortalResponse(BaseModel):
    url: str


def _expanded(obj: object, key: str) -> object:
    """Return a property on a Stripe object regardless of whether it was
    expanded (object) or returned as a bare id (string)."""
    if obj is None:
        return None
    if isinstance(obj, str):
        return None
    return getattr(obj, key, None)


def _client_secret_from_subscription(subscription) -> tuple[str | None, object]:
    """Return (client_secret, invoice_or_None) from a Subscription object.

    Handles both Stripe API shapes:
      * older (<= 2024-06-20): Invoice.payment_intent.client_secret
      * newer (>= 2025-03-31): Invoice.confirmation_secret.client_secret
    Falls back to retrieving the invoice + PaymentIntent explicitly if the
    initial `expand` didn't populate the nested object.
    """
    invoice = _expanded(subscription, "latest_invoice")

    # --- shape 1: invoice.payment_intent.client_secret ---
    intent = _expanded(invoice, "payment_intent") if invoice else None
    if intent is None and invoice is not None:
        # `payment_intent` came back as a bare id (str) rather than expanded.
        pi_id = getattr(invoice, "payment_intent", None)
        if isinstance(pi_id, str) and pi_id:
            try:
                intent = stripe.PaymentIntent.retrieve(pi_id)
            except stripe.StripeError:
                intent = None
    if intent is not None:
        secret = getattr(intent, "client_secret", None)
        if secret:
            return secret, invoice

    # --- shape 2: invoice.confirmation_secret.client_secret ---
    confirmation_secret = (
        getattr(invoice, "confirmation_secret", None) if invoice else None
    )
    if confirmation_secret is not None:
        secret = getattr(confirmation_secret, "client_secret", None)
        if not secret and hasattr(confirmation_secret, "get"):
            try:
                secret = confirmation_secret.get("client_secret")
            except (KeyError, TypeError):
                secret = None
        if secret:
            return secret, invoice

    # --- shape 3: re-fetch the invoice with fresh expansion ---
    invoice_id = getattr(invoice, "id", None) if invoice else None
    if isinstance(invoice_id, str) and invoice_id:
        try:
            fresh_invoice = stripe.Invoice.retrieve(
                invoice_id, expand=["payment_intent", "confirmation_secret"]
            )
        except stripe.StripeError as e:
            log.warning("Could not re-retrieve invoice %s: %s", invoice_id, e)
            return None, invoice
        intent = getattr(fresh_invoice, "payment_intent", None)
        if isinstance(intent, str):
            try:
                intent = stripe.PaymentIntent.retrieve(intent)
            except stripe.StripeError:
                intent = None
        if intent is not None:
            secret = getattr(intent, "client_secret", None)
            if secret:
                return secret, fresh_invoice
        cs = getattr(fresh_invoice, "confirmation_secret", None)
        if cs is not None:
            secret = getattr(cs, "client_secret", None)
            if secret:
                return secret, fresh_invoice

    return None, invoice


@router.post("/payment/create-intent", response_model=PaymentIntentResponse)
def create_payment_intent(
    req: CheckoutRequest,
    user: auth_db.User = Depends(auth.require_user),
) -> PaymentIntentResponse:
    _configure_stripe()
    price_id = _price_for(req.tier)
    customer_id = _ensure_customer(user)

    try:
        subscription = stripe.Subscription.create(
            customer=customer_id,
            items=[{"price": price_id}],
            payment_behavior="default_incomplete",
            payment_settings={"save_default_payment_method": "on_subscription"},
            metadata={"user_id": user.id, "tier": req.tier},
            expand=[
                "latest_invoice.payment_intent",
                "latest_invoice.confirmation_secret",
            ],
        )
    except stripe.StripeError as e:
        log.error("stripe.Subscription.create failed: %s", e)
        raise HTTPException(502, f"Stripe error: {e.user_message or str(e)}") from e

    client_secret, invoice = _client_secret_from_subscription(subscription)
    if not client_secret:
        sub_status = getattr(subscription, "status", "unknown")
        log.error(
            "No client_secret resolvable from subscription %s (status=%s,"
            " invoice=%s)",
            subscription.id,
            sub_status,
            getattr(invoice, "id", None) if invoice else None,
        )
        raise HTTPException(
            502,
            "Stripe did not return a payment intent client_secret."
            f" Subscription {subscription.id} is in status '{sub_status}'."
            " Check the backend logs for details.",
        )

    amount = getattr(invoice, "amount_due", 0) if invoice else 0
    currency = (getattr(invoice, "currency", "usd") or "usd").lower()

    return PaymentIntentResponse(
        client_secret=client_secret,
        subscription_id=subscription.id,
        publishable_key=settings.stripe_publishable_key,
        tier=req.tier,
        amount=int(amount or 0),
        currency=currency,
    )


@router.post("/payment/confirm", response_model=ConfirmResponse)
def confirm_payment(
    req: ConfirmRequest,
    user: auth_db.User = Depends(auth.require_user),
) -> ConfirmResponse:
    """Synchronous tier-flip after Stripe.js confirms the card.

    The webhook (``customer.subscription.updated``) is still the durable
    source of truth — this endpoint just removes the post-payment lag so
    the UI doesn't have to poll.
    """
    _configure_stripe()
    try:
        subscription = stripe.Subscription.retrieve(req.subscription_id)
    except stripe.InvalidRequestError as e:
        raise HTTPException(404, "Subscription not found") from e

    # Ownership check: the subscription's customer must match the caller's.
    sub_customer = getattr(subscription, "customer", None)
    if sub_customer and user.stripe_customer_id and sub_customer != user.stripe_customer_id:
        raise HTTPException(403, "Subscription does not belong to this user")

    status = getattr(subscription, "status", "incomplete") or "incomplete"
    metadata = getattr(subscription, "metadata", None)
    tier = None
    if metadata is not None:
        tier = metadata.get("tier") if hasattr(metadata, "get") else getattr(
            metadata, "tier", None
        )

    if status in {"active", "trialing"} and tier in {"pro", "enterprise"}:
        auth_db.apply_subscription_update(
            user.id,
            tier=tier,
            subscription_id=subscription.id,
            subscription_status="active",
        )
    else:
        # Still pending — record the subscription id so the webhook can
        # finish the job when payment clears.
        auth_db.apply_subscription_update(
            user.id,
            subscription_id=subscription.id,
            subscription_status=status,
        )

    fresh = auth_db.get_user_by_id(user.id) or user
    return ConfirmResponse(tier=fresh.tier, status=fresh.subscription_status)


@router.post("/portal/create", response_model=PortalResponse)
def create_portal(
    user: auth_db.User = Depends(auth.require_user),
) -> PortalResponse:
    _configure_stripe()
    if not user.stripe_customer_id:
        raise HTTPException(400, "No billing account yet — upgrade to a paid plan first")
    base = settings.app_base_url.rstrip("/")
    session = stripe.billing_portal.Session.create(
        customer=user.stripe_customer_id,
        return_url=f"{base}/account",
    )
    if not session.url:
        raise HTTPException(502, "Stripe did not return a portal URL")
    return PortalResponse(url=session.url)


def _resolve_user_for_event(event: dict) -> auth_db.User | None:
    data = event["data"]["object"]
    metadata = data.get("metadata") or {}
    user_id = metadata.get("user_id")
    if user_id:
        user = auth_db.get_user_by_id(user_id)
        if user is not None:
            return user
    customer_id = data.get("customer")
    if customer_id:
        return auth_db.get_user_by_stripe_customer(customer_id)
    return None


def _tier_from_event(event: dict) -> str | None:
    data = event["data"]["object"]
    metadata = data.get("metadata") or {}
    tier = metadata.get("tier")
    if tier in ("pro", "enterprise", "free"):
        return tier
    return None


def handle_event(event: dict) -> None:
    """Apply a verified Stripe event to local user state."""
    event_type = event.get("type", "")
    user = _resolve_user_for_event(event)
    if user is None:
        log.warning("stripe event %s could not be matched to a user", event_type)
        return

    data = event["data"]["object"]
    if event_type == "checkout.session.completed":
        tier = _tier_from_event(event) or "pro"
        subscription_id = data.get("subscription")
        auth_db.apply_subscription_update(
            user.id,
            tier=tier,
            subscription_id=subscription_id,
            subscription_status="active",
        )
    elif event_type in (
        "customer.subscription.updated",
        "customer.subscription.created",
        "invoice.payment_succeeded",
    ):
        # Subscription objects carry status + metadata; invoice events carry
        # a 'subscription' id and a status, but no metadata — fall back to
        # the on-file subscription_id for the tier lookup if needed.
        status = data.get("status")
        if event_type == "invoice.payment_succeeded":
            status = "active"
        if status not in {"active", "past_due", "canceled", "unpaid", "incomplete", "trialing"}:
            status = "active"

        tier = _tier_from_event(event)
        subscription_id = data.get("subscription") or data.get("id")
        kwargs: dict = {"subscription_status": status}
        if status in {"active", "trialing"} and tier in ("pro", "enterprise"):
            kwargs["tier"] = tier
        if isinstance(subscription_id, str):
            kwargs["subscription_id"] = subscription_id
        auth_db.apply_subscription_update(user.id, **kwargs)
    elif event_type == "customer.subscription.deleted":
        auth_db.reset_to_free(user.id)
    else:
        log.debug("stripe webhook: ignoring %s", event_type)


@router.post("/webhook", include_in_schema=False)
async def webhook(request: Request, stripe_signature: str | None = Header(default=None)):
    payload = await request.body()
    secret = settings.stripe_webhook_secret
    if not secret:
        raise HTTPException(503, "Webhook secret not configured")
    if not stripe_signature:
        raise HTTPException(400, "Missing Stripe-Signature header")
    try:
        event = stripe.Webhook.construct_event(
            payload=payload, sig_header=stripe_signature, secret=secret
        )
    except (ValueError, stripe.SignatureVerificationError) as e:
        raise HTTPException(400, f"Invalid webhook signature: {e}") from e
    handle_event(event)
    return {"received": True}
