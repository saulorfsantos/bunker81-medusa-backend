import type {
  MercadoPagoAccount,
  MercadoPagoCreatePayment,
  MercadoPagoOptions,
  MercadoPagoPayment,
  MercadoPagoPaymentSearchResult,
  MercadoPagoRefund,
} from "./types"

type RequestOptions = {
  method?: "GET" | "POST" | "PUT"
  body?: Record<string, unknown>
  idempotencyKey?: string
}

const RETRYABLE_STATUS_CODES = new Set([
  408, 409, 425, 429, 500, 502, 503, 504,
])
const PAYMENT_SEARCH_PAGE_SIZE = 50
const PAYMENT_SEARCH_MAX_OFFSET = 10_000

export class MercadoPagoDefinitiveRequestError extends Error {
  readonly statusCode: number

  constructor(statusCode: number) {
    super(`Mercado Pago request failed with HTTP ${statusCode}`)
    this.name = "MercadoPagoDefinitiveRequestError"
    this.statusCode = statusCode
  }
}

export const isMercadoPagoDefinitiveRequestError = (
  error: unknown
): error is MercadoPagoDefinitiveRequestError =>
  error instanceof MercadoPagoDefinitiveRequestError

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

export class MercadoPagoClient {
  private readonly accessToken: string
  private readonly apiUrl: string
  private readonly requestTimeoutMs: number
  private readonly maxRetries: number
  private readonly retryDelayMs: number
  private environmentValidation?: Promise<void>

  constructor(options: MercadoPagoOptions) {
    this.accessToken = options.accessToken
    this.apiUrl = (options.apiUrl || "https://api.mercadopago.com").replace(
      /\/$/,
      ""
    )
    this.requestTimeoutMs = options.requestTimeoutMs || 10_000
    this.maxRetries = options.maxRetries ?? 2
    this.retryDelayMs = options.retryDelayMs ?? 150
  }

  async validateEnvironment(expectedLiveMode: boolean): Promise<void> {
    this.environmentValidation ??= this.validateEnvironment_(
      expectedLiveMode
    ).catch((error) => {
      this.environmentValidation = undefined
      throw error
    })
    return this.environmentValidation
  }

  private async validateEnvironment_(expectedLiveMode: boolean): Promise<void> {
    let actualLiveMode: boolean

    if (this.accessToken.startsWith("TEST-")) {
      actualLiveMode = false
    } else {
      const account = await this.request<MercadoPagoAccount>("/users/me")

      if (typeof account.nickname !== "string" || !account.nickname) {
        throw new Error("Mercado Pago credential validation response is invalid")
      }

      const isTestUser =
        account.tags?.includes("test_user") ||
        account.nickname.toUpperCase().startsWith("TEST")
      actualLiveMode = !isTestUser
    }

    if (actualLiveMode !== expectedLiveMode) {
      throw new Error("Mercado Pago credential environment mismatch")
    }
  }

  async createPayment(
    body: MercadoPagoCreatePayment,
    idempotencyKey: string
  ): Promise<MercadoPagoPayment> {
    return this.request<MercadoPagoPayment>("/v1/payments", {
      method: "POST",
      body,
      idempotencyKey,
    })
  }

  async getPayment(id: string): Promise<MercadoPagoPayment> {
    return this.request<MercadoPagoPayment>(
      `/v1/payments/${encodeURIComponent(id)}`
    )
  }

  async searchPayments(
    externalReference: string
  ): Promise<MercadoPagoPayment[]> {
    const payments: MercadoPagoPayment[] = []

    for (let offset = 0; offset <= PAYMENT_SEARCH_MAX_OFFSET; ) {
      const query = new URLSearchParams({
        external_reference: externalReference,
        sort: "date_created",
        criteria: "desc",
        limit: String(PAYMENT_SEARCH_PAGE_SIZE),
        offset: String(offset),
      })
      const page = await this.request<MercadoPagoPaymentSearchResult>(
        `/v1/payments/search?${query.toString()}`
      )
      const results = Array.isArray(page.results) ? page.results : []
      payments.push(...results)

      const total = Number(page.paging?.total)
      if (
        results.length < PAYMENT_SEARCH_PAGE_SIZE ||
        (Number.isFinite(total) && payments.length >= total)
      ) {
        return payments
      }

      offset += PAYMENT_SEARCH_PAGE_SIZE
    }

    throw new Error("Mercado Pago payment search exceeded the safe page limit")
  }

  async capturePayment(
    id: string,
    idempotencyKey: string
  ): Promise<MercadoPagoPayment> {
    return this.request<MercadoPagoPayment>(
      `/v1/payments/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        body: { capture: true },
        idempotencyKey,
      }
    )
  }

  async cancelPayment(
    id: string,
    idempotencyKey: string
  ): Promise<MercadoPagoPayment> {
    return this.request<MercadoPagoPayment>(
      `/v1/payments/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        body: { status: "cancelled" },
        idempotencyKey,
      }
    )
  }

  async refundPayment(
    id: string,
    amount: number | undefined,
    idempotencyKey: string
  ): Promise<MercadoPagoRefund> {
    return this.request<MercadoPagoRefund>(
      `/v1/payments/${encodeURIComponent(id)}/refunds`,
      {
        method: "POST",
        body: amount === undefined ? {} : { amount },
        idempotencyKey,
      }
    )
  }

  private async request<T>(
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
    let lastError: unknown

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs)

      try {
        const response = await fetch(`${this.apiUrl}${path}`, {
          method: options.method || "GET",
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "Content-Type": "application/json",
            ...(options.idempotencyKey
              ? { "X-Idempotency-Key": options.idempotencyKey }
              : {}),
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        })

        if (!response.ok) {
          if (!RETRYABLE_STATUS_CODES.has(response.status)) {
            throw new MercadoPagoDefinitiveRequestError(response.status)
          }

          lastError = new Error(
            `Mercado Pago request failed with HTTP ${response.status}`
          )
        } else {
          return (await response.json()) as T
        }
      } catch (error) {
        if (isMercadoPagoDefinitiveRequestError(error)) {
          throw error
        }

        lastError =
          error instanceof Error && error.name === "AbortError"
            ? new Error("Mercado Pago request timed out")
            : error
      } finally {
        clearTimeout(timeout)
      }

      if (attempt < this.maxRetries) {
        await wait(this.retryDelayMs * 2 ** attempt)
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Mercado Pago request failed")
  }
}
