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

const FAILED_PAYMENT_STATUSES = new Set([
  "cancelled",
  "charged_back",
  "expired",
  "refunded",
  "rejected",
])

const REFUND_SUCCESS_STATUSES = new Set(["approved", "processed"])

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {}

const toSessionInput = (value: unknown): MercadoPagoSessionInput =>
  toRecord(value) as MercadoPagoSessionInput

const unwrapBigNumber = (value: unknown): unknown => {
  const record = toRecord(value)

  if (typeof record.numeric === "number") {
    return record.numeric
  }

  if (typeof record.value === "number" || typeof record.value === "string") {
    return record.value
  }

  const raw = toRecord(record.raw)
  if (typeof raw.value === "number" || typeof raw.value === "string") {
    return raw.value
  }

  if (typeof record.toJSON === "function") {
    return (record.toJSON as () => unknown)()
  }

  return value
}

const toPositiveNumber = (value: unknown, field: string): number => {
  const result = Number(unwrapBigNumber(value))

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

const requireStableReference = (value: unknown): string => {
  const reference = requireString(value, "Payment collection ID")

  if (!/^[A-Za-z0-9_-]{1,64}$/.test(reference)) {
    throw new Error("Payment collection ID is not a valid external reference")
  }

  return reference
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
    const accessToken = requireString(
      options?.accessToken,
      "Mercado Pago access token"
    )
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

    if (typeof options?.liveMode !== "boolean") {
      throw new Error("Mercado Pago live mode must be explicitly configured")
    }

    if (options.liveMode && accessToken.startsWith("TEST-")) {
      throw new Error("Mercado Pago test credential cannot run in live mode")
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
    const stableReference = requireStableReference(
      sessionInput.payment_collection_id
    )
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
    await this.client_.validateEnvironment(this.options_.liveMode)

    const existingPayments = await this.client_.searchPayments(stableReference)
    const existingPayment = this.reconcileExistingPayment(
      existingPayments,
      stableReference,
      normalizedAmount,
      requestFingerprint
    )

    if (existingPayment) {
      if (
        this.providerKind === "card" &&
        (existingPayment.status === "approved" || existingPayment.captured)
      ) {
        await this.compensateCreatedPayment(existingPayment, stableReference)
        throw new Error(
          "Mercado Pago unexpectedly captured the card before the capture lifecycle"
        )
      }

      return {
        id: String(existingPayment.id),
        status: mapMercadoPagoStatus(existingPayment.status),
        data: this.toSessionData(
          existingPayment,
          sessionId,
          stableReference,
          requestFingerprint
        ),
      }
    }

    const hasTerminalAttempt = existingPayments.some(
      (payment) =>
        payment.external_reference === stableReference &&
        FAILED_PAYMENT_STATUSES.has(payment.status)
    )
    const idempotencyKey = createIdempotencyKey({
      stableReference,
      operation: "create",
      providerKind: "payment",
      requestFingerprint: hasTerminalAttempt ? requestFingerprint : undefined,
    })

    const body: MercadoPagoCreatePayment = {
      transaction_amount: normalizedAmount,
      description: sessionInput.description,
      payment_method_id: method.paymentMethodId,
      token: method.token,
      installments: method.installments,
      issuer_id: method.issuerId,
      capture: this.providerKind === "pix",
      external_reference: stableReference,
      notification_url: this.getWebhookUrl(),
      payer: {
        email: payerEmail,
        identification: sessionInput.payer_identification,
      },
      metadata: {
        payment_session_id: sessionId,
        payment_collection_id: stableReference,
        provider_kind: this.providerKind,
        request_fingerprint: requestFingerprint,
      },
    }
    let payment: MercadoPagoPayment

    try {
      payment = await this.client_.createPayment(body, idempotencyKey)
    } catch (createError) {
      const recovered = this.reconcileExistingPayment(
        await this.client_.searchPayments(stableReference),
        stableReference,
        normalizedAmount,
        requestFingerprint
      )

      if (!recovered) {
        throw createError
      }

      payment = recovered
    }

    try {
      this.assertPaymentIdentity(
        payment,
        stableReference,
        normalizedAmount,
        requestFingerprint
      )
      if (
        this.providerKind === "card" &&
        (payment.status === "approved" || payment.captured)
      ) {
        throw new Error(
          "Mercado Pago unexpectedly captured the card before the capture lifecycle"
        )
      }
    } catch (error) {
      await this.compensateCreatedPayment(payment, stableReference)
      throw error
    }

    return {
      id: String(payment.id),
      status: mapMercadoPagoStatus(payment.status),
      data: this.toSessionData(
        payment,
        sessionId,
        stableReference,
        requestFingerprint
      ),
    }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const data = toRecord(input.data)
    const paymentId = typeof data.id === "string" ? data.id : undefined

    if (!paymentId) {
      return this.initiatePayment(input)
    }

    const sessionId = requireString(data.session_id, "Payment session ID")
    const stableReference = requireStableReference(data.payment_collection_id)
    const requestFingerprint = requireString(
      data.request_fingerprint,
      "Request fingerprint"
    )
    const expectedAmount = toPositiveNumber(input.amount, "Payment amount")
    const payment = await this.expirePixPaymentIfNecessary(
      await this.client_.getPayment(paymentId),
      stableReference,
      requestFingerprint
    )

    this.assertPaymentIdentity(
      payment,
      stableReference,
      expectedAmount,
      requestFingerprint
    )

    return {
      status: mapMercadoPagoStatus(payment.status),
      data: this.toSessionData(
        payment,
        sessionId,
        stableReference,
        requestFingerprint
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
    const stableReference = requireStableReference(
      storedData.payment_collection_id
    )
    const requestFingerprint = requireString(
      storedData.request_fingerprint,
      "Request fingerprint"
    )
    const expectedAmount = toPositiveNumber(
      storedData.transaction_amount,
      "Stored payment amount"
    )
    const payment = await this.expirePixPaymentIfNecessary(
      await this.client_.getPayment(paymentId),
      stableReference,
      requestFingerprint
    )

    this.assertPaymentIdentity(
      payment,
      stableReference,
      expectedAmount,
      requestFingerprint
    )

    return {
      status: mapMercadoPagoStatus(payment.status),
      data: this.toSessionData(
        payment,
        sessionId,
        stableReference,
        requestFingerprint
      ),
    }
  }

  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    const storedData = toRecord(input.data)
    const paymentId = requireString(storedData.id, "Mercado Pago payment ID")
    const sessionId = requireString(storedData.session_id, "Payment session ID")
    const stableReference = requireStableReference(
      storedData.payment_collection_id
    )
    const requestFingerprint = requireString(
      storedData.request_fingerprint,
      "Request fingerprint"
    )
    const payment = await this.client_.getPayment(paymentId)

    this.assertPaymentIdentity(payment, stableReference)

    return {
      data: this.toSessionData(
        payment,
        sessionId,
        stableReference,
        requestFingerprint
      ),
    }
  }

  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    const storedData = toRecord(input.data)
    const paymentId = requireString(storedData.id, "Mercado Pago payment ID")
    const sessionId = requireString(storedData.session_id, "Payment session ID")
    const stableReference = requireStableReference(
      storedData.payment_collection_id
    )
    const requestFingerprint = requireString(
      storedData.request_fingerprint,
      "Request fingerprint"
    )
    const operationId = requireString(
      input.context?.idempotency_key,
      "Capture operation ID"
    )
    let payment = await this.client_.getPayment(paymentId)

    this.assertPaymentIdentity(payment, stableReference)
    await this.client_.validateEnvironment(this.options_.liveMode)

    if (payment.status === "authorized") {
      payment = await this.client_.capturePayment(
        paymentId,
        createIdempotencyKey({
          stableReference,
          operation: "capture",
          providerKind: this.providerKind,
          requestFingerprint,
          medusaOperationId: operationId,
        })
      )
      this.assertPaymentIdentity(payment, stableReference)
    }

    if (payment.status !== "approved" || payment.captured !== true) {
      throw new Error("Mercado Pago did not confirm payment capture")
    }

    return {
      data: this.toSessionData(
        payment,
        sessionId,
        stableReference,
        requestFingerprint
      ),
    }
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
    const stableReference = requireStableReference(
      storedData.payment_collection_id
    )
    const requestFingerprint = requireString(
      storedData.request_fingerprint,
      "Request fingerprint"
    )
    const current = await this.client_.getPayment(paymentId)

    this.assertPaymentIdentity(current, stableReference)

    if (CANCELED_STATUSES.has(current.status) || current.status === "rejected") {
      return {
        data: this.toSessionData(
          current,
          sessionId,
          stableReference,
          requestFingerprint
        ),
      }
    }

    if (current.status === "approved") {
      const refundAmount =
        current.transaction_amount - (current.transaction_amount_refunded || 0)

      if (refundAmount > 0) {
        const refund = await this.client_.refundPayment(
          paymentId,
          refundAmount,
          createIdempotencyKey({
            stableReference,
            operation: "compensate",
            providerKind: this.providerKind,
            requestFingerprint,
            medusaOperationId:
              input.context?.idempotency_key || `payment-${paymentId}`,
          })
        )
        this.assertRefund(refund, paymentId, refundAmount)
      }

      const refunded = await this.client_.getPayment(paymentId)
      this.assertPaymentIdentity(refunded, stableReference)

      if (
        refunded.status !== "refunded" &&
        (refunded.transaction_amount_refunded || 0) < refunded.transaction_amount
      ) {
        throw new Error("Mercado Pago did not confirm captured payment refund")
      }

      return {
        data: this.toSessionData(
          refunded,
          sessionId,
          stableReference,
          requestFingerprint
        ),
      }
    }

    if (!CANCELLABLE_STATUSES.has(current.status)) {
      throw new Error(
        `Mercado Pago payment in ${current.status} state cannot be canceled safely`
      )
    }

    const idempotencyKey = createIdempotencyKey({
      stableReference,
      operation: "cancel",
      providerKind: this.providerKind,
      requestFingerprint,
    })
    const canceled = await this.client_.cancelPayment(paymentId, idempotencyKey)

    this.assertPaymentIdentity(canceled, stableReference)

    if (!CANCELED_STATUSES.has(canceled.status)) {
      throw new Error("Mercado Pago did not confirm payment cancellation")
    }

    return {
      data: this.toSessionData(
        canceled,
        sessionId,
        stableReference,
        requestFingerprint
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
    const stableReference = requireStableReference(
      storedData.payment_collection_id
    )
    const amount = toPositiveNumber(input.amount, "Refund amount")
    const operationId = requireString(
      input.context?.idempotency_key,
      "Refund operation ID"
    )
    const current = await this.client_.getPayment(paymentId)

    this.assertPaymentIdentity(current, stableReference)

    if (current.status !== "approved") {
      throw new Error("Only approved Mercado Pago payments can be refunded")
    }

    const idempotencyKey = createIdempotencyKey({
      stableReference,
      operation: "refund",
      providerKind: this.providerKind,
      requestFingerprint: String(storedData.request_fingerprint || ""),
      medusaOperationId: operationId,
    })

    const refund = await this.client_.refundPayment(
      paymentId,
      amount,
      idempotencyKey
    )
    this.assertRefund(refund, paymentId, amount)

    return {
      data: {
        ...storedData,
        last_refund_amount: amount,
        last_refund_id: String(refund.id),
      },
    }
  }

  async getWebhookActionAndData(
    webhook: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    const body = toRecord(webhook.data) as MercadoPagoWebhookBody
    const headers = toRecord(webhook.headers)
    const topic = String(body.type || body.topic || "").toLowerCase()

    if (topic !== "payment") {
      return { action: PaymentActions.NOT_SUPPORTED }
    }

    const dataId = body.data_id ?? body.data?.id
    const normalizedDataId =
      dataId === undefined || dataId === null
        ? undefined
        : String(dataId).trim().toLowerCase()

    validateMercadoPagoSignature({
      signature: readHeader(headers, "x-signature"),
      requestId: readHeader(headers, "x-request-id"),
      dataId: normalizedDataId,
      secret: this.options_.webhookSecret,
      toleranceSeconds: this.options_.webhookToleranceSeconds || 300,
    })

    const payment = await this.client_.getPayment(String(normalizedDataId))
    const metadata = toRecord(payment.metadata)

    if (metadata.provider_kind !== this.providerKind) {
      return { action: PaymentActions.NOT_SUPPORTED }
    }

    const sessionId = requireString(
      metadata.payment_session_id,
      "Payment session ID"
    )
    const stableReference = requireStableReference(
      metadata.payment_collection_id || payment.external_reference
    )

    this.assertPaymentIdentity(payment, stableReference)

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

  private reconcileExistingPayment(
    payments: MercadoPagoPayment[],
    stableReference: string,
    expectedAmount: number,
    requestFingerprint: string
  ): MercadoPagoPayment | undefined {
    for (const payment of payments) {
      if (payment.external_reference !== stableReference) {
        continue
      }

      const metadata = toRecord(payment.metadata)
      const existingFingerprint = String(metadata.request_fingerprint || "")

      if (existingFingerprint === requestFingerprint) {
        this.assertPaymentIdentity(
          payment,
          stableReference,
          expectedAmount,
          requestFingerprint
        )
        return payment
      }

      if (!FAILED_PAYMENT_STATUSES.has(payment.status)) {
        throw new Error(
          "A different active Mercado Pago payment already exists for this payment collection"
        )
      }
    }

    return undefined
  }

  private async compensateCreatedPayment(
    payment: MercadoPagoPayment,
    stableReference: string
  ): Promise<void> {
    if (payment.id === undefined || payment.id === null) {
      throw new Error(
        "Mercado Pago payment cannot be compensated because its ID is missing"
      )
    }

    const paymentId = String(payment.id)
    const idempotencyKey = createIdempotencyKey({
      stableReference,
      operation: "compensate",
      providerKind: this.providerKind,
      requestFingerprint: String(
        toRecord(payment.metadata).request_fingerprint || "validation-failure"
      ),
      medusaOperationId: `payment-${paymentId}`,
    })

    if (payment.status === "approved") {
      const refundedAmount = payment.transaction_amount_refunded || 0
      const refundAmount = Number.isFinite(payment.transaction_amount)
        ? payment.transaction_amount - refundedAmount
        : undefined

      if (refundAmount === undefined || refundAmount > 0) {
        const refund = await this.client_.refundPayment(
          paymentId,
          refundAmount,
          idempotencyKey
        )
        this.assertRefund(refund, paymentId, refundAmount)
      }
      return
    }

    if (CANCELLABLE_STATUSES.has(payment.status)) {
      const canceled = await this.client_.cancelPayment(
        paymentId,
        idempotencyKey
      )

      if (!CANCELED_STATUSES.has(canceled.status)) {
        throw new Error("Mercado Pago compensation was not confirmed")
      }
      return
    }

    if (!FAILED_PAYMENT_STATUSES.has(payment.status)) {
      throw new Error(
        `Mercado Pago payment in ${payment.status} state cannot be compensated safely`
      )
    }
  }

  private async expirePixPaymentIfNecessary(
    payment: MercadoPagoPayment,
    stableReference: string,
    requestFingerprint: string
  ): Promise<MercadoPagoPayment> {
    if (
      this.providerKind !== "pix" ||
      !CANCELLABLE_STATUSES.has(payment.status) ||
      !payment.date_of_expiration
    ) {
      return payment
    }

    const expiration = Date.parse(payment.date_of_expiration)
    if (!Number.isFinite(expiration) || expiration > Date.now()) {
      return payment
    }

    const canceled = await this.client_.cancelPayment(
      String(payment.id),
      createIdempotencyKey({
        stableReference,
        operation: "cancel",
        providerKind: this.providerKind,
        requestFingerprint,
        medusaOperationId: "pix-expiration",
      })
    )

    if (!CANCELED_STATUSES.has(canceled.status)) {
      throw new Error("Mercado Pago did not confirm expired Pix cancellation")
    }

    return canceled
  }

  private assertRefund(
    refund: {
      id?: number | string
      payment_id?: number | string
      amount?: number
      status?: string
    },
    paymentId: string,
    expectedAmount?: number
  ): void {
    if (refund.id === undefined || refund.id === null) {
      throw new Error("Mercado Pago refund ID is missing")
    }

    if (String(refund.payment_id) !== paymentId) {
      throw new Error("Mercado Pago refund payment reference mismatch")
    }

    const refundAmount = Number(refund.amount)
    if (
      !Number.isFinite(refundAmount) ||
      refundAmount <= 0 ||
      (expectedAmount !== undefined &&
        Math.abs(refundAmount - expectedAmount) > 0.001)
    ) {
      throw new Error("Mercado Pago refund amount mismatch")
    }

    if (!refund.status || !REFUND_SUCCESS_STATUSES.has(refund.status)) {
      throw new Error("Mercado Pago did not confirm the refund")
    }
  }

  private assertPaymentIdentity(
    payment: MercadoPagoPayment,
    stableReference: string,
    expectedAmount?: number,
    expectedFingerprint?: string
  ): void {
    if (payment.id === undefined || payment.id === null) {
      throw new Error("Mercado Pago payment ID is missing")
    }

    if (payment.external_reference !== stableReference) {
      throw new Error("Mercado Pago payment collection reference mismatch")
    }

    if (payment.currency_id?.toLowerCase() !== "brl") {
      throw new Error("Mercado Pago payment currency mismatch")
    }

    if (payment.live_mode !== this.options_.liveMode) {
      throw new Error("Mercado Pago payment environment mismatch")
    }

    const metadata = toRecord(payment.metadata)
    if (metadata.payment_collection_id !== stableReference) {
      throw new Error("Mercado Pago payment metadata reference mismatch")
    }

    if (metadata.provider_kind !== this.providerKind) {
      throw new Error("Mercado Pago payment provider kind mismatch")
    }

    if (
      !Number.isFinite(payment.transaction_amount) ||
      payment.transaction_amount <= 0 ||
      (expectedAmount !== undefined &&
        Math.abs(payment.transaction_amount - expectedAmount) > 0.001)
    ) {
      throw new Error("Mercado Pago payment amount mismatch")
    }

    if (
      expectedFingerprint &&
      metadata.request_fingerprint !== expectedFingerprint
    ) {
      throw new Error("Mercado Pago payment request fingerprint mismatch")
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
    stableReference: string,
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
      payment_collection_id: stableReference,
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
      token: null,
      payer_email: null,
      payer_identification: null,
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
