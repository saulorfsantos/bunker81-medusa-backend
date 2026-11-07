import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { readResendConfig } from "../modules/resend/config"
import type { OrderEmailData } from "../modules/resend/service"

// The PDV fills checkout with this placeholder when the buyer gives no email.
const PDV_PLACEHOLDER = /^pdv-[^@]*@bunker81\.com\.br$/i

/** Pedido com os dados que os e-mails mostram; compartilhado pelos avisos de separado e enviado. */
export async function lerPedido(container: SubscriberArgs<unknown>["container"], orderId: string) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: [order] } = await query.graph({
    entity: "order",
    fields: [
      "id", "display_id", "email", "total", "metadata",
      "items.title", "items.quantity", "items.unit_price", "items.total",
      "shipping_address.first_name", "shipping_address.last_name",
    ],
    filters: { id: orderId },
  })
  if (!order) throw new Error(`Order ${orderId} not found for email`)

  const pdv = (order.metadata as Record<string, unknown> | null)?.origem === "PDV"
  const nome = [order.shipping_address?.first_name, order.shipping_address?.last_name]
    .filter(Boolean).join(" ") || "cliente"
  const payload: OrderEmailData = {
    id: order.id,
    display_id: order.display_id!,
    customer_name: nome,
    email: order.email ?? "",
    total: Number(order.total),
    items: (order.items ?? []).filter(Boolean).map((item) => ({
      title: item!.title,
      quantity: Number(item!.quantity),
      total: Number(item!.total ?? Number(item!.unit_price) * Number(item!.quantity)),
    })),
  }

  return { order, payload, pdv }
}

export function emailDoCliente(email: string | null | undefined) {
  return email && !PDV_PLACEHOLDER.test(email) ? email : null
}

export default async function orderPlacedEmail({ event: { data }, container }: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  if (!readResendConfig(process.env)) {
    logger.warn(`Order email skipped for ${data.id}: Resend is not configured`)
    return
  }

  const { order, payload, pdv } = await lerPedido(container, data.id)

  const envios: { to: string; template: string }[] = []
  const cliente = emailDoCliente(order.email)
  if (cliente) envios.push({ to: cliente, template: "order-placed-customer" })
  // Counter sales are made by the staff themselves; only online orders alert the shop.
  const equipe = process.env.ORDER_NOTIFY_EMAIL?.trim()
  if (equipe && !pdv) envios.push({ to: equipe, template: "order-placed-admin" })
  if (!envios.length) return

  const notifications = container.resolve(Modules.NOTIFICATION)
  await notifications.createNotifications(
    envios.map((envio) => ({ ...envio, channel: "email", data: payload }))
  )
}

export const config: SubscriberConfig = {
  event: "order.placed",
  context: { subscriberId: "bunker-order-placed-email" },
}
