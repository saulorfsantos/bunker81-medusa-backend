import type {
  IPaymentModuleService,
  MedusaContainer,
  PaymentSessionDTO,
} from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import { MERCADO_PAGO_ATTEMPT_MODULE } from "../modules/mercado-pago-attempt"
import {
  AUTO_COMPENSABLE_ORPHAN_STATUSES,
  MERCADO_PAGO_ORPHAN_SEARCH_WINDOW_MS,
  TERMINAL_ORPHAN_STATUSES,
  structuredOrphanEvent,
  type MercadoPagoAttemptStore,
  type StoredMercadoPagoAttempt,
} from "../modules/mercado-pago/attempts"
import { MercadoPagoClient } from "../modules/mercado-pago/client"
import { createIdempotencyKey } from "../modules/mercado-pago/idempotency"
import type {
  MercadoPagoOptions,
  MercadoPagoPayment,
} from "../modules/mercado-pago/types"

type ReconciliationRuntime = {
  client: Pick<
    MercadoPagoClient,
    "searchPayments" | "cancelPayment" | "validateEnvironment"
  >
  liveMode: boolean
  now?: number
}

const INACTIVE_SESSION_STATUSES = new Set<string>([
  PaymentSessionStatus.CANCELED,
  PaymentSessionStatus.ERROR,
])

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {}

const ownsAttempt = (
  payment: MercadoPagoPayment,
  attempt: StoredMercadoPagoAttempt
): boolean => {
  const metadata = toRecord(payment.metadata)
  return (
    payment.external_reference === attempt.payment_collection_id &&
    metadata.payment_session_id === attempt.payment_session_id &&
    metadata.payment_collection_id === attempt.payment_collection_id &&
    metadata.provider_kind === attempt.provider_kind &&
    metadata.request_fingerprint === attempt.request_fingerprint
  )
}

const loadRuntime = (): ReconciliationRuntime | undefined => {
  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN
  const webhookSecret = process.env.MERCADO_PAGO_WEBHOOK_SECRET
  const webhookBaseUrl =
    process.env.MERCADO_PAGO_WEBHOOK_BASE_URL || process.env.MEDUSA_BACKEND_URL
  const liveMode =
    process.env.MERCADO_PAGO_LIVE_MODE === "true"
      ? true
      : process.env.MERCADO_PAGO_LIVE_MODE === "false"
        ? false
        : undefined

  if (!accessToken || !webhookSecret || !webhookBaseUrl || liveMode === undefined) {
    return undefined
  }

  const options: MercadoPagoOptions = {
    accessToken,
    webhookSecret,
    webhookBaseUrl,
    liveMode,
  }
  return { client: new MercadoPagoClient(options), liveMode }
}

const findLiveOwningSession = async (
  paymentModule: IPaymentModuleService,
  attempt: StoredMercadoPagoAttempt,
  paymentId: string
): Promise<PaymentSessionDTO | undefined> => {
  try {
    const session = await paymentModule.retrievePaymentSession(
      attempt.payment_session_id,
      {
        select: [
          "id",
          "amount",
          "currency_code",
          "data",
          "status",
          "payment_collection_id",
        ],
      }
    )
    const data = toRecord(session.data)
    if (
      session.id === attempt.payment_session_id &&
      session.payment_collection_id === attempt.payment_collection_id &&
      data.session_id === attempt.payment_session_id &&
      !INACTIVE_SESSION_STATUSES.has(String(session.status))
    ) {
      return session
    }
  } catch {
    // A create failure can make Medusa remove the session. The attempt survives it.
  }

  const collectionSessions = await paymentModule.listPaymentSessions(
    { payment_collection_id: attempt.payment_collection_id },
    {
      select: ["id", "data", "status", "payment_collection_id"],
      take: 100,
    }
  )
  return collectionSessions.find((session) => {
    const data = toRecord(session.data)
    return (
      data.id === paymentId &&
      data.session_id === session.id &&
      session.payment_collection_id === attempt.payment_collection_id &&
      !INACTIVE_SESSION_STATUSES.has(String(session.status))
    )
  })
}

export async function reconcileMercadoPagoOrphanAttempts(
  container: MedusaContainer,
  suppliedRuntime?: ReconciliationRuntime
) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const runtime = suppliedRuntime || loadRuntime()
  if (!runtime) {
    logger.info("Mercado Pago orphan reconciliation skipped: provider is disabled")
    return
  }

  const attemptStore = container.resolve(
    MERCADO_PAGO_ATTEMPT_MODULE
  ) as MercadoPagoAttemptStore
  const paymentModule: IPaymentModuleService = container.resolve(
    Modules.PAYMENT
  )
  const now = runtime.now ?? Date.now()
  const allAttempts: StoredMercadoPagoAttempt[] = []
  const batchSize = 100

  for (let skip = 0; ; skip += batchSize) {
    const batch = await attemptStore.listMercadoPagoAttempts(
      {},
      { take: batchSize, skip, order: { created_at: "ASC" } }
    )
    allAttempts.push(...batch)
    if (batch.length < batchSize) {
      break
    }
  }

  const dueAttempts = allAttempts.filter((attempt) => {
    if (!["creating", "remote_found"].includes(attempt.state)) {
      return false
    }
    const reconcileAfter = Date.parse(String(attempt.reconcile_after))
    return Number.isFinite(reconcileAfter) && reconcileAfter <= now
  })
  let compensated = 0
  let recovered = 0
  let manualReview = 0
  let notFound = 0
  let failed = 0

  for (const attempt of dueAttempts) {
    try {
      const payments = await runtime.client.searchPayments(
        attempt.payment_collection_id
      )
      const ownedPayments = payments.filter((payment) =>
        ownsAttempt(payment, attempt)
      )

      if (!ownedPayments.length) {
        notFound++
        const createdAt = Date.parse(String(attempt.created_at || ""))
        const searchWindowExpired =
          Number.isFinite(createdAt) &&
          createdAt <= now - MERCADO_PAGO_ORPHAN_SEARCH_WINDOW_MS
        await attemptStore.updateMercadoPagoAttempts({
          id: attempt.id,
          state: searchWindowExpired ? "manual_review" : attempt.state,
          reconciliation_attempts: (attempt.reconciliation_attempts || 0) + 1,
          last_reconciled_at: new Date(now),
          last_error_code: searchWindowExpired
            ? "remote_not_found_after_search_window"
            : "remote_not_yet_indexed",
          ...(searchWindowExpired
            ? { manual_review_at: new Date(now) }
            : {}),
        })
        if (searchWindowExpired) {
          manualReview++
          logger.error(
            structuredOrphanEvent("mercado_pago_orphan_manual_review", {
              reason: "remote_not_found_after_search_window",
              attempt_id: attempt.id,
              payment_session_id: attempt.payment_session_id,
              payment_collection_id: attempt.payment_collection_id,
              provider_kind: attempt.provider_kind,
            })
          )
        }
        continue
      }

      if (ownedPayments.length !== 1) {
        await attemptStore.updateMercadoPagoAttempts({
          id: attempt.id,
          state: "manual_review",
          reconciliation_attempts: (attempt.reconciliation_attempts || 0) + 1,
          last_reconciled_at: new Date(now),
          manual_review_at: new Date(now),
          last_error_code: "multiple_remote_payments_match_attempt",
        })
        manualReview++
        logger.error(
          structuredOrphanEvent("mercado_pago_orphan_manual_review", {
            reason: "multiple_remote_payments_match_attempt",
            attempt_id: attempt.id,
            payment_session_id: attempt.payment_session_id,
            payment_collection_id: attempt.payment_collection_id,
            provider_kind: attempt.provider_kind,
            remote_match_count: ownedPayments.length,
          })
        )
        continue
      }

      const payment = ownedPayments[0]
      const paymentId = String(payment.id)
      await attemptStore.updateMercadoPagoAttempts({
        id: attempt.id,
        state: "remote_found",
        remote_payment_id: paymentId,
        remote_status: payment.status,
        reconciliation_attempts: (attempt.reconciliation_attempts || 0) + 1,
        last_reconciled_at: new Date(now),
        last_error_code: null,
      })

      const owningSession = await findLiveOwningSession(
        paymentModule,
        attempt,
        paymentId
      )
      if (owningSession?.id === attempt.payment_session_id) {
        await paymentModule.updatePaymentSession({
          id: owningSession.id,
          amount: owningSession.amount,
          currency_code: owningSession.currency_code,
          data: owningSession.data || {},
        })
        await attemptStore.updateMercadoPagoAttempts({
          id: attempt.id,
          state: "bound",
          remote_payment_id: paymentId,
          remote_status: payment.status,
          bound_at: new Date(now),
        })
        recovered++
        continue
      }

      if (owningSession) {
        await attemptStore.updateMercadoPagoAttempts({
          id: attempt.id,
          state: "manual_review",
          remote_payment_id: paymentId,
          remote_status: payment.status,
          manual_review_at: new Date(now),
          last_error_code: "remote_payment_bound_to_different_live_session",
        })
        manualReview++
        logger.error(
          structuredOrphanEvent("mercado_pago_orphan_manual_review", {
            reason: "remote_payment_bound_to_different_live_session",
            attempt_id: attempt.id,
            payment_session_id: attempt.payment_session_id,
            payment_collection_id: attempt.payment_collection_id,
            provider_kind: attempt.provider_kind,
            remote_payment_id: paymentId,
            remote_status: payment.status,
            owning_payment_session_id: owningSession.id,
          })
        )
        continue
      }

      if (TERMINAL_ORPHAN_STATUSES.has(payment.status)) {
        await attemptStore.updateMercadoPagoAttempts({
          id: attempt.id,
          state: "resolved_terminal",
          remote_payment_id: paymentId,
          remote_status: payment.status,
        })
        continue
      }

      if (AUTO_COMPENSABLE_ORPHAN_STATUSES.has(payment.status)) {
        await runtime.client.validateEnvironment(runtime.liveMode)
        const canceled = await runtime.client.cancelPayment(
          paymentId,
          createIdempotencyKey({
            stableReference: attempt.payment_collection_id,
            operation: "compensate",
            providerKind: attempt.provider_kind,
            requestFingerprint: attempt.request_fingerprint,
            medusaOperationId: `orphan-${attempt.id}`,
          })
        )
        if (!ownsAttempt(canceled, attempt) || canceled.status !== "cancelled") {
          throw new Error("orphan cancellation was not confirmed")
        }
        await attemptStore.updateMercadoPagoAttempts({
          id: attempt.id,
          state: "compensated",
          remote_payment_id: paymentId,
          remote_status: canceled.status,
          compensated_at: new Date(now),
          last_error_code: null,
        })
        compensated++
        continue
      }

      await attemptStore.updateMercadoPagoAttempts({
        id: attempt.id,
        state: "manual_review",
        remote_payment_id: paymentId,
        remote_status: payment.status,
        manual_review_at: new Date(now),
        last_error_code: "remote_status_not_auto_compensable",
      })
      manualReview++
      logger.error(
        structuredOrphanEvent("mercado_pago_orphan_manual_review", {
          reason: "remote_status_not_auto_compensable",
          attempt_id: attempt.id,
          payment_session_id: attempt.payment_session_id,
          payment_collection_id: attempt.payment_collection_id,
          provider_kind: attempt.provider_kind,
          remote_payment_id: paymentId,
          remote_status: payment.status,
        })
      )
    } catch (error) {
      failed++
      logger.error(
        structuredOrphanEvent("mercado_pago_orphan_reconciliation_failed", {
          attempt_id: attempt.id,
          payment_session_id: attempt.payment_session_id,
          payment_collection_id: attempt.payment_collection_id,
          provider_kind: attempt.provider_kind,
          reason: error instanceof Error ? error.message : "unknown_error",
        })
      )
    }
  }

  logger.info(
    structuredOrphanEvent("mercado_pago_orphan_reconciliation_completed", {
      checked: dueAttempts.length,
      recovered,
      compensated,
      manual_review: manualReview,
      not_found: notFound,
      failed,
    })
  )
}

export default reconcileMercadoPagoOrphanAttempts

export const config = {
  name: "mercado-pago-orphan-reconciliation",
  schedule: "*/5 * * * *",
}
