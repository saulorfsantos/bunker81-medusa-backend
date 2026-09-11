import type {
  MercadoPagoCreatePayment,
  MercadoPagoOptions,
  MercadoPagoPayment,
} from "./types"

type RequestOptions = {
  method?: "GET" | "POST" | "PUT"
  body?: Record<string, unknown>
  idempotencyKey?: string
}

export class MercadoPagoClient {
  private readonly accessToken: string
  private readonly apiUrl: string
  private readonly requestTimeoutMs: number

  constructor(options: MercadoPagoOptions) {
    this.accessToken = options.accessToken
    this.apiUrl = (options.apiUrl || "https://api.mercadopago.com").replace(
      /\/$/,
      ""
    )
    this.requestTimeoutMs = options.requestTimeoutMs || 10_000
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
    amount: number,
    idempotencyKey: string
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      `/v1/payments/${encodeURIComponent(id)}/refunds`,
      {
        method: "POST",
        body: { amount },
        idempotencyKey,
      }
    )
  }

  private async request<T>(
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
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
        throw new Error(
          `Mercado Pago request failed with HTTP ${response.status}`
        )
      }

      return (await response.json()) as T
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Mercado Pago request timed out")
      }

      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
}
