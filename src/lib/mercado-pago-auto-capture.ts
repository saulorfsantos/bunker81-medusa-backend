import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { capturePaymentWorkflow } from "@medusajs/medusa/core-flows"

export const CARD_PROVIDER = "pp_mercadopago-card_mercadopago"

export { autoCaptureFrom } from "../modules/mercado-pago/auto-capture-config"
import { autoCaptureFrom } from "../modules/mercado-pago/auto-capture-config"

export async function captureMercadoPagoOrder(container: MedusaContainer, orderId: string) {
  const from = autoCaptureFrom()
  if (!from) return 0
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const locking = container.resolve(Modules.LOCKING)

  // Subscriber deliveries and the recovery job share a distributed lock.
  return locking.execute(`bunker-mp-capture:${orderId}`, async () => {
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "status", "is_draft_order", "created_at", "payment_collections.payments.id",
        "payment_collections.payments.provider_id", "payment_collections.payments.captured_at",
        "payment_collections.payments.canceled_at", "payment_collections.payments.captures.id",
        "payment_collections.payments.refunds.id"],
      filters: { id: orderId },
    })
    const order = orders[0]
    if (!order || order.status === "canceled" || order.is_draft_order ||
        !Number.isFinite(new Date(order.created_at).getTime()) ||
        new Date(order.created_at).getTime() < Date.parse(from)) return 0

    let captured = 0
    for (const collection of order.payment_collections || []) {
      for (const payment of collection?.payments || []) {
        if (!payment || payment.provider_id !== CARD_PROVIDER || payment.captured_at || payment.canceled_at ||
            payment.captures?.length || payment.refunds?.length) continue
        // Use Medusa's complete capture lifecycle: provider, ledger and payment event.
        await capturePaymentWorkflow(container).run({ input: { payment_id: payment.id } })
        captured++
        logger.info(`Mercado Pago auto-capture completed order=${orderId} payment=${payment.id}`)
      }
    }
    return captured
  }, { timeout: 120 })
}
