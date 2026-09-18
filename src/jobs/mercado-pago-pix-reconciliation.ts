import type {
  IPaymentModuleService,
  MedusaContainer,
  PaymentSessionDTO,
} from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import { processPaymentWorkflow } from "@medusajs/medusa/core-flows"

const PIX_PROVIDER_ID = "pp_mercadopago-pix_mercadopago"
const ORPHAN_GRACE_PERIOD_MS = 10 * 60 * 1000

const toNumber = (value: unknown): number => {
  if (typeof value === "number" || typeof value === "string") {
    return Number(value)
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    if (typeof record.numeric === "number") {
      return record.numeric
    }
  }

  return Number.NaN
}

export default async function reconcilePendingMercadoPagoPix(
  container: MedusaContainer
) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const paymentModule: IPaymentModuleService = container.resolve(
    Modules.PAYMENT
  )
  const allSessions: PaymentSessionDTO[] = []
  const batchSize = 100

  for (let skip = 0; ; skip += batchSize) {
    const batch = await paymentModule.listPaymentSessions(
      { provider_id: PIX_PROVIDER_ID },
      {
        select: [
          "id",
          "amount",
          "currency_code",
          "data",
          "status",
          "provider_id",
          "payment_collection_id",
          "updated_at",
        ],
        take: batchSize,
        skip,
      }
    )

    allSessions.push(...batch)

    if (batch.length < batchSize) {
      break
    }
  }

  let reconciled = 0
  let failed = 0
  let compensated = 0
  const pendingSessions = allSessions.filter(
    (session) => session.status === PaymentSessionStatus.PENDING_AUTHORIZATION
  )

  for (const session of pendingSessions) {
    try {
      const updated = await paymentModule.updatePaymentSession({
        id: session.id,
        amount: session.amount,
        currency_code: session.currency_code,
        data: session.data,
      })

      if (updated.status === PaymentSessionStatus.CAPTURED) {
        await processPaymentWorkflow(container).run({
          input: {
            action: PaymentActions.SUCCESSFUL,
            data: {
              session_id: updated.id,
              amount: updated.amount,
            },
          },
        })
      }

      if (updated.status !== PaymentSessionStatus.PENDING_AUTHORIZATION) {
        reconciled++
      }
    } catch (error) {
      failed++
      const message = error instanceof Error ? error.message : "unknown error"
      logger.error(
        `Mercado Pago Pix reconciliation failed for session ${session.id}: ${message}`
      )
    }
  }

  const orphanCandidates = allSessions.filter((session) => {
    if (
      session.status !== PaymentSessionStatus.AUTHORIZED &&
      session.status !== PaymentSessionStatus.CAPTURED
    ) {
      return false
    }

    const updatedAt = new Date(session.updated_at).getTime()
    return (
      Number.isFinite(updatedAt) &&
      updatedAt <= Date.now() - ORPHAN_GRACE_PERIOD_MS
    )
  })

  for (const session of orphanCandidates) {
    try {
      const { data: cartLinks } = await query.graph({
        entity: "cart_payment_collection",
        fields: ["cart_id"],
        filters: { payment_collection_id: session.payment_collection_id },
      })

      if (!cartLinks.length) {
        continue
      }

      const { data: orderLinks } = await query.graph({
        entity: "order_cart",
        fields: ["id"],
        filters: { cart_id: cartLinks.map((link) => link.cart_id) },
      })

      if (orderLinks.length) {
        continue
      }

      const detailedSession = await paymentModule.retrievePaymentSession(
        session.id,
        { relations: ["payment", "payment.refunds"] }
      )
      const payment = detailedSession.payment

      if (!payment) {
        throw new Error("captured Pix has no Medusa Payment record")
      }

      const amount = toNumber(payment.amount)
      const refundedAmount = toNumber(payment.refunded_amount || 0)
      const remainingAmount = amount - refundedAmount

      if (!Number.isFinite(remainingAmount) || remainingAmount < 0) {
        throw new Error("captured Pix has invalid Medusa payment totals")
      }

      if (remainingAmount > 0) {
        await paymentModule.refundPayment({
          payment_id: payment.id,
          amount: remainingAmount,
          note: "Automatic compensation: captured Pix without an order",
          metadata: { source: "mercado-pago-pix-reconciliation" },
        })
        compensated++
      }
    } catch (error) {
      failed++
      const message = error instanceof Error ? error.message : "unknown error"
      logger.error(
        `Mercado Pago Pix orphan compensation failed for session ${session.id}: ${message}`
      )
    }
  }

  logger.info(
    `Mercado Pago Pix reconciliation checked=${pendingSessions.length} reconciled=${reconciled} compensated=${compensated} failed=${failed}`
  )
}

export const config = {
  name: "mercado-pago-pix-reconciliation",
  schedule: "*/5 * * * *",
}
