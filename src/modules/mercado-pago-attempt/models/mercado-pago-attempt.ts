import { model } from "@medusajs/framework/utils"

const MercadoPagoAttempt = model
  .define("mercado_pago_attempt", {
    id: model.id().primaryKey(),
    payment_session_id: model.text(),
    payment_collection_id: model.text(),
    provider_kind: model.enum(["pix", "card"]),
    request_fingerprint: model.text(),
    idempotency_key: model.text(),
    amount: model.bigNumber(),
    currency_code: model.text(),
    state: model.enum([
      "creating",
      "bound",
      "remote_found",
      "compensated",
      "resolved_terminal",
      "manual_review",
      "reviewed",
    ]),
    reconcile_after: model.dateTime(),
    remote_payment_id: model.text().nullable(),
    remote_status: model.text().nullable(),
    three_ds_info: model.json().nullable(),
    last_error_code: model.text().nullable(),
    reconciliation_attempts: model.number().default(0),
    last_reconciled_at: model.dateTime().nullable(),
    bound_at: model.dateTime().nullable(),
    compensated_at: model.dateTime().nullable(),
    manual_review_at: model.dateTime().nullable(),
    reviewed_at: model.dateTime().nullable(),
    reviewed_by: model.text().nullable(),
    review_note: model.text().nullable(),
  })
  .indexes([
    {
      name: "IDX_mp_attempt_collection_state",
      on: ["payment_collection_id", "state"],
    },
    {
      name: "IDX_mp_attempt_reconcile_after",
      on: ["state", "reconcile_after"],
    },
    {
      name: "IDX_mp_attempt_remote_payment",
      on: ["remote_payment_id"],
    },
  ])

export default MercadoPagoAttempt
