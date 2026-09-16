import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { MERCADO_PAGO_ATTEMPT_MODULE } from "../modules/mercado-pago-attempt"
import {
  structuredOrphanEvent,
  type MercadoPagoAttemptStore,
  type StoredMercadoPagoAttempt,
} from "../modules/mercado-pago/attempts"

const LIST_BATCH_SIZE = 100
const LIST_MAX_BATCHES = 10

type ReviewLogger = {
  info: (message: string) => void
}

type ReviewResult = {
  attempt: StoredMercadoPagoAttempt
  changed: boolean
}

const requiredFlag = (args: string[], name: string): string => {
  const equalsPrefix = `${name}=`
  const equalsValue = args.find((arg) => arg.startsWith(equalsPrefix))
  const position = args.indexOf(name)
  const value = equalsValue?.slice(equalsPrefix.length) || args[position + 1]
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} is required`)
  }
  return value
}

const optionalFlag = (args: string[], name: string): string | undefined => {
  const equalsPrefix = `${name}=`
  const equalsValue = args.find((arg) => arg.startsWith(equalsPrefix))
  const position = args.indexOf(name)
  const value = equalsValue?.slice(equalsPrefix.length) || args[position + 1]
  return value && !value.startsWith("--") ? value : undefined
}

export const listManualReviewAttempts = async (
  store: MercadoPagoAttemptStore,
  logger: ReviewLogger
): Promise<number> => {
  let listed = 0

  for (let page = 0; page < LIST_MAX_BATCHES; page++) {
    const attempts = await store.listMercadoPagoAttempts(
      { state: "manual_review" },
      {
        take: LIST_BATCH_SIZE,
        skip: page * LIST_BATCH_SIZE,
        order: { created_at: "ASC", payment_session_id: "ASC" },
      }
    )

    for (const attempt of attempts) {
      logger.info(
        structuredOrphanEvent("mercado_pago_manual_review_attempt", {
          attempt_id: attempt.id,
          payment_session_id: attempt.payment_session_id,
          payment_collection_id: attempt.payment_collection_id,
          provider_kind: attempt.provider_kind,
          remote_payment_id: attempt.remote_payment_id || null,
          remote_status: attempt.remote_status || null,
          reason: attempt.last_error_code || null,
          manual_review_at: attempt.manual_review_at || null,
        })
      )
    }

    listed += attempts.length
    if (attempts.length < LIST_BATCH_SIZE) {
      break
    }
  }

  logger.info(
    structuredOrphanEvent("mercado_pago_manual_review_list_completed", {
      listed,
      truncated: listed === LIST_BATCH_SIZE * LIST_MAX_BATCHES,
    })
  )
  return listed
}

export const resolveManualReviewAttempt = async (
  store: MercadoPagoAttemptStore,
  logger: ReviewLogger,
  input: { attemptId: string; reviewedBy: string; note?: string }
): Promise<ReviewResult> => {
  const attempt = await store.retrieveMercadoPagoAttempt(input.attemptId)

  if (attempt.state === "reviewed") {
    logger.info(
      structuredOrphanEvent("mercado_pago_manual_review_already_resolved", {
        attempt_id: attempt.id,
        reviewed_by: attempt.reviewed_by || null,
        reviewed_at: attempt.reviewed_at || null,
      })
    )
    return { attempt, changed: false }
  }

  if (attempt.state !== "manual_review") {
    throw new Error(
      `Attempt ${input.attemptId} is ${attempt.state}, not manual_review`
    )
  }

  const reviewedBy = input.reviewedBy.trim()
  if (!reviewedBy || reviewedBy.length > 200) {
    throw new Error("--reviewed-by must contain 1 to 200 characters")
  }
  const note = input.note?.trim()
  if (note && note.length > 1000) {
    throw new Error("--note must contain at most 1000 characters")
  }

  const reviewedAt = new Date()
  const updated = await store.updateMercadoPagoAttempts({
    id: attempt.id,
    state: "reviewed",
    reviewed_at: reviewedAt,
    reviewed_by: reviewedBy,
    review_note: note || null,
    three_ds_info: null,
  })
  logger.info(
    structuredOrphanEvent("mercado_pago_manual_review_resolved", {
      attempt_id: attempt.id,
      payment_session_id: attempt.payment_session_id,
      payment_collection_id: attempt.payment_collection_id,
      provider_kind: attempt.provider_kind,
      remote_payment_id: attempt.remote_payment_id || null,
      remote_status: attempt.remote_status || null,
      reviewed_by: reviewedBy,
      reviewed_at: reviewedAt.toISOString(),
      note_present: Boolean(note),
      remote_action_performed: false,
    })
  )

  return { attempt: updated, changed: true }
}

export default async function mercadoPagoManualReview({ container }: ExecArgs) {
  const store = container.resolve(
    MERCADO_PAGO_ATTEMPT_MODULE
  ) as MercadoPagoAttemptStore
  const logger = container.resolve(
    ContainerRegistrationKeys.LOGGER
  ) as ReviewLogger
  const args = process.argv.slice(2)

  if (args.includes("list")) {
    await listManualReviewAttempts(store, logger)
    return
  }

  if (args.includes("resolve")) {
    await resolveManualReviewAttempt(store, logger, {
      attemptId: requiredFlag(args, "--attempt-id"),
      reviewedBy: requiredFlag(args, "--reviewed-by"),
      note: optionalFlag(args, "--note"),
    })
    return
  }

  throw new Error(
    "Usage: npm run mp:manual-review -- list | resolve --attempt-id <id> --reviewed-by <operator> [--note <text>]"
  )
}
