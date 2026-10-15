import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { autoCaptureFrom, CARD_PROVIDER, captureMercadoPagoOrder } from "../lib/mercado-pago-auto-capture"

export default async function recoverCardCaptures(container: MedusaContainer) {
  const from = autoCaptureFrom()
  if (!from) return
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  // Recover recent failures, not stale authorizations indefinitely.
  const since = new Date(Math.max(Date.parse(from), Date.now() - 24 * 60 * 60 * 1000)).toISOString()
  const candidates: { id: string; payment_collection_id: string }[] = []
  for (let skip = 0; ; skip += 100) {
    const { data } = await query.graph({
      entity: "payment",
      fields: ["id", "payment_collection_id"],
      filters: { provider_id: CARD_PROVIDER, captured_at: null, canceled_at: null, created_at: { $gte: since } },
      pagination: { skip, take: 100, order: { id: "ASC" } },
    })
    candidates.push(...data)
    if (data.length < 100) break
  }
  const seen = new Set<string>()
  for (const payment of candidates) {
    const { data: links } = await query.graph({
      entity: "order_payment_collection",
      fields: ["order_id"],
      filters: { payment_collection_id: payment.payment_collection_id },
    })
    // Never capture a payment without a unique persisted order.
    if (links.length !== 1 || seen.has(links[0].order_id)) continue
    const orderId = links[0].order_id
    seen.add(orderId)
    try {
      await captureMercadoPagoOrder(container, orderId)
    } catch {
      logger.error(`Mercado Pago auto-capture recovery failed order=${orderId}; manual review required if it persists`)
    }
  }
}

export const config = { name: "mercado-pago-card-auto-capture", schedule: "*/2 * * * *" }
