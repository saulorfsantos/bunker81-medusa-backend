import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { captureMercadoPagoOrder } from "../lib/mercado-pago-auto-capture"

export default async function captureCardAfterOrder({ event: { data }, container }: SubscriberArgs<{ id: string }>) {
  try {
    await captureMercadoPagoOrder(container, data.id)
  } catch {
    container.resolve(ContainerRegistrationKeys.LOGGER).error(
      `Mercado Pago auto-capture failed order=${data.id}; queued retries and recovery job will retry`
    )
    // Do not acknowledge a failed financial operation as successful.
    throw new Error(`Mercado Pago auto-capture failed for order ${data.id}`)
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
  context: { subscriberId: "bunker-mercado-pago-auto-capture" },
}
