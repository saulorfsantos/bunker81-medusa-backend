import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { readResendConfig } from "../modules/resend/config"
import { emailDoCliente, lerPedido } from "./order-placed-email"

type StatusEvent =
  | { order_id: string; fulfillment_id: string; no_notification?: boolean } // order.fulfillment_created
  | { id: string; no_notification?: boolean } // shipment.created (id = fulfillment)

/** Avisa o cliente quando o pedido é separado e quando é postado (com o rastreio). */
export default async function orderStatusEmail({ event: { name, data }, container }: SubscriberArgs<StatusEvent>) {
  if (data.no_notification || !readResendConfig(process.env)) return

  const fulfillmentId = "fulfillment_id" in data ? data.fulfillment_id : data.id
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: [fulfillment] } = await query.graph({
    entity: "fulfillment",
    fields: ["id", "labels.tracking_number", "labels.tracking_url", "order.id"],
    filters: { id: fulfillmentId },
  })
  const orderId = "order_id" in data ? data.order_id : fulfillment?.order?.id
  if (!orderId) throw new Error(`Order not found for fulfillment ${fulfillmentId}`)

  const { order, payload, pdv } = await lerPedido(container, orderId)
  const cliente = emailDoCliente(order.email)
  if (pdv || !cliente) return // venda de balcão sai na hora, sem separação nem envio

  const label = fulfillment?.labels?.[0]
  await container.resolve(Modules.NOTIFICATION).createNotifications({
    to: cliente,
    channel: "email",
    template: name === "shipment.created" ? "order-shipped-customer" : "order-fulfilled-customer",
    data: {
      ...payload,
      ref: fulfillmentId,
      tracking_number: label?.tracking_number ?? undefined,
      tracking_url: label?.tracking_url ?? undefined,
    },
  })
}

export const config: SubscriberConfig = {
  event: ["order.fulfillment_created", "shipment.created"],
  context: { subscriberId: "bunker-order-status-email" },
}
