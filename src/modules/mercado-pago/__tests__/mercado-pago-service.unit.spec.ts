import { createHmac } from "node:crypto"
import { PaymentActions, PaymentSessionStatus } from "@medusajs/framework/utils"
import { MercadoPagoClient } from "../client"
import { createPaymentFingerprint } from "../idempotency"
import {
  MercadoPagoCardProviderService,
  MercadoPagoPixProviderService,
} from "../service"
import type {
  MercadoPagoCreatePayment,
  MercadoPagoOptions,
  MercadoPagoPayment,
} from "../types"

const options: MercadoPagoOptions = {
  accessToken: "TEST-unit-only",
  webhookSecret: "unit-webhook-secret",
  webhookBaseUrl: "https://backend.example.test",
  apiUrl: "https://api.example.test",
  liveMode: false,
  maxRetries: 0,
  retryDelayMs: 0,
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

const paymentFromCreate = (
  body: MercadoPagoCreatePayment,
  overrides: Partial<MercadoPagoPayment> = {}
): MercadoPagoPayment => ({
  id: 12345,
  status: body.capture ? "pending" : "authorized",
  captured: body.capture,
  transaction_amount: body.transaction_amount,
  currency_id: "BRL",
  external_reference: body.external_reference,
  payment_method_id: body.payment_method_id,
  payment_type_id:
    body.payment_method_id === "pix" ? "bank_transfer" : "credit_card",
  live_mode: false,
  metadata: body.metadata,
  ...overrides,
})

const storedPayment = (
  overrides: Partial<MercadoPagoPayment> = {}
): MercadoPagoPayment => ({
  id: 12345,
  status: "authorized",
  captured: false,
  transaction_amount: 100,
  currency_id: "BRL",
  external_reference: "paycol_cart_1",
  payment_method_id: "visa",
  payment_type_id: "credit_card",
  live_mode: false,
  metadata: {
    payment_session_id: "payses_1",
    payment_collection_id: "paycol_cart_1",
    provider_kind: "card",
    request_fingerprint: "fingerprint-1",
  },
  ...overrides,
})

const storedData = {
  id: "12345",
  session_id: "payses_1",
  payment_collection_id: "paycol_cart_1",
  provider_kind: "card",
  status: "authorized",
  transaction_amount: 100,
  currency_id: "BRL",
  payment_method_id: "visa",
  payment_type_id: "credit_card",
  live_mode: false,
  request_fingerprint: "fingerprint-1",
}

const serviceContainer = (
  sessions: Array<{
    id: string
    data: Record<string, unknown>
    created_at?: Date | string
    updated_at?: Date | string
  }> = [
    {
      id: "payses_1",
      data: storedData,
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  ]
) => {
  const paymentSessionService = {
    list: jest.fn().mockResolvedValue(sessions),
    update: jest.fn().mockResolvedValue(undefined),
  }

  return { paymentSessionService }
}

const initiateInput = (overrides: Record<string, unknown> = {}) => ({
  amount: { value: "100" },
  currency_code: "BRL",
  data: {
    session_id: "payses_1",
    payment_collection_id: "paycol_cart_1",
    token: "card-token-1",
    payment_method_id: "visa",
    installments: 1,
    ...overrides,
  },
  context: {
    customer: {
      id: "cus_1",
      email: "buyer@example.test",
    },
  },
})

describe("Mercado Pago provider service", () => {
  const fetchMock = jest.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock as typeof fetch
  })

  test("creates card payments as auth-only and captures only in capturePayment", async () => {
    let createBody: MercadoPagoCreatePayment | undefined
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/search?")) {
        return jsonResponse({ results: [] })
      }

      if (init?.method === "POST") {
        createBody = JSON.parse(String(init.body)) as MercadoPagoCreatePayment
        return jsonResponse(paymentFromCreate(createBody))
      }

      throw new Error(`Unexpected request: ${url}`)
    })

    const service = new MercadoPagoCardProviderService(
      serviceContainer(),
      options
    )
    const initiated = await service.initiatePayment(initiateInput())

    expect(createBody?.capture).toBe(false)
    expect(createBody?.binary_mode).toBe(false)
    expect(createBody?.three_d_secure_mode).toBe("optional")
    expect(createBody?.external_reference).toBe("paycol_cart_1")
    expect(initiated.status).toBe(PaymentSessionStatus.AUTHORIZED)
    expect(initiated.data?.token).toBeNull()

    const remoteAuthorized = paymentFromCreate(createBody!)
    fetchMock.mockReset()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(remoteAuthorized))
      .mockResolvedValueOnce(
        jsonResponse({
          ...remoteAuthorized,
          status: "approved",
          captured: true,
        })
      )

    const captured = await service.capturePayment({
      data: initiated.data,
      context: { idempotency_key: "capture_1" },
    })

    const captureRequest = fetchMock.mock.calls[1][1] as RequestInit
    expect(JSON.parse(String(captureRequest.body))).toEqual({ capture: true })
    expect(captured.data?.status).toBe("approved")
  })

  test("validates credential mode before searching or creating a payment", async () => {
    const service = new MercadoPagoCardProviderService(serviceContainer(), {
      ...options,
      liveMode: true,
    })

    await expect(service.initiatePayment(initiateInput())).rejects.toThrow(
      "credential environment mismatch"
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("detects APP_USR test-user credentials before payment creation", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ nickname: "TESTSELLER", tags: ["test_user"] })
    )
    const client = new MercadoPagoClient({
      ...options,
      accessToken: "APP_USR-unit-only",
    })

    await expect(client.validateEnvironment(false)).resolves.toBeUndefined()
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.test/users/me")
  })

  test("retries credential validation after a transient failure", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("temporary validation outage"))
      .mockResolvedValueOnce(
        jsonResponse({ nickname: "TESTSELLER", tags: ["test_user"] })
      )
    const client = new MercadoPagoClient({
      ...options,
      accessToken: "APP_USR-unit-only",
    })

    await expect(client.validateEnvironment(false)).rejects.toThrow(
      "temporary validation outage"
    )
    await expect(client.validateEnvironment(false)).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test("cancels an authorization when post-create identity validation fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [] }))
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as MercadoPagoCreatePayment
        return jsonResponse(
          paymentFromCreate(body, { transaction_amount: body.transaction_amount + 1 })
        )
      })
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body))
        expect(body).toEqual({ status: "cancelled" })
        return jsonResponse(storedPayment({ status: "cancelled" }))
      })

    const service = new MercadoPagoCardProviderService(
      serviceContainer(),
      options
    )

    await expect(service.initiatePayment(initiateInput())).rejects.toThrow(
      "payment amount mismatch"
    )
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  test("refunds an unexpectedly captured card returned by create", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [] }))
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as MercadoPagoCreatePayment
        return jsonResponse(
          paymentFromCreate(body, { status: "approved", captured: true })
        )
      })
      .mockResolvedValueOnce(
        jsonResponse({
          id: 991,
          payment_id: 12345,
          amount: 100,
          status: "approved",
        })
      )

    const service = new MercadoPagoCardProviderService(
      serviceContainer(),
      options
    )

    await expect(service.initiatePayment(initiateInput())).rejects.toThrow(
      "unexpectedly captured"
    )
    expect(fetchMock.mock.calls[2][0]).toContain("/refunds")
  })

  test("routes a recovered payment webhook only to the current local session", async () => {
    const fingerprint = createPaymentFingerprint({
      amount: 100,
      currencyCode: "BRL",
      providerKind: "card",
      paymentMethodId: "visa",
      token: "card-token-1",
      installments: 1,
    })
    const existing = storedPayment({
      metadata: {
        ...storedPayment().metadata,
        payment_session_id: "payses_lost",
        request_fingerprint: fingerprint,
      },
    })
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [existing] }))
      .mockResolvedValueOnce(jsonResponse(existing))

    const container = serviceContainer([
      {
        id: "payses_lost",
        data: {
          ...storedData,
          session_id: "payses_lost",
          request_fingerprint: fingerprint,
        },
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "payses_1",
        data: {
          ...storedData,
          session_id: "payses_1",
          request_fingerprint: fingerprint,
        },
        updated_at: "2026-01-01T00:01:00.000Z",
      },
    ])
    const service = new MercadoPagoCardProviderService(container, options)
    const result = await service.initiatePayment(initiateInput())

    expect(result.id).toBe("12345")
    expect(result.data?.session_id).toBe("payses_1")
    expect(container.paymentSessionService.update).toHaveBeenCalledWith({
      id: "payses_1",
      data: expect.objectContaining({
        id: "12345",
        session_id: "payses_1",
        request_fingerprint: fingerprint,
      }),
    })

    const timestamp = String(Date.now())
    const requestId = "request-recovered"
    const manifest = `id:12345;request-id:${requestId};ts:${timestamp};`
    const signature = createHmac("sha256", options.webhookSecret)
      .update(manifest)
      .digest("hex")
    const webhook = await service.getWebhookActionAndData({
      data: { type: "payment", data_id: "12345" },
      rawData: "{}",
      headers: {
        "x-request-id": requestId,
        "x-signature": `ts=${timestamp},v1=${signature}`,
      },
    })

    expect(webhook.data?.session_id).toBe("payses_1")
    expect(webhook.data?.session_id).not.toBe("payses_lost")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test("reconciles after the create response itself is lost", async () => {
    let createdRemotely: MercadoPagoPayment | undefined
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [] }))
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as MercadoPagoCreatePayment
        createdRemotely = paymentFromCreate(body)
        throw new TypeError("simulated lost response")
      })
      .mockImplementationOnce(async () =>
        jsonResponse({ results: [createdRemotely] })
      )

    const service = new MercadoPagoCardProviderService(
      serviceContainer(),
      options
    )
    const result = await service.initiatePayment(initiateInput())

    expect(result.id).toBe("12345")
    expect(result.status).toBe(PaymentSessionStatus.AUTHORIZED)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  test("allows a new card token after a rejected attempt", async () => {
    const rejected = storedPayment({
      status: "rejected",
      metadata: {
        ...storedPayment().metadata,
        request_fingerprint: "old-card-fingerprint",
      },
    })
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [rejected] }))
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as MercadoPagoCreatePayment
        return jsonResponse(paymentFromCreate(body))
      })

    const service = new MercadoPagoCardProviderService(
      serviceContainer(),
      options
    )
    const result = await service.initiatePayment(
      initiateInput({ token: "different-card-token" })
    )

    expect(result.status).toBe(PaymentSessionStatus.AUTHORIZED)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test("shares the first-attempt key across concurrent cart payment methods", async () => {
    const creationKeys: string[] = []
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/search?")) {
        return jsonResponse({ results: [] })
      }

      const body = JSON.parse(String(init?.body)) as MercadoPagoCreatePayment
      creationKeys.push(
        String((init?.headers as Record<string, string>)["X-Idempotency-Key"])
      )
      return jsonResponse(paymentFromCreate(body))
    })

    const service = new MercadoPagoCardProviderService(
      serviceContainer(),
      options
    )
    await service.initiatePayment(initiateInput())
    await service.initiatePayment(
      initiateInput({ session_id: "payses_2", token: "card-token-2" })
    )

    expect(creationKeys).toHaveLength(2)
    expect(creationKeys[0]).toBe(creationKeys[1])
  })

  test("does not compensate the winner when concurrent attempts race", async () => {
    let searchCount = 0
    let createCount = 0
    let releaseSearches!: () => void
    let releaseCreates!: () => void
    const searchesStarted = new Promise<void>((resolve) => {
      releaseSearches = resolve
    })
    const createsStarted = new Promise<void>((resolve) => {
      releaseCreates = resolve
    })
    const creationKeys: string[] = []
    let winningPayment: MercadoPagoPayment | undefined

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/search?")) {
        searchCount += 1
        if (searchCount === 2) {
          releaseSearches()
        }
        await searchesStarted
        return jsonResponse({ results: [] })
      }

      if (url.endsWith("/v1/payments") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as MercadoPagoCreatePayment
        creationKeys.push(
          String((init.headers as Record<string, string>)["X-Idempotency-Key"])
        )
        winningPayment ??= paymentFromCreate(body)
        createCount += 1
        if (createCount === 2) {
          releaseCreates()
        }
        await createsStarted
        return jsonResponse(winningPayment)
      }

      throw new Error(`Losing attempt tried to mutate the winner: ${url}`)
    })

    const container = serviceContainer()
    const firstService = new MercadoPagoCardProviderService(container, options)
    const secondService = new MercadoPagoCardProviderService(container, options)
    const outcomes = await Promise.allSettled([
      firstService.initiatePayment(initiateInput()),
      secondService.initiatePayment(
        initiateInput({ session_id: "payses_2", token: "card-token-2" })
      ),
    ])

    expect(
      outcomes.filter(({ status }) => status === "fulfilled")
    ).toHaveLength(1)
    expect(
      outcomes.filter(({ status }) => status === "rejected")
    ).toHaveLength(1)
    expect(
      String(
        (
          outcomes.find(
            ({ status }) => status === "rejected"
          ) as PromiseRejectedResult
        ).reason
      )
    ).toContain("request fingerprint mismatch")
    expect(creationKeys).toHaveLength(2)
    expect(creationKeys[0]).toBe(creationKeys[1])
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).includes("/refunds") ||
          (init as RequestInit | undefined)?.method === "PUT"
      )
    ).toBe(false)
  })

  test("returns the continuation payload when a card requires a 3DS challenge", async () => {
    let createBody: MercadoPagoCreatePayment | undefined
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [] }))
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        createBody = JSON.parse(String(init?.body)) as MercadoPagoCreatePayment
        return jsonResponse(
          paymentFromCreate(createBody, {
            status: "pending",
            status_detail: "pending_challenge",
            three_ds_info: {
              external_resource_url: "https://issuer.example.test/challenge",
              creq: "challenge-request",
            },
          })
        )
      })

    const service = new MercadoPagoCardProviderService(
      serviceContainer(),
      options
    )
    const result = await service.initiatePayment(initiateInput())

    expect(createBody).toMatchObject({
      capture: false,
      binary_mode: false,
      three_d_secure_mode: "optional",
    })
    expect(result.status).toBe(PaymentSessionStatus.PENDING_AUTHORIZATION)
    expect(result.data).toMatchObject({
      status: "pending",
      status_detail: "pending_challenge",
      three_ds_info: {
        external_resource_url: "https://issuer.example.test/challenge",
        creq: "challenge-request",
      },
    })
  })

  test("refuses an amount/card change while an active payment exists", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        results: [
          storedPayment({
            transaction_amount: 90,
            metadata: {
              ...storedPayment().metadata,
              request_fingerprint: "different-fingerprint",
            },
          }),
        ],
      })
    )

    const service = new MercadoPagoCardProviderService(
      serviceContainer(),
      options
    )
    await expect(service.initiatePayment(initiateInput())).rejects.toThrow(
      "different active Mercado Pago payment"
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test("refunds a captured payment instead of leaving it behind on delete", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(storedPayment({ status: "approved", captured: true }))
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: 992,
          payment_id: 12345,
          amount: 100,
          status: "approved",
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          storedPayment({
            status: "refunded",
            captured: true,
            transaction_amount_refunded: 100,
          })
        )
      )

    const service = new MercadoPagoCardProviderService(
      serviceContainer(),
      options
    )
    const result = await service.deletePayment({ data: storedData })

    expect(fetchMock.mock.calls[1][0]).toContain("/refunds")
    expect(result.data?.status).toBe("refunded")
  })

  test("requires a unique refund operation and validates the provider response", async () => {
    const service = new MercadoPagoCardProviderService(
      serviceContainer(),
      options
    )

    await expect(
      service.refundPayment({ amount: 10, data: storedData })
    ).rejects.toThrow("Refund operation ID is required")
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(storedPayment({ status: "approved", captured: true }))
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: 993,
          payment_id: 12345,
          amount: 10,
          status: "rejected",
        })
      )

    await expect(
      service.refundPayment({
        amount: 10,
        data: storedData,
        context: { idempotency_key: "refund_1" },
      })
    ).rejects.toThrow("did not confirm the refund")
  })

  test("filters unsupported webhook topics before signature validation", async () => {
    const service = new MercadoPagoCardProviderService(
      serviceContainer(),
      options
    )

    await expect(
      service.getWebhookActionAndData({
        data: { type: "merchant_order" },
        rawData: "{}",
        headers: {},
      })
    ).resolves.toEqual({ action: PaymentActions.NOT_SUPPORTED })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("uses normalized query data.id for HMAC and authoritative lookup", async () => {
    const now = Date.now()
    const timestamp = String(now)
    const dataId = "abc123"
    const requestId = "request-1"
    const manifest = `id:${dataId};request-id:${requestId};ts:${timestamp};`
    const signature = createHmac("sha256", options.webhookSecret)
      .update(manifest)
      .digest("hex")
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        storedPayment({
          id: dataId,
          status: "approved",
          captured: true,
        })
      )
    )
    const service = new MercadoPagoCardProviderService(
      serviceContainer([
        {
          id: "payses_1",
          data: { ...storedData, id: dataId },
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ]),
      options
    )

    const result = await service.getWebhookActionAndData({
      data: {
        type: "payment",
        data: { id: "body-is-not-authoritative" },
        data_id: "ABC123",
      },
      rawData: "{}",
      headers: {
        "x-request-id": requestId,
        "x-signature": `ts=${timestamp},v1=${signature}`,
      },
    })

    expect(fetchMock.mock.calls[0][0]).toContain("/payments/abc123")
    expect(result.action).toBe(PaymentActions.SUCCESSFUL)
    expect(result.data?.session_id).toBe("payses_1")
  })

  test("retries a transient request with bounded backoff", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse(storedPayment()))
    const client = new MercadoPagoClient({
      ...options,
      maxRetries: 1,
      retryDelayMs: 0,
    })

    await expect(client.getPayment("12345")).resolves.toMatchObject({
      id: 12345,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test("expires pending Pix during polling reconciliation", async () => {
    const pixPayment = storedPayment({
      status: "pending",
      captured: false,
      payment_method_id: "pix",
      payment_type_id: "bank_transfer",
      date_of_expiration: "2020-01-01T00:00:00.000Z",
      metadata: {
        ...storedPayment().metadata,
        provider_kind: "pix",
      },
    })
    fetchMock
      .mockResolvedValueOnce(jsonResponse(pixPayment))
      .mockResolvedValueOnce(
        jsonResponse({ ...pixPayment, status: "cancelled" })
      )
    const service = new MercadoPagoPixProviderService(
      serviceContainer(),
      options
    )

    const result = await service.updatePayment({
      amount: { numeric: 100, toJSON: () => 100, valueOf: () => 100 },
      currency_code: "BRL",
      data: {
        ...storedData,
        provider_kind: "pix",
      },
    })

    expect(result.status).toBe(PaymentSessionStatus.CANCELED)
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body))).toEqual({
      status: "cancelled",
    })
  })
})
