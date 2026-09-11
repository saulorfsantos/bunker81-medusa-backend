import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import {
  AbstractPaymentProvider,
  PaymentActions,
} from "@medusajs/framework/utils"
import { MercadoPagoClient } from "./client"
import {
  createIdempotencyKey,
  createPaymentFingerprint,
} from "./idempotency"
import { validateMercadoPagoSignature } from "./signature"
import {
  mapMercadoPagoStatus,
  mapMercadoPagoWebhookAction,
} from "./status"
import type {
  MercadoPagoCreatePayment,
  MercadoPagoOptions,
  MercadoPagoPayment,
  MercadoPagoProviderKind,
  MercadoPagoSessionData,
  MercadoPagoSessionInput,
  MercadoPagoWebhookBody,
} from "./types"

type InjectedDependencies = Record<string, unknown>

const CANCELLABLE_STATUSES = new Set([
  "authorized",
  "in_mediation",
  "in_process",
  "pending",
])

const CANCELED_STATUSES = new Set([
  "cancelled",
  "charged_back",
  "expired",
  "refunded",
])

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {}

const toSessionInput = (value: unknown): MercadoPagoSessionInput =>
  toRecord(value) as MercadoPagoSessionInput

const toPositiveNumber = (value: unknown, field: string): number => {
  const result = Number(value)

  if (!Number.isFinite(result) || result <= 0) {
    throw new Error(`${field} must be a positive number`)
  }

  return result
}

const toOptionalPositiveInteger = (
  value: unknown,
  field: string
): number | undefined => {
  if (value === undefined || value === null || value === "") {
    return undefined
  }

  const result = Number(value)

  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new Error(`${field} must be a positive integer`)
  }

  return result
}

const requireString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`)
  }

  return value.trim()
}

const readHeader = (
  headers: Record<string, unknown>,
  name: string
): string | string[] | undefined => {
  const match = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name.toLowerCase()
  )?.[1]

  if (typeof match === "string") {
    return match
  }

  if (Array.isArray(match) && match.every((item) => typeof item === "string")) {
    return match as string[]
  }

  return undefined
}

abstract class MercadoPagoBaseProviderService extends AbstractPaymentProvider<MercadoPagoOptions> {
  static identifier = "mercadopago-base"
  protected abstract readonly providerKind: MercadoPagoProviderKind
  protected readonly options_: MercadoPagoOptions
  protected readonly client_: MercadoPagoClient

  static validateOptions(options: MercadoPagoOptions): void {
    requireString(options?.accessToken, "Mercado Pago access token")
    requireString(options?.webhookSecret, "Mercado Pago webhook secret")
    const webhookBaseUrl = requireString(
      options?.webhookBaseUrl,
      "Mercado Pago webhook base URL"
    )

    const parsedWebhookUrl = new URL(webhookBaseUrl)
    const isLocalhost = ["localhost", "127.0.0.1"].includes(
      parsedWebhookUrl.hostname
    )

    if (parsedWebhookUrl.protocol !== "https:" && !isLocalhost) {
      throw new Error("Mercado Pago webhook base URL must use HTTPS")
    }
  }

  constructor(container: InjectedDependencies, options: MercadoPagoOptions) {
    super(container, options)
    this.options_ = options
    this.client_ = new MercadoPagoClient(options)
  }

  protected abstract getPaymentMethod(
    input: MercadoPagoSessionInput
  ): {
    paymentMethodId: string
    token?: string
    installments?: number
    issuerId?: number
  }

  async initiatePayment({
    amount,
    currency_code,
    data,
    context,
  }: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const sessionInput = toSessionInput(data)
    const sessionId = requireString(sessionInput.session_id, "Payment session ID")
    const currencyCode = requireString(currency_code, "Currency code")

    if (currencyCode.toLowerCase() !== "brl") {
      throw new Error("Mercado Pago providers only support BRL")
    }

    const normalizedAmount = toPositiveNumber(amount, "Payment amount")
    const payerEmail = requireString(
      context?.customer?.email || sessionInput.payer_email,
      "Payer email"
    )
    const method = this.getPaymentMethod(sessionInput)
    const requestFingerprint = createPaymentFingerprint({
      amount: normalizedAmount,
      currencyCode,
      providerKind: this.providerKind,
      paymentMethodId: method.paymentMethodId,
      token: method.token,
      installments: method.installments,
      issuerId: method.issuerId,
    })
    const idempotencyKey = createIdempotencyKey({
      paymentSessionId: sessionId,
      operation: "create",
      providerKind: this.providerKind,
    })
    const body: MercadoPagoCreatePayment = {
      transaction_amount: normalizedAmount,
      description: sessionInput.description,
      payment_method_id: method.paymentMethodId,
      token: method.token,
      installments: method.installments,
      issuer_id: method.issuerId,
      capture: true,
      external_reference: sessionId,
      notification_url: this.getWebhookUrl(),
      payer: {
        email: payerEmail,
        identification: sessionInput.payer_identification,
      },
      metadata: {
        payment_session_id: sessionId,
        provider_kind: this.providerKind,
        request_fingerprint: requestFingerprint,
      },
    }
    const payment = await this.client_.createPayment(body, idempotencyKey)

    this.assertPaymentIdentity(payment, sessionId, normalizedAmount)

    return {
      id: String(payment.id),
      status: mapMercadoPagoStatus(payment.status),
      data: this.toSessionData(payment, sessionId, requestFingerprint),
    }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const data = toRecord(input.data)
    const paymentId = typeof data.id === "string" ? data.id : undefined

    if (!paymentId) {
      return this.initiatePayment(input)
    }

    const payment = await this.client_.getPayment(paymentId)
    const expectedAmount = toPositiveNumber(input.amount, "Payment amount")

    this.assertPaymentIdentity(
      payment,
      requireString(data.session_id, "Payment session ID"),
      expectedAmount
    )

    return {
      status: mapMercadoPagoStatus(payment.status),
      data: this.toSessionData(
        payment,
        requireString(data.session_id, "Payment session ID"),
        requireString(data.request_fingerprint, "Request fingerprint")
      ),
    }
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    return this.getPaymentStatus(input)
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    const storedData = toRecord(input.data)
    const paymentId = requireString(storedData.id, "Mercado Pago payment ID")
    const sessionId = requireString(storedData.session_id, "Payment session ID")
    const payment = await this.client_.getPayment(paymentId)
    const expectedAmount = toPositiveNumber(
      storedData.transaction_amount,
      "Stored payment amount"
    )

    this.assertPaymentIdentity(payment, sessionId, expectedAmount)

    return {
      status: mapMercadoPagoStatus(payment.status),
      data: this.toSessionData(
        payment,
        sessionId,
        requireString(storedData.request_fingerprint, "Request fingerprint")
      ),
    }
  }

  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    const storedData = toRecord(input.data)
    const paymentId = requireString(storedData.id, "Mercado Pago payment ID")
    const sessionId = requireString(storedData.session_id, "Payment session ID")
    const payment = await this.client_.getPayment(paymentId)

    this.assertPaymentIdentity(payment, sessionId)

    return {
      data: this.toSessionData(
        payment,
        sessionId,
        requireString(storedData.request_fingerprint, "Request fingerprint")
      ),
    }
  }

  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    const result = await this.retrievePayment(input)
    const status = String(result.data?.status || "")

    if (status !== "approved") {
      throw new Error(
        "Mercado Pago payment is not captured; automatic capture cannot be repeated"
      )
    }

    return result
  }

  async cancelPayment(
    input: CancelPaymentInput
  ): Promise<CancelPaymentOutput> {
    const storedData = toRecord(input.data)
    const paymentId = typeof storedData.id === "string" ? storedData.id : undefined

    if (!paymentId) {
      return { data: storedData }
    }

    const sessionId = requireString(storedData.session_id, "Payment session ID")
    const current = await this.client_.getPayment(paymentId)

    this.assertPaymentIdentity(current, sessionId)

    if (CANCELED_STATUSES.has(current.status) || current.status === "rejected") {
      return {
        data: this.toSessionData(
          current,
          sessionId,
          requireString(storedData.request_fingerprint, "Request fingerprint")
        ),
      }
    }

    if (!CANCELLABLE_STATUSES.has(current.status)) {
      throw new Error(
        `Mercado Pago payment in ${current.status} state cannot be canceled safely`
      )
    }

    const idempotencyKey = createIdempotencyKey({
      paymentSessionId: sessionId,
      operation: "cancel",
      providerKind: this.providerKind,
      requestFingerprint: String(storedData.request_fingerprint || ""),
    })
    const canceled = await this.client_.cancelPayment(paymentId, idempotencyKey)

    this.assertPaymentIdentity(canceled, sessionId)

    if (!CANCELED_STATUSES.has(canceled.status)) {
      throw new Error("Mercado Pago did not confirm payment cancellation")
    }

    return {
      data: this.toSessionData(
        canceled,
        sessionId,
        requireString(storedData.request_fingerprint, "Request fingerprint")
      ),
    }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return this.cancelPayment(input)
  }

  async refundPayment(
    input: RefundPaymentInput
  ): Promise<RefundPaymentOutput> {
    const storedData = toRecord(input.data)
    const paymentId = requireString(storedData.id, "Mercado Pago payment ID")
    const sessionId = requireString(storedData.session_id, "Payment session ID")
    const amount = toPositiveNumber(input.amount, "Refund amount")
    const current = await this.client_.getPayment(paymentId)

    this.assertPaymentIdentity(current, sessionId)

    if (current.status !== "approved") {
      throw new Error("Only approved Mercado Pago payments can be refunded")
    }

    const idempotencyKey = createIdempotencyKey({
      paymentSessionId: sessionId,
      operation: "refund",
      providerKind: this.providerKind,
      requestFingerprint: `${storedData.request_fingerprint || ""}:${amount}`,
      medusaOperationId: input.context?.idempotency_key,
    })

    await this.client_.refundPayment(paymentId, amount, idempotencyKey)

    return {
      data: {
        ...storedData,
        last_refund_amount: amount,
      },
    }
  }

  async getWebhookActionAndData(
    webhook: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    const body = toRecord(webhook.data) as MercadoPagoWebhookBody
    const headers = toRecord(webhook.headers)
    const dataId = body.data?.id

    validateMercadoPagoSignature({
      signature: readHeader(headers, "x-signature"),
      requestId: readHeader(headers, "x-request-id"),
      dataId,
      secret: this.options_.webhookSecret,
      toleranceSeconds: this.options_.webhookToleranceSeconds || 300,
    })

    if (body.type !== "payment" && body.topic !== "payment") {
      return { action: PaymentActions.NOT_SUPPORTED }
    }

    const payment = await this.client_.getPayment(String(dataId))
    const sessionId = requireString(
      payment.external_reference,
      "Payment session ID"
    )

    this.assertPaymentIdentity(payment, sessionId)

    return {
      action: mapMercadoPagoWebhookAction(payment.status),
      data: {
        session_id: sessionId,
        amount: payment.transaction_amount,
      },
    }
  }

  private getWebhookUrl(): string {
    const identifier = (this.constructor as typeof MercadoPagoBaseProviderService)
      .identifier

    return new URL(
      `/hooks/payment/${identifier}_mercadopago`,
      this.options_.webhookBaseUrl
    ).toString()
  }

  private assertPaymentIdentity(
    payment: MercadoPagoPayment,
    sessionId: string,
    expectedAmount?: number
  ): void {
    if (payment.id === undefined || payment.id === null) {
      throw new Error("Mercado Pago payment ID is missing")
    }

    if (payment.external_reference !== sessionId) {
      throw new Error("Mercado Pago payment session reference mismatch")
    }

    if (payment.currency_id?.toLowerCase() !== "brl") {
      throw new Error("Mercado Pago payment currency mismatch")
    }

    if (Boolean(payment.live_mode) !== Boolean(this.options_.liveMode)) {
      throw new Error("Mercado Pago payment environment mismatch")
    }

    if (
      expectedAmount !== undefined &&
      Number.isFinite(expectedAmount) &&
      Math.abs(payment.transaction_amount - expectedAmount) > 0.001
    ) {
      throw new Error("Mercado Pago payment amount mismatch")
    }

    if (this.providerKind === "pix" && payment.payment_method_id !== "pix") {
      throw new Error("Mercado Pago payment method mismatch")
    }

    if (
      this.providerKind === "card" &&
      payment.payment_method_id === "pix"
    ) {
      throw new Error("Mercado Pago payment method mismatch")
    }

    if (
      this.providerKind === "card" &&
      payment.payment_type_id &&
      !["credit_card", "debit_card", "prepaid_card"].includes(
        payment.payment_type_id
      )
    ) {
      throw new Error("Mercado Pago payment type mismatch")
    }
  }

  private toSessionData(
    payment: MercadoPagoPayment,
    sessionId: string,
    requestFingerprint: string
  ): MercadoPagoSessionData {
    const transactionData = payment.point_of_interaction?.transaction_data
    const publicTransactionData = transactionData
      ? {
          qr_code: transactionData.qr_code || undefined,
          qr_code_base64: transactionData.qr_code_base64 || undefined,
          ticket_url: transactionData.ticket_url || undefined,
        }
      : undefined

    return {
      id: String(payment.id),
      session_id: sessionId,
      provider_kind: this.providerKind,
      status: payment.status,
      status_detail: payment.status_detail || undefined,
      transaction_amount: payment.transaction_amount,
      currency_id: payment.currency_id,
      payment_method_id: payment.payment_method_id || undefined,
      payment_type_id: payment.payment_type_id || undefined,
      live_mode: Boolean(payment.live_mode),
      date_of_expiration: payment.date_of_expiration || undefined,
      request_fingerprint: requestFingerprint,
      point_of_interaction: publicTransactionData
        ? { transaction_data: publicTransactionData }
        : undefined,
    }
  }
}

export class MercadoPagoPixProviderService extends MercadoPagoBaseProviderService {
  static identifier = "mercadopago-pix"
  protected readonly providerKind = "pix" as const

  protected getPaymentMethod(input: MercadoPagoSessionInput) {
    if (!input.payer_identification?.type || !input.payer_identification.number) {
      throw new Error("Payer identification is required for Pix")
    }

    return { paymentMethodId: "pix" }
  }
}

export class MercadoPagoCardProviderService extends MercadoPagoBaseProviderService {
  static identifier = "mercadopago-card"
  protected readonly providerKind = "card" as const

  protected getPaymentMethod(input: MercadoPagoSessionInput) {
    const paymentMethodId = requireString(
      input.payment_method_id,
      "Card payment method ID"
    )

    if (paymentMethodId === "pix") {
      throw new Error("Pix cannot be processed by the card provider")
    }

    return {
      paymentMethodId,
      token: requireString(input.token, "Card token"),
      installments:
        toOptionalPositiveInteger(input.installments, "Installments") || 1,
      issuerId: toOptionalPositiveInteger(input.issuer_id, "Issuer ID"),
    }
  }
}
