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
- `MERCADO_PAGO_WEBHOOK_BASE_URL` (public HTTPS backend origin), or
  `MEDUSA_BACKEND_URL` as its explicit fallback
- `MERCADO_PAGO_LIVE_MODE` (`true` or `false`; required explicitly)

Do not commit values for protected variables. The provider checks that the
credential mode before the first payment creation/capture and checks that each
remote payment's `live_mode` matches the configured mode before changing a
Medusa payment state. A `TEST-` credential is rejected in live mode. For
`APP_USR-` credentials, `/users/me` is consulted so Mercado Pago test users
(tagged/named as test users) are also distinguished before any charge.

## Required production migration and existing-region backfill

The provider must not be enabled in a running application until both the custom
module migrations and the existing-region backfill have completed. With the
application stopped, run these commands from the exact release artifact in a
controlled one-shot process that has the final Mercado Pago configuration:

```sh
npm run db:migrate
npm run mp:backfill-region
```

`db:migrate` creates/upgrades `mercado_pago_attempt`, which is required before
the provider can persist a remote-create attempt. `mp:backfill-region` does not
create a region. It requires exactly one existing region whose currency is BRL
and whose countries include `br`; zero or multiple matches abort without a
mutation. It preserves every current payment-provider link and adds:

- `pp_mercadopago-pix_mercadopago`
- `pp_mercadopago-card_mercadopago`

The backfill is idempotent: once both links exist, another execution makes no
change. The provider module must be registered in the one-shot process so the
Medusa workflow can validate both provider IDs. Only after both commands
succeed should the application be started with the provider enabled. Do not
use the initial seed to update an existing production region, and do not run
either command against production as part of local validation or review.

## Payment-session input

Medusa injects `session_id`. API middleware injects the route's authoritative
`payment_collection_id`; the storefront cannot select this stable reference.
The provider still retrieves the payment session from the Payment Module before
any Mercado Pago request and derives the collection from that stored session.
Missing sessions and a body/route collection mismatch fail closed before the
provider validates credentials, searches, or creates a remote payment.
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
- Every attempt uses one deterministic creation key scoped to the authoritative
  session, provider, and request fingerprint. Retries of that exact attempt
  reuse its key; a new card token, payment method, or Medusa session creates a
  separately owned attempt. An unresolved attempt never blocks an unrelated
  attempt for the same collection.
- Amount or method changes while an active remote payment exists are refused.
  A rejected/terminal attempt may be retried with a new card token and therefore
  a new fingerprint.
- Cancellation is confirmed remotely before Medusa deletes the session.
- Refund requires Medusa's unique refund-record ID and validates the returned
  refund ID, payment ID, amount, and successful status. Two legitimate refunds
  of the same value therefore remain distinct.
- Transient HTTP/network failures use bounded exponential backoff. Mutating
  retries carry deterministic Mercado Pago idempotency keys.

## Lost create responses and orphan attempts

Before the remote create call, the provider writes a deterministic
`mercado_pago_attempt` record. Its ownership tuple is the Medusa payment-session
ID, authoritative payment-collection ID, provider kind, and request fingerprint.
The fingerprint is only an integrity attribute and is never sufficient to adopt
a payment. A retry uses the same attempt ID and Mercado Pago idempotency key.

If create may have succeeded but both its response and the immediate search are
empty, the provider leaves the durable attempt in `creating` and fails the
request. A five-minute Medusa job searches due attempts after a **10-minute
grace period**, long enough for delayed Mercado Pago search indexing without
blocking Pix fallback or a new-token card retry. A definitive non-retryable HTTP
create rejection immediately moves the attempt to `resolved_terminal`; only
ambiguous transport/retryable failures become orphan candidates.

The job asks the database only for `creating`/`remote_found` attempts whose
`reconcile_after` is due. It handles at most three batches of 100 rows per run
and does not retain prior batches. Empty searches advance `reconcile_after`
with bounded exponential delays of 5, 10, 20, 40, 80, 160, then at most 240
minutes, capped at the attempt's 24-hour search deadline. There are no sleeps;
the scheduled job performs the later query. At the deadline the attempt moves
to `manual_review`, so polling cannot continue indefinitely.

When the original session is still live, the job drives the normal Payment
Module update so the strictly matching remote payment is bound to that session.
When the session is gone, only `pending`, `in_process`, and `in_mediation` are
auto-canceled. Cancellation uses a deterministic idempotency key and is recorded
once. `authorized`, `approved` (paid), ambiguous/multiple matches, and unknown
states are never canceled or refunded automatically; they produce a sanitized
`mercado_pago_orphan_manual_review` JSON log containing only local/remote IDs,
provider, collection, status, and reason. Operations must reconcile those cases
against the Medusa order/payment state before acting.

### Manual-review operator command

This is an internal Medusa exec command, not a Store API endpoint. It only
changes the local attempt record and never calls Mercado Pago or changes a
remote payment:

```sh
npm run mp:manual-review -- list
npm run mp:manual-review -- resolve --attempt-id mpatt_... --reviewed-by operator-id --note "ledger checked"
```

`resolve` requires the exact attempt ID and operator identity, is idempotent,
and moves only `manual_review` to `reviewed`. The audit fields `reviewed_at`,
`reviewed_by`, and `review_note` plus a structured log record the action. Lists
and logs omit 3DS continuation data. An old `manual_review`/`reviewed` attempt
does not block a different session, provider, or request fingerprint.

A late orphan webhook is matched to the durable attempt using the complete
ownership tuple and recorded for the job, but returns `NOT_SUPPORTED` to the
Payment Module when no live owning session exists. It is never adopted by a
different session.

## 3DS trust boundary

Client-supplied `three_ds_info`, including `external_resource_url` and `creq`,
is never a continuation source. A challenge is returned only when it is present
in a validated Mercado Pago payment response or in the durable attempt record
for the same session, provider, fingerprint, and remote payment. The latter
supports later GET/search responses that omit or return null challenge fields.
Missing continuation for `pending_challenge` is a controlled contract error,
and challenge URLs must remain credential-free HTTPS URLs.
Persisted continuation data is cleared when an attempt becomes terminal,
compensated, or operator-reviewed; pending-challenge recovery remains intact.

## Deferred after-sale scope (M6/M7)

External refunds and chargebacks need a dedicated after-sale reconciliation
workflow/subscriber that creates Medusa refund records (or an operational review
record) idempotently. Mapping those events directly to payment-session
cancellation would corrupt accounting, so that architectural expansion remains
blocked for a separate card. No production subscriber behavior is improvised
here.
