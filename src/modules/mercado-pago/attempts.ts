import { createHash } from "node:crypto"
import type { MercadoPagoProviderKind } from "./types"

export const MERCADO_PAGO_ORPHAN_GRACE_PERIOD_MS = 10 * 60 * 1000
export const MERCADO_PAGO_ORPHAN_SEARCH_WINDOW_MS = 24 * 60 * 60 * 1000
export const MERCADO_PAGO_RECONCILIATION_BATCH_SIZE = 100
export const MERCADO_PAGO_RECONCILIATION_MAX_BATCHES = 3
export const MERCADO_PAGO_RECONCILIATION_BASE_BACKOFF_MS = 5 * 60 * 1000
export const MERCADO_PAGO_RECONCILIATION_MAX_BACKOFF_MS = 4 * 60 * 60 * 1000

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
  | "reviewed"

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
  reviewed_at?: Date | string | null
  reviewed_by?: string | null
  review_note?: string | null
  created_at?: Date | string
  updated_at?: Date | string
}

export const isNotFoundError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false
  }

  const candidate = error as {
    type?: unknown
    code?: unknown
    status?: unknown
    statusCode?: unknown
  }
  return (
    candidate.type === "not_found" ||
    candidate.code === "not_found" ||
    candidate.status === 404 ||
    candidate.statusCode === 404
  )
}

export const nextReconciliationAfter = (input: {
  now: number
  createdAt: Date | string | undefined
  reconciliationAttempts: number | undefined
}): Date => {
  const attempts = Math.max(0, input.reconciliationAttempts || 0)
  const delay = Math.min(
    MERCADO_PAGO_RECONCILIATION_BASE_BACKOFF_MS * 2 ** attempts,
    MERCADO_PAGO_RECONCILIATION_MAX_BACKOFF_MS
  )
  const createdAt = Date.parse(String(input.createdAt || ""))
  const searchDeadline = Number.isFinite(createdAt)
    ? createdAt + MERCADO_PAGO_ORPHAN_SEARCH_WINDOW_MS
    : input.now + MERCADO_PAGO_RECONCILIATION_BASE_BACKOFF_MS

  return new Date(Math.min(input.now + delay, searchDeadline))
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
