import {
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"

export const mapMercadoPagoStatus = (status: string): PaymentSessionStatus => {
  switch (status) {
    case "approved":
      return PaymentSessionStatus.CAPTURED
    case "authorized":
      return PaymentSessionStatus.AUTHORIZED
    case "in_mediation":
    case "in_process":
    case "pending":
      return PaymentSessionStatus.PENDING_AUTHORIZATION
    case "rejected":
      return PaymentSessionStatus.ERROR
    case "cancelled":
    case "charged_back":
    case "expired":
    case "refunded":
      return PaymentSessionStatus.CANCELED
    default:
      return PaymentSessionStatus.PENDING
  }
}

export const mapMercadoPagoWebhookAction = (
  status: string
): PaymentActions => {
  switch (status) {
    case "approved":
      return PaymentActions.SUCCESSFUL
    case "authorized":
      return PaymentActions.AUTHORIZED
    case "in_mediation":
    case "in_process":
    case "pending":
      return PaymentActions.PENDING_AUTHORIZATION
    case "rejected":
      return PaymentActions.FAILED
    case "cancelled":
    case "expired":
      return PaymentActions.CANCELED
    case "charged_back":
    case "refunded":
      return PaymentActions.NOT_SUPPORTED
    default:
      return PaymentActions.NOT_SUPPORTED
  }
}
