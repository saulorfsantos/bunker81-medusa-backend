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
- `MERCADO_PAGO_LIVE_MODE` (`false` for sandbox; defaults to `false`)

Do not commit values for protected variables. The provider checks that the
remote payment's `live_mode` matches the configured mode before changing a
Medusa payment state.

## Payment-session input

Medusa injects `session_id`. The storefront supplies the remaining data when it
creates the payment session.

Pix requires:

- `payer_email` when unavailable from the Medusa customer context
- `payer_identification` with `type` and `number`

Card requires:

- `token`, created client-side by Mercado Pago.js or Bricks
- `payment_method_id`
- optional `installments` and `issuer_id`
- `payer_email` when unavailable from the Medusa customer context

Raw card number and security code must never reach this backend.

## Webhooks

Mercado Pago notifications use Medusa's built-in payment webhook endpoints:

- `/hooks/payment/mercadopago-pix_mercadopago`
- `/hooks/payment/mercadopago-card_mercadopago`

The provider validates `x-signature` and `x-request-id`, enforces a replay
tolerance, then retrieves the payment from Mercado Pago. Webhook body status is
never used as the authoritative payment state.

The complementary subscriber updates non-success states that Medusa 2.17.2's
core payment subscriber deliberately does not process. Successful authorization
and capture continue through Medusa's native payment workflow.

Refund and chargeback notifications are deliberately not converted into payment
session cancellation. They require a dedicated after-sale reconciliation flow
that creates the corresponding Medusa refund or operational review record.

## Retry and double-charge behavior

- Payment creation uses a deterministic key scoped to payment session,
  operation, and provider kind.
- A transport retry for the same payment session therefore cannot create a
  second payment.
- Amount changes on an existing remote payment are refused. The caller must
  cancel/delete that session and create a new Medusa payment session.
- Cancellation is confirmed remotely before Medusa deletes the session.
- Refund and cancellation use separate deterministic idempotency keys.
- Card payments use automatic capture; `capturePayment` never submits a second
  capture operation.
