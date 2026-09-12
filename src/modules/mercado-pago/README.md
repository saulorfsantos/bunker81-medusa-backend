# Mercado Pago payment provider

This module registers two Medusa v2 payment providers:

- `pp_mercadopago-pix_mercadopago`
- `pp_mercadopago-card_mercadopago`

The module is disabled when Mercado Pago credentials are absent, preserving the
existing system-provider runtime. If configuration is started but incomplete,
the application fails during startup instead of running a partially configured
payment flow.

## Configuration

The following environment-variable names are consumed by `medusa-config.ts`:

- `MERCADO_PAGO_ACCESS_TOKEN` (protected secret)
- `MERCADO_PAGO_WEBHOOK_SECRET` (protected secret)
- `MERCADO_PAGO_WEBHOOK_BASE_URL` (public HTTPS backend origin)
- `MERCADO_PAGO_LIVE_MODE` (`true` or `false`; required explicitly)

Do not commit values for protected variables. The provider checks that the
credential mode before the first payment creation/capture and checks that each
remote payment's `live_mode` matches the configured mode before changing a
Medusa payment state. A `TEST-` credential is rejected in live mode. For
`APP_USR-` credentials, `/users/me` is consulted so Mercado Pago test users
(tagged/named as test users) are also distinguished before any charge.

## Payment-session input

Medusa injects `session_id`. API middleware injects the route's authoritative
`payment_collection_id`; the storefront cannot select this stable reference.
The storefront supplies the remaining data when it creates the payment session.

Pix requires:

- `payer_email` when unavailable from the Medusa customer context
- `payer_identification` with `type` and `number`

Card requires:

- `token`, created client-side by Mercado Pago.js or Bricks
- `payment_method_id`
- optional `installments` and `issuer_id`
- `payer_email` when unavailable from the Medusa customer context

Raw card number and security code must never reach this backend.

The provider response explicitly clears the one-time card token, payer email,
and payer identification from the session data persisted after initialization.

## Lifecycle

- Card creation always sends `capture: false`. The remote authorization is
  captured only from Medusa's `capturePayment` lifecycle, after a Medusa
  `Payment` exists.
- Pix remains asynchronous and maps pending states to
  `pending_authorization`, allowing Medusa to create an awaiting-payment order.
- Deleting/canceling an authorization cancels it remotely. If a payment was
  already approved, the provider refunds the remaining captured amount and
  confirms the remote result before allowing deletion.
- If validation after payment creation fails, the provider cancels an
  authorization/pending payment or refunds an approved payment before
  rethrowing the validation failure.

## Webhooks

Mercado Pago notifications use Medusa's built-in payment webhook endpoints:

- `/hooks/payment/mercadopago-pix_mercadopago`
- `/hooks/payment/mercadopago-card_mercadopago`

API middleware copies the official `data.id` query parameter into a normalized
internal field. The provider rejects unsupported topics before signature work,
then validates `x-signature` and `x-request-id`, enforces a replay tolerance,
and retrieves the payment from Mercado Pago. Webhook body status is never used
as the authoritative payment state. Both second and millisecond `ts` formats
are accepted.

The complementary subscriber updates non-success states that Medusa 2.17.2's
core payment subscriber deliberately does not process. Successful authorization
and capture continue through Medusa's native payment workflow.

Refund and chargeback notifications are deliberately not converted into payment
session cancellation. They require a dedicated after-sale reconciliation flow
that creates the corresponding Medusa refund or operational review record.

## Pix polling reconciliation

`src/jobs/mercado-pago-pix-reconciliation.ts` runs every five minutes. It pages
through Pix sessions in `pending_authorization`, retrieves their authoritative
remote state through the provider, handles expired Pix cancellation, and sends
newly captured sessions through Medusa's `processPaymentWorkflow`. Webhooks are
therefore the fast path, not the only reconciliation path. Paid Pix sessions
that still have no linked order after a ten-minute race-safety grace period are
refunded through the Medusa Payment Module, preserving a local refund record as
well as compensating the remote charge.

## Retry and double-charge behavior

- Before creation, the provider searches Mercado Pago by the stable Medusa
  payment-collection reference and reconciles a pre-existing attempt.
- The first active payment attempt uses one deterministic creation key scoped
  to payment collection and operation, even across payment methods. After a
  terminal failure, a new attempt adds its amount/method fingerprint. A lost
  response, concurrent initialization, or session recreation therefore does
  not create a second active payment for the cart, while a genuinely rejected
  card can be retried.
- Amount or method changes while an active remote payment exists are refused.
  A rejected/terminal attempt may be retried with a new card token and therefore
  a new fingerprint.
- Cancellation is confirmed remotely before Medusa deletes the session.
- Refund requires Medusa's unique refund-record ID and validates the returned
  refund ID, payment ID, amount, and successful status. Two legitimate refunds
  of the same value therefore remain distinct.
- Transient HTTP/network failures use bounded exponential backoff. Mutating
  retries carry deterministic Mercado Pago idempotency keys.

## Deferred after-sale scope (M6/M7)

External refunds and chargebacks need a dedicated after-sale reconciliation
workflow/subscriber that creates Medusa refund records (or an operational review
record) idempotently. Mapping those events directly to payment-session
cancellation would corrupt accounting, so that architectural expansion remains
blocked for a separate card. No production subscriber behavior is improvised
here.
