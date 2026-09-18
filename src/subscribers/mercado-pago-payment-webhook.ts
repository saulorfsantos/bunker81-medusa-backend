import type {
  IPaymentModuleService,
  ProviderWebhookPayload,
} from "@medusajs/framework/types"
import type {
  SubscriberArgs,
  SubscriberConfig,
} from "@medusajs/framework"
import {
  Modules,
  PaymentActions,
  PaymentSessionStatus,
  PaymentWebhookEvents,
} from "@medusajs/framework/utils"

const MERCADO_PAGO_PROVIDERS = new Set([
  "mercadopago-pix_mercadopago",
  "mercadopago-card_mercadopago",
])

const actionToSessionStatus = (
  action: string
): PaymentSessionStatus | undefined => {
  switch (action) {
    case PaymentActions.PENDING_AUTHORIZATION:
      return PaymentSessionStatus.PENDING_AUTHORIZATION
    case PaymentActions.PENDING:
      return PaymentSessionStatus.PENDING
    case PaymentActions.REQUIRES_MORE:
      return PaymentSessionStatus.REQUIRES_MORE
    case PaymentActions.FAILED:
      return PaymentSessionStatus.ERROR
    case PaymentActions.CANCELED:
      return PaymentSessionStatus.CANCELED
    default:
      return undefined
  }
}

export default async function mercadoPagoPaymentWebhookHandler({
  event,
  container,
}: SubscriberArgs<ProviderWebhookPayload>) {
  if (!MERCADO_PAGO_PROVIDERS.has(event.data.provider)) {
    return
  }

  const paymentModule: IPaymentModuleService = container.resolve(
    Modules.PAYMENT
  )
  const processedEvent = await paymentModule.getWebhookActionAndData(event.data)
  const sessionId = processedEvent.data?.session_id
  const targetStatus = actionToSessionStatus(processedEvent.action)

  if (!sessionId || !targetStatus) {
    return
  }

  const session = await paymentModule.retrievePaymentSession(sessionId, {
    select: ["id", "amount", "currency_code", "data", "status"],
  })

  if (session.status === targetStatus) {
    return
  }

  await paymentModule.updatePaymentSession({
    id: session.id,
    amount: session.amount,
    currency_code: session.currency_code,
    data: session.data || {},
    status: targetStatus,
  })
}

export const config: SubscriberConfig = {
  event: PaymentWebhookEvents.WebhookReceived,
  context: {
    subscriberId: "mercado-pago-payment-webhook-reconciliation",
  },
}
