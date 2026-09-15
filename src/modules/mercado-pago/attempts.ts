import { createHash } from "node:crypto"
import type { MercadoPagoProviderKind } from "./types"

export const MERCADO_PAGO_ORPHAN_GRACE_PERIOD_MS = 10 * 60 * 1000
export const MERCADO_PAGO_ORPHAN_SEARCH_WINDOW_MS = 24 * 60 * 60 * 1000

export const AUTO_COMPENSABLE_ORPHAN_STATUSES = new Set([
  "in_mediation",
  "in_process",
  "pending",
])

export const TERMINAL_ORPHAN_STATUSES = new Set([
  "cancelled",
  "charged_back",
  "expired",
  "refunded",
  "rejected",
])

export type TrustedThreeDsInfo = {
  external_resource_url: string
  creq: string
}

export type MercadoPagoAttemptState =
  | "creating"
  | "bound"
  | "remote_found"
  | "compensated"
  | "resolved_terminal"
  | "manual_review"

export type StoredMercadoPagoAttempt = {
  id: string
  payment_session_id: string
  payment_collection_id: string
  provider_kind: MercadoPagoProviderKind
  request_fingerprint: string
  idempotency_key: string
  amount: unknown
  currency_code: string
  state: MercadoPagoAttemptState
  reconcile_after: Date | string
  remote_payment_id?: string | null
  remote_status?: string | null
  three_ds_info?: TrustedThreeDsInfo | Record<string, unknown> | null
  last_error_code?: string | null
  reconciliation_attempts?: number
  last_reconciled_at?: Date | string | null
  bound_at?: Date | string | null
  compensated_at?: Date | string | null
  manual_review_at?: Date | string | null
  created_at?: Date | string
  updated_at?: Date | string
}

export type MercadoPagoAttemptStore = {
  listMercadoPagoAttempts: (
    filters?: Record<string, unknown>,
    config?: Record<string, unknown>
  ) => Promise<StoredMercadoPagoAttempt[]>
  retrieveMercadoPagoAttempt: (
    id: string,
    config?: Record<string, unknown>
  ) => Promise<StoredMercadoPagoAttempt>
  createMercadoPagoAttempts: (
    data: Record<string, unknown>
  ) => Promise<StoredMercadoPagoAttempt>
  updateMercadoPagoAttempts: (
    data: Record<string, unknown>
  ) => Promise<StoredMercadoPagoAttempt>
}

export const createAttemptId = (input: {
  sessionId: string
  providerKind: MercadoPagoProviderKind
  requestFingerprint: string
}): string => {
  const digest = createHash("sha256")
    .update(
      `${input.sessionId}\u0000${input.providerKind}\u0000${input.requestFingerprint}`,
      "utf8"
    )
    .digest("hex")
    .slice(0, 32)

  return `mpatt_${digest}`
}

export const structuredOrphanEvent = (
  event: string,
  fields: Record<string, unknown>
): string => JSON.stringify({ event, ...fields })
