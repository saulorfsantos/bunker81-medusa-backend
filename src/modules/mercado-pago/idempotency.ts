import { createHash } from "node:crypto"

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex")

export const createPaymentFingerprint = (input: {
  amount: number
  currencyCode: string
  providerKind: string
  paymentMethodId: string
  token?: string
  installments?: number
  issuerId?: number
}): string => {
  const tokenFingerprint = input.token ? hash(input.token) : undefined

  return hash(
    JSON.stringify({
      amount: input.amount,
      currency_code: input.currencyCode.toLowerCase(),
      provider_kind: input.providerKind,
      payment_method_id: input.paymentMethodId,
      token_fingerprint: tokenFingerprint,
      installments: input.installments,
      issuer_id: input.issuerId,
    })
  )
}

export const createIdempotencyKey = (input: {
  paymentSessionId: string
  operation: "create" | "cancel" | "refund"
  providerKind: string
  requestFingerprint?: string
  medusaOperationId?: string
}): string =>
  hash(
    [
      "bunker81",
      "mercado-pago",
      input.providerKind,
      input.paymentSessionId,
      input.operation,
      input.requestFingerprint || "none",
      input.medusaOperationId || "none",
    ].join(":")
  )
