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
import {
  isMercadoPagoDefinitiveRequestError,
  MercadoPagoClient,
} from "./client"
import {
  createAttemptId,
  isNotFoundError,
  MERCADO_PAGO_ORPHAN_GRACE_PERIOD_MS,
  structuredOrphanEvent,
  type MercadoPagoAttemptStore,
  type StoredMercadoPagoAttempt,
} from "./attempts"
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

type StoredPaymentSession = {
  id: string
  payment_collection_id?: string | null
  data?: Record<string, unknown> | null
  created_at?: Date | string
  updated_at?: Date | string
}

type PaymentSessionStore = {
  list: (
    filters: { payment_collection_id: string },
    config?: { order?: { updated_at: "DESC" } }
  ) => Promise<StoredPaymentSession[]>
  retrieve: (
    id: string,
    config?: { select?: string[] }
  ) => Promise<StoredPaymentSession>
  update: (data: {
    id: string
    data: MercadoPagoSessionData
  }) => Promise<unknown>
}

type InjectedDependencies = Record<string, unknown> & {
  paymentSessionService: PaymentSessionStore
  mercadoPagoAttempt: MercadoPagoAttemptStore
  logger?: {
    info: (message: string) => void
    warn: (message: string) => void
    error: (message: string) => void
  }
}

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

const isUniqueConstraintError = (error: unknown): boolean => {
  const candidate = toRecord(error)
  return (
    candidate.code === "23505" ||
    candidate.type === "conflict" ||
    candidate.status === 409 ||
    candidate.statusCode === 409
  )
}

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
  private readonly paymentSessionStore_: PaymentSessionStore
  private readonly attemptStore_: MercadoPagoAttemptStore
  private readonly logger_: NonNullable<InjectedDependencies["logger"]>

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
    if (
      typeof container.paymentSessionService?.list !== "function" ||
      typeof container.paymentSessionService?.retrieve !== "function" ||
      typeof container.paymentSessionService?.update !== "function"
    ) {
      throw new Error("Medusa payment session service is required")
    }
    if (
      typeof container.mercadoPagoAttempt?.listMercadoPagoAttempts !==
        "function" ||
      typeof container.mercadoPagoAttempt?.createMercadoPagoAttempts !==
        "function" ||
      typeof container.mercadoPagoAttempt?.updateMercadoPagoAttempts !==
        "function" ||
      typeof container.mercadoPagoAttempt?.retrieveMercadoPagoAttempt !==
        "function"
    ) {
      throw new Error("Mercado Pago attempt module is required")
    }

    this.options_ = options
    this.client_ = new MercadoPagoClient(options)
    this.paymentSessionStore_ = container.paymentSessionService
    this.attemptStore_ = container.mercadoPagoAttempt
    this.logger_ = container.logger || {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    }
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
    const stableReference = await this.resolveAuthoritativeCollection(
      sessionId,
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
      requestFingerprint,
      sessionId
    )

    if (existingPayment) {
      const attempt = await this.ensureAttempt({
        sessionId,
        stableReference,
        requestFingerprint,
        idempotencyKey: createIdempotencyKey({
          stableReference,
          operation: "create",
          providerKind: this.providerKind,
          requestFingerprint,
          medusaOperationId: sessionId,
        }),
        amount: normalizedAmount,
        currencyCode,
      })
      this.assertAttemptMayCreate(attempt, attempt.id)
      if (
        this.providerKind === "card" &&
        (existingPayment.status === "approved" || existingPayment.captured)
      ) {
        await this.compensateCreatedPayment(existingPayment, stableReference)
        throw new Error(
          "Mercado Pago unexpectedly captured the card before the capture lifecycle"
        )
      }

      const sessionData = await this.toSessionData(
        existingPayment,
        sessionId,
        stableReference,
        requestFingerprint
      )
      await this.recordBoundAttempt(attempt, existingPayment, sessionData)
      await this.bindRecoveredPaymentSession(sessionId, sessionData)

      return {
        id: String(existingPayment.id),
        status: mapMercadoPagoStatus(existingPayment.status),
        data: sessionData,
      }
    }

    const idempotencyKey = createIdempotencyKey({
      stableReference,
      operation: "create",
      providerKind: this.providerKind,
      requestFingerprint,
      medusaOperationId: sessionId,
    })
    const attemptId = createAttemptId({
      sessionId,
      providerKind: this.providerKind,
      requestFingerprint,
    })
    const attempt = await this.ensureAttempt({
      sessionId,
      stableReference,
      requestFingerprint,
      idempotencyKey,
      amount: normalizedAmount,
      currencyCode,
    })
    this.assertAttemptMayCreate(attempt, attemptId)

    const body: MercadoPagoCreatePayment = {
      transaction_amount: normalizedAmount,
      description: sessionInput.description,
      payment_method_id: method.paymentMethodId,
      token: method.token,
      installments: method.installments,
      issuer_id: method.issuerId,
      capture: this.providerKind === "pix",
      binary_mode: this.providerKind === "card" ? false : undefined,
      three_d_secure_mode:
        this.providerKind === "card" ? "optional" : undefined,
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
    let recoveredPayment = false
    let sessionData!: MercadoPagoSessionData

    try {
      payment = await this.client_.createPayment(body, idempotencyKey)
    } catch (createError) {
      if (isMercadoPagoDefinitiveRequestError(createError)) {
        await this.attemptStore_.updateMercadoPagoAttempts({
          id: attempt.id,
          state: "resolved_terminal",
          last_error_code: `create_rejected_http_${createError.statusCode}`,
          three_ds_info: null,
        })
        throw createError
      }

      let recovered: MercadoPagoPayment | undefined
      let recoveryPayments: MercadoPagoPayment[] | undefined
      try {
        recoveryPayments = await this.client_.searchPayments(stableReference)
      } catch (searchError) {
        this.logger_.warn(
          structuredOrphanEvent("mercado_pago_create_recovery_search_failed", {
            attempt_id: attempt.id,
            payment_session_id: sessionId,
            payment_collection_id: stableReference,
            provider_kind: this.providerKind,
            reason:
              searchError instanceof Error
                ? searchError.message
                : "unknown_error",
          })
        )
      }

      if (recoveryPayments) {
        recovered = this.reconcileExistingPayment(
          recoveryPayments,
          stableReference,
          normalizedAmount,
          requestFingerprint,
          sessionId
        )
        const ownedTerminal = recoveryPayments.find(
          (candidate) =>
            FAILED_PAYMENT_STATUSES.has(candidate.status) &&
            this.ownsPaymentAttempt(
              candidate,
              stableReference,
              requestFingerprint,
              sessionId
            )
        )
        if (!recovered && ownedTerminal) {
          await this.attemptStore_.updateMercadoPagoAttempts({
            id: attempt.id,
            state: "resolved_terminal",
            remote_payment_id: String(ownedTerminal.id),
            remote_status: ownedTerminal.status,
            last_error_code: "create_response_lost_terminal_remote",
            three_ds_info: null,
          })
          throw createError
        }
      }

      if (!recovered) {
        await this.attemptStore_.updateMercadoPagoAttempts({
          id: attempt.id,
          state: "creating",
          last_error_code: "create_response_unconfirmed",
          reconcile_after: new Date(
            Date.now() + MERCADO_PAGO_ORPHAN_GRACE_PERIOD_MS
          ),
        })
        throw createError
      }

      payment = recovered
      recoveredPayment = true
    }

    try {
      this.assertPaymentIdentity(
        payment,
        stableReference,
        normalizedAmount,
        requestFingerprint,
        sessionId
      )
      if (
        this.providerKind === "card" &&
        (payment.status === "approved" || payment.captured)
      ) {
        throw new Error(
          "Mercado Pago unexpectedly captured the card before the capture lifecycle"
        )
      }
      sessionData = await this.toSessionData(
        payment,
        sessionId,
        stableReference,
        requestFingerprint
      )
    } catch (error) {
      if (
        this.ownsPaymentAttempt(
          payment,
          stableReference,
          requestFingerprint,
          sessionId
        )
      ) {
        try {
          await this.compensateCreatedPayment(payment, stableReference)
          await this.attemptStore_.updateMercadoPagoAttempts({
            id: attempt.id,
            state: "compensated",
            remote_payment_id: String(payment.id),
            remote_status: payment.status,
            compensated_at: new Date(),
            last_error_code: "post_create_validation_failed",
            three_ds_info: null,
          })
        } catch (compensationError) {
          await this.markAttemptForManualReview(
            attempt,
            payment,
            "post_create_compensation_failed"
          )
          throw compensationError
        }
      }
      throw error
    }

    await this.recordBoundAttempt(attempt, payment, sessionData)

    if (recoveredPayment) {
      await this.bindRecoveredPaymentSession(sessionId, sessionData)
    }

    return {
      id: String(payment.id),
      status: mapMercadoPagoStatus(payment.status),
      data: sessionData,
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
      requestFingerprint,
      sessionId
    )

    this.assertPaymentIdentity(
      payment,
      stableReference,
      expectedAmount,
      requestFingerprint,
      sessionId
    )

    return {
      status: mapMercadoPagoStatus(payment.status),
      data: await this.toSessionData(
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
      requestFingerprint,
      sessionId
    )

    this.assertPaymentIdentity(
      payment,
      stableReference,
      expectedAmount,
      requestFingerprint,
      sessionId
    )

    return {
      status: mapMercadoPagoStatus(payment.status),
      data: await this.toSessionData(
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

    this.assertPaymentIdentity(
      payment,
      stableReference,
      undefined,
      requestFingerprint,
      sessionId
    )

    return {
      data: await this.toSessionData(
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

    this.assertPaymentIdentity(
      payment,
      stableReference,
      undefined,
      requestFingerprint,
      sessionId
    )
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
      this.assertPaymentIdentity(
        payment,
        stableReference,
        undefined,
        requestFingerprint,
        sessionId
      )
    }

    if (payment.status !== "approved" || payment.captured !== true) {
      throw new Error("Mercado Pago did not confirm payment capture")
    }

    return {
      data: await this.toSessionData(
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

    this.assertPaymentIdentity(
      current,
      stableReference,
      undefined,
      requestFingerprint,
      sessionId
    )

    if (CANCELED_STATUSES.has(current.status) || current.status === "rejected") {
      return {
        data: await this.toSessionData(
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
      this.assertPaymentIdentity(
        refunded,
        stableReference,
        undefined,
        requestFingerprint,
        sessionId
      )

      if (
        refunded.status !== "refunded" &&
        (refunded.transaction_amount_refunded || 0) < refunded.transaction_amount
      ) {
        throw new Error("Mercado Pago did not confirm captured payment refund")
      }

      return {
        data: await this.toSessionData(
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
      medusaOperationId: sessionId,
    })
    const canceled = await this.client_.cancelPayment(paymentId, idempotencyKey)

    this.assertPaymentIdentity(
      canceled,
      stableReference,
      undefined,
      requestFingerprint,
      sessionId
    )

    if (!CANCELED_STATUSES.has(canceled.status)) {
      throw new Error("Mercado Pago did not confirm payment cancellation")
    }

    return {
      data: await this.toSessionData(
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
    const sessionId = requireString(storedData.session_id, "Payment session ID")
    const stableReference = requireStableReference(
      storedData.payment_collection_id
    )
    const requestFingerprint = requireString(
      storedData.request_fingerprint,
      "Request fingerprint"
    )
    const amount = toPositiveNumber(input.amount, "Refund amount")
    const operationId = requireString(
      input.context?.idempotency_key,
      "Refund operation ID"
    )
    const current = await this.client_.getPayment(paymentId)

    this.assertPaymentIdentity(
      current,
      stableReference,
      undefined,
      requestFingerprint,
      sessionId
    )

    if (current.status !== "approved") {
      throw new Error("Only approved Mercado Pago payments can be refunded")
    }

    const idempotencyKey = createIdempotencyKey({
      stableReference,
      operation: "refund",
      providerKind: this.providerKind,
      requestFingerprint,
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

    const stableReference = requireStableReference(
      metadata.payment_collection_id || payment.external_reference
    )

    const sessionId = await this.resolveWebhookSessionId(
      payment,
      stableReference
    )
    if (!sessionId) {
      await this.recordOrphanWebhook(payment, stableReference)
      return { action: PaymentActions.NOT_SUPPORTED }
    }

    this.assertPaymentIdentity(
      payment,
      stableReference,
      undefined,
      requireString(metadata.request_fingerprint, "Request fingerprint"),
      sessionId
    )

    return {
      action: mapMercadoPagoWebhookAction(payment.status),
      data: {
        session_id: sessionId,
        amount: payment.transaction_amount,
      },
    }
  }

  private async resolveAuthoritativeCollection(
    sessionId: string,
    clientReference: unknown
  ): Promise<string> {
    let session: StoredPaymentSession

    try {
      session = await this.paymentSessionStore_.retrieve(sessionId, {
        select: ["id", "payment_collection_id", "data"],
      })
    } catch {
      throw new Error("Authoritative Medusa payment session was not found")
    }

    if (session.id !== sessionId) {
      throw new Error("Authoritative Medusa payment session ID mismatch")
    }

    const stableReference = requireStableReference(
      session.payment_collection_id
    )
    if (
      clientReference !== undefined &&
      clientReference !== null &&
      requireStableReference(clientReference) !== stableReference
    ) {
      throw new Error("Payment collection does not own this payment session")
    }

    return stableReference
  }

  private async ensureAttempt(input: {
    sessionId: string
    stableReference: string
    requestFingerprint: string
    idempotencyKey: string
    amount: number
    currencyCode: string
  }): Promise<StoredMercadoPagoAttempt> {
    const id = createAttemptId({
      sessionId: input.sessionId,
      providerKind: this.providerKind,
      requestFingerprint: input.requestFingerprint,
    })

    try {
      const existing = await this.attemptStore_.retrieveMercadoPagoAttempt(id)
      if (
        existing.payment_session_id !== input.sessionId ||
        existing.payment_collection_id !== input.stableReference ||
        existing.provider_kind !== this.providerKind ||
        existing.request_fingerprint !== input.requestFingerprint ||
        existing.idempotency_key !== input.idempotencyKey
      ) {
        throw new Error("Mercado Pago attempt ownership mismatch")
      }
      return existing
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error
      }
    }

    try {
      return await this.attemptStore_.createMercadoPagoAttempts({
        id,
        payment_session_id: input.sessionId,
        payment_collection_id: input.stableReference,
        provider_kind: this.providerKind,
        request_fingerprint: input.requestFingerprint,
        idempotency_key: input.idempotencyKey,
        amount: input.amount,
        currency_code: input.currencyCode.toLowerCase(),
        state: "creating",
        reconcile_after: new Date(
          Date.now() + MERCADO_PAGO_ORPHAN_GRACE_PERIOD_MS
        ),
      })
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error
      }
      const concurrent = await this.attemptStore_.retrieveMercadoPagoAttempt(id)
      if (
        concurrent.payment_session_id !== input.sessionId ||
        concurrent.payment_collection_id !== input.stableReference ||
        concurrent.provider_kind !== this.providerKind ||
        concurrent.request_fingerprint !== input.requestFingerprint ||
        concurrent.idempotency_key !== input.idempotencyKey
      ) {
        throw new Error("Mercado Pago attempt ownership mismatch")
      }
      return concurrent
    }
  }

  private assertAttemptMayCreate(
    attempt: StoredMercadoPagoAttempt,
    currentAttemptId: string
  ): void {
    if (attempt.id !== currentAttemptId) {
      throw new Error("Mercado Pago attempt ownership mismatch")
    }

    if (["remote_found", "manual_review", "reviewed"].includes(attempt.state)) {
      throw new Error(
        "Mercado Pago payment creation is blocked while this exact attempt is being reconciled"
      )
    }
  }

  private async recordBoundAttempt(
    attempt: StoredMercadoPagoAttempt,
    payment: MercadoPagoPayment,
    sessionData: MercadoPagoSessionData
  ): Promise<void> {
    const resolvedTerminal = FAILED_PAYMENT_STATUSES.has(payment.status)
    await this.attemptStore_.updateMercadoPagoAttempts({
      id: attempt.id,
      state: resolvedTerminal ? "resolved_terminal" : "bound",
      remote_payment_id: String(payment.id),
      remote_status: payment.status,
      ...(resolvedTerminal ? {} : { bound_at: new Date() }),
      last_error_code: null,
      three_ds_info: sessionData.three_ds_info || null,
    })
  }

  private async markAttemptForManualReview(
    attempt: StoredMercadoPagoAttempt,
    payment: MercadoPagoPayment,
    reason: string
  ): Promise<void> {
    await this.attemptStore_.updateMercadoPagoAttempts({
      id: attempt.id,
      state: "manual_review",
      remote_payment_id: String(payment.id),
      remote_status: payment.status,
      manual_review_at: new Date(),
      last_error_code: reason,
      three_ds_info: null,
    })
    this.logger_.error(
      structuredOrphanEvent("mercado_pago_orphan_manual_review", {
        reason,
        attempt_id: attempt.id,
        payment_session_id: attempt.payment_session_id,
        payment_collection_id: attempt.payment_collection_id,
        provider_kind: attempt.provider_kind,
        remote_payment_id: String(payment.id),
        remote_status: payment.status,
      })
    )
  }

  private async recordOrphanWebhook(
    payment: MercadoPagoPayment,
    stableReference: string
  ): Promise<void> {
    const metadata = toRecord(payment.metadata)
    const sessionId =
      typeof metadata.payment_session_id === "string"
        ? metadata.payment_session_id
        : undefined
    const requestFingerprint =
      typeof metadata.request_fingerprint === "string"
        ? metadata.request_fingerprint
        : undefined

    if (!sessionId || !requestFingerprint) {
      return
    }

    const attemptId = createAttemptId({
      sessionId,
      providerKind: this.providerKind,
      requestFingerprint,
    })
    let attempt: StoredMercadoPagoAttempt | undefined
    try {
      attempt = await this.attemptStore_.retrieveMercadoPagoAttempt(attemptId)
    } catch {
      attempt = undefined
    }

    if (
      !attempt ||
      attempt.payment_collection_id !== stableReference ||
      !this.ownsPaymentAttempt(
        payment,
        stableReference,
        requestFingerprint,
        sessionId
      )
    ) {
      this.logger_.warn(
        structuredOrphanEvent("mercado_pago_untracked_orphan_webhook", {
          payment_session_id: sessionId,
          payment_collection_id: stableReference,
          provider_kind: this.providerKind,
          remote_payment_id: String(payment.id),
          remote_status: payment.status,
        })
      )
      return
    }

    if (
      !["compensated", "resolved_terminal", "manual_review", "reviewed"].includes(
        attempt.state
      )
    ) {
      await this.attemptStore_.updateMercadoPagoAttempts({
        id: attempt.id,
        state: "remote_found",
        remote_payment_id: String(payment.id),
        remote_status: payment.status,
      })
    }
    this.logger_.warn(
      structuredOrphanEvent("mercado_pago_orphan_webhook_recognized", {
        attempt_id: attempt.id,
        payment_session_id: sessionId,
        payment_collection_id: stableReference,
        provider_kind: this.providerKind,
        remote_payment_id: String(payment.id),
        remote_status: payment.status,
      })
    )
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
    requestFingerprint: string,
    sessionId: string
  ): MercadoPagoPayment | undefined {
    for (const payment of payments) {
      if (payment.external_reference !== stableReference) {
        continue
      }

      const metadata = toRecord(payment.metadata)
      if (metadata.payment_session_id !== sessionId) {
        continue
      }

      if (FAILED_PAYMENT_STATUSES.has(payment.status)) {
        continue
      }

      const existingFingerprint = String(metadata.request_fingerprint || "")

      if (existingFingerprint === requestFingerprint) {
        this.assertPaymentIdentity(
          payment,
          stableReference,
          expectedAmount,
          requestFingerprint,
          sessionId
        )
        return payment
      }

      throw new Error(
        "A different active Mercado Pago payment already exists for this payment session"
      )
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

  private ownsPaymentAttempt(
    payment: MercadoPagoPayment,
    stableReference: string,
    requestFingerprint: string,
    sessionId: string
  ): boolean {
    const metadata = toRecord(payment.metadata)

    return (
      payment.external_reference === stableReference &&
      metadata.payment_session_id === sessionId &&
      metadata.payment_collection_id === stableReference &&
      metadata.provider_kind === this.providerKind &&
      metadata.request_fingerprint === requestFingerprint
    )
  }

  private async bindRecoveredPaymentSession(
    sessionId: string,
    data: MercadoPagoSessionData
  ): Promise<void> {
    await this.paymentSessionStore_.update({ id: sessionId, data })
  }

  private async resolveWebhookSessionId(
    payment: MercadoPagoPayment,
    stableReference: string
  ): Promise<string | undefined> {
    const paymentId = String(payment.id)
    const sessions = await this.paymentSessionStore_.list(
      { payment_collection_id: stableReference },
      { order: { updated_at: "DESC" } }
    )
    const sessionsForPayment = sessions.filter((session) => {
      const data = toRecord(session.data)

      return (
        data.id === paymentId &&
        data.session_id === session.id &&
        data.payment_collection_id === stableReference &&
        data.provider_kind === this.providerKind
      )
    })

    if (!sessionsForPayment.length) {
      return undefined
    }

    const requestFingerprint = requireString(
      toRecord(payment.metadata).request_fingerprint,
      "Request fingerprint"
    )
    const matchingSessions = sessionsForPayment
      .filter((session) => {
        const data = toRecord(session.data)

        return data.request_fingerprint === requestFingerprint
      })
      .sort((left, right) => {
        const leftUpdatedAt = Date.parse(
          String(left.updated_at || left.created_at || "")
        )
        const rightUpdatedAt = Date.parse(
          String(right.updated_at || right.created_at || "")
        )

        return (Number.isFinite(rightUpdatedAt) ? rightUpdatedAt : 0) -
          (Number.isFinite(leftUpdatedAt) ? leftUpdatedAt : 0)
      })

    if (!matchingSessions.length) {
      throw new Error(
        "Active Medusa payment session fingerprint mismatch for webhook"
      )
    }

    return requireString(
      matchingSessions[0].id,
      "Current payment session ID"
    )
  }

  private async expirePixPaymentIfNecessary(
    payment: MercadoPagoPayment,
    stableReference: string,
    requestFingerprint: string,
    sessionId: string
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

    this.assertPaymentIdentity(
      payment,
      stableReference,
      undefined,
      requestFingerprint,
      sessionId
    )

    const canceled = await this.client_.cancelPayment(
      String(payment.id),
      createIdempotencyKey({
        stableReference,
        operation: "cancel",
        providerKind: this.providerKind,
        requestFingerprint,
        medusaOperationId: `pix-expiration:${sessionId}`,
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
    expectedFingerprint?: string,
    expectedSessionId?: string
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

    if (
      expectedSessionId &&
      metadata.payment_session_id !== expectedSessionId
    ) {
      throw new Error("Mercado Pago payment session ownership mismatch")
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

  private async toSessionData(
    payment: MercadoPagoPayment,
    sessionId: string,
    stableReference: string,
    requestFingerprint: string
  ): Promise<MercadoPagoSessionData> {
    const transactionData = payment.point_of_interaction?.transaction_data
    const publicTransactionData = transactionData
      ? {
          qr_code: transactionData.qr_code || undefined,
          qr_code_base64: transactionData.qr_code_base64 || undefined,
          ticket_url: transactionData.ticket_url || undefined,
        }
      : undefined
    const threeDsInfo = await this.toThreeDsInfo(
      payment,
      sessionId,
      stableReference,
      requestFingerprint
    )

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
      three_ds_info: threeDsInfo,
    }
  }

  private async toThreeDsInfo(
    payment: MercadoPagoPayment,
    sessionId: string,
    stableReference: string,
    requestFingerprint: string
  ): Promise<MercadoPagoSessionData["three_ds_info"]> {
    if (
      this.providerKind !== "card" ||
      payment.status !== "pending" ||
      payment.status_detail !== "pending_challenge"
    ) {
      return undefined
    }

    const remoteThreeDsInfo = toRecord(payment.three_ds_info)
    const remoteHasAnyValue = Object.values(remoteThreeDsInfo).some(
      (value) => value !== null && value !== undefined && value !== ""
    )
    let threeDsInfo = remoteThreeDsInfo

    if (!remoteHasAnyValue) {
      const attemptId = createAttemptId({
        sessionId,
        providerKind: this.providerKind,
        requestFingerprint,
      })
      let attempt: StoredMercadoPagoAttempt | undefined

      try {
        attempt = await this.attemptStore_.retrieveMercadoPagoAttempt(attemptId)
      } catch {
        attempt = undefined
      }

      if (
        attempt?.payment_session_id !== sessionId ||
        attempt.payment_collection_id !== stableReference ||
        attempt.provider_kind !== this.providerKind ||
        attempt.request_fingerprint !== requestFingerprint ||
        (attempt.remote_payment_id &&
          attempt.remote_payment_id !== String(payment.id))
      ) {
        throw new Error(
          "Mercado Pago 3DS challenge continuation is unavailable for this payment attempt"
        )
      }

      threeDsInfo = toRecord(attempt.three_ds_info)
    }

    if (!Object.keys(threeDsInfo).length) {
      throw new Error(
        "Mercado Pago 3DS challenge continuation is unavailable for this payment attempt"
      )
    }

    const challengeUrl = requireString(
      threeDsInfo.external_resource_url,
      "Mercado Pago 3DS challenge URL"
    )
    const creq = requireString(
      threeDsInfo.creq,
      "Mercado Pago 3DS challenge request"
    )

    let parsedChallengeUrl: URL
    try {
      parsedChallengeUrl = new URL(challengeUrl)
    } catch {
      throw new Error("Mercado Pago 3DS challenge URL is invalid")
    }

    if (
      parsedChallengeUrl.protocol !== "https:" ||
      !parsedChallengeUrl.hostname ||
      parsedChallengeUrl.username ||
      parsedChallengeUrl.password
    ) {
      throw new Error("Mercado Pago 3DS challenge URL must use HTTPS")
    }

    return { external_resource_url: challengeUrl, creq }
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
