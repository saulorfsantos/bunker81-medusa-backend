import { createHmac } from "node:crypto"
import { PaymentActions, PaymentSessionStatus } from "@medusajs/framework/utils"
import { MercadoPagoClient } from "../client"
import { createAttemptId } from "../attempts"
import { createIdempotencyKey, createPaymentFingerprint } from "../idempotency"
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
  const normalizedSessions = sessions.map((session) => ({
    payment_collection_id: "paycol_cart_1",
    ...session,
  }))
  const paymentSessionService = {
    list: jest.fn().mockResolvedValue(normalizedSessions),
    retrieve: jest.fn().mockImplementation(async (id: string) => {
      return (
        normalizedSessions.find((session) => session.id === id) || {
          id,
          payment_collection_id: "paycol_cart_1",
          data: { session_id: id },
        }
      )
    }),
    update: jest.fn().mockResolvedValue(undefined),
  }
  const attempts = new Map<string, Record<string, unknown>>()
  const mercadoPagoAttempt = {
    listMercadoPagoAttempts: jest.fn().mockImplementation(async () =>
      Array.from(attempts.values())
    ),
    retrieveMercadoPagoAttempt: jest.fn().mockImplementation(async (id: string) => {
      const attempt = attempts.get(id)
      if (!attempt) {
        throw Object.assign(new Error("attempt not found"), { type: "not_found" })
      }
      return attempt
    }),
    createMercadoPagoAttempts: jest.fn().mockImplementation(async (data) => {
      if (attempts.has(data.id)) {
        throw Object.assign(new Error("duplicate attempt"), { code: "23505" })
      }
      const attempt = {
        ...data,
        created_at: new Date(),
        updated_at: new Date(),
      }
      attempts.set(data.id, attempt)
      return attempt
    }),
    updateMercadoPagoAttempts: jest.fn().mockImplementation(async (data) => {
      const attempt = { ...attempts.get(data.id), ...data, updated_at: new Date() }
      attempts.set(data.id, attempt)
      return attempt
    }),
  }
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }

  return { paymentSessionService, mercadoPagoAttempt, logger, attempts }
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

const seedStoredContinuation = (
  container: ReturnType<typeof serviceContainer>,
  overrides: {
    sessionId?: string
    requestFingerprint?: string
    remotePaymentId?: string
    challengeUrl?: string
    creq?: string
  } = {}
) => {
  const sessionId = overrides.sessionId || "payses_1"
  const requestFingerprint = overrides.requestFingerprint || "fingerprint-1"
  const id = createAttemptId({
    sessionId,
    providerKind: "card",
    requestFingerprint,
  })
  container.attempts.set(id, {
    id,
    payment_session_id: sessionId,
    payment_collection_id: "paycol_cart_1",
    provider_kind: "card",
    request_fingerprint: requestFingerprint,
    idempotency_key: "unit-idempotency-key",
    amount: 100,
    currency_code: "brl",
    state: "bound",
    reconcile_after: new Date(0),
    remote_payment_id: overrides.remotePaymentId || "12345",
    three_ds_info: {
      external_resource_url:
        overrides.challengeUrl || "https://issuer.example.test/challenge",
      creq: overrides.creq || "stored-challenge-request",
    },
    created_at: new Date(),
  })
}

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

  test("fails closed before Mercado Pago when collection input is manipulated", async () => {
    const container = serviceContainer()
    const service = new MercadoPagoCardProviderService(container, options)

    await expect(
      service.initiatePayment(
        initiateInput({ payment_collection_id: "paycol_VICTIM" })
      )
    ).rejects.toThrow("does not own this payment session")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("fails closed before Mercado Pago when the payment session does not exist", async () => {
    const container = serviceContainer()
    container.paymentSessionService.retrieve.mockRejectedValueOnce(
      new Error("not found")
    )
    const service = new MercadoPagoCardProviderService(container, options)

    await expect(service.initiatePayment(initiateInput())).rejects.toThrow(
      "payment session was not found"
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

  test("does not recover a payment owned by an earlier local session", async () => {
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
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as MercadoPagoCreatePayment
        return jsonResponse(paymentFromCreate(body, { id: 67890 }))
      })

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

    expect(result.id).toBe("67890")
    expect(result.data?.session_id).toBe("payses_1")
    expect(container.paymentSessionService.update).not.toHaveBeenCalled()
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

  test("persists an orphan candidate when create is accepted but search is initially empty", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [] }))
      .mockRejectedValueOnce(new TypeError("simulated lost response"))
      .mockResolvedValueOnce(jsonResponse({ results: [] }))

    const container = serviceContainer()
    const service = new MercadoPagoCardProviderService(container, options)

    await expect(service.initiatePayment(initiateInput())).rejects.toThrow(
      "simulated lost response"
    )
    expect(container.attempts.size).toBe(1)
    expect(Array.from(container.attempts.values())[0]).toMatchObject({
      payment_session_id: "payses_1",
      payment_collection_id: "paycol_cart_1",
      provider_kind: "card",
      state: "creating",
      last_error_code: "create_response_unconfirmed",
    })
  })

  test.each([
    ["transport timeout", new TypeError("simulated timeout")],
    ["HTTP 5xx", jsonResponse({}, 503)],
  ])(
    "allows a new card fingerprint after an ambiguous %s create failure",
    async (_label, failure) => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ results: [] }))
        .mockImplementationOnce(async () => {
          if (failure instanceof Response) return failure
          throw failure
        })
        .mockResolvedValueOnce(jsonResponse({ results: [] }))
        .mockResolvedValueOnce(jsonResponse({ results: [] }))
        .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body)) as MercadoPagoCreatePayment
          return jsonResponse(paymentFromCreate(body, { id: 99002 }))
        })

      const container = serviceContainer()
      const service = new MercadoPagoCardProviderService(container, options)

      await expect(service.initiatePayment(initiateInput())).rejects.toThrow()
      const retry = await service.initiatePayment(
        initiateInput({ token: "fresh-card-token" })
      )

      expect(retry.id).toBe("99002")
      expect(
        Array.from(container.attempts.values()).map((attempt) => attempt.state)
      ).toEqual(expect.arrayContaining(["creating", "bound"]))
    }
  )

  test("closes a definitive HTTP 400 create failure without recovery polling", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [] }))
      .mockResolvedValueOnce(jsonResponse({}, 400))
      .mockResolvedValueOnce(jsonResponse({ results: [] }))
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as MercadoPagoCreatePayment
        return jsonResponse(paymentFromCreate(body, { id: 99003 }))
      })

    const container = serviceContainer()
    const service = new MercadoPagoCardProviderService(container, options)
    await expect(service.initiatePayment(initiateInput())).rejects.toThrow(
      "HTTP 400"
    )

    expect(Array.from(container.attempts.values())[0]).toMatchObject({
      state: "resolved_terminal",
      last_error_code: "create_rejected_http_400",
    })
    const retry = await service.initiatePayment(
      initiateInput({ token: "fresh-card-token" })
    )
    expect(retry.id).toBe("99003")
  })

  test("allows Pix fallback after an ambiguous card create failure", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [] }))
      .mockRejectedValueOnce(new TypeError("simulated timeout"))
      .mockResolvedValueOnce(jsonResponse({ results: [] }))
      .mockResolvedValueOnce(jsonResponse({ results: [] }))
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as MercadoPagoCreatePayment
        return jsonResponse(paymentFromCreate(body, { id: 99004 }))
      })

    const container = serviceContainer()
    const card = new MercadoPagoCardProviderService(container, options)
    const pix = new MercadoPagoPixProviderService(container, options)
    await expect(card.initiatePayment(initiateInput())).rejects.toThrow(
      "simulated timeout"
    )
    const fallback = await pix.initiatePayment(
      initiateInput({
        session_id: "payses_pix_fallback",
        payer_identification: { type: "CPF", number: "unit-only" },
      })
    )

    expect(fallback.id).toBe("99004")
    expect(fallback.data?.provider_kind).toBe("pix")
  })

  test("does not let an old manual review attempt brick a new session", async () => {
    const container = serviceContainer()
    container.attempts.set("mpatt_old_review", {
      id: "mpatt_old_review",
      payment_session_id: "payses_old",
      payment_collection_id: "paycol_cart_1",
      provider_kind: "card",
      request_fingerprint: "old-fingerprint",
      idempotency_key: "old-key",
      amount: 100,
      currency_code: "brl",
      state: "manual_review",
      reconcile_after: new Date(0),
      created_at: new Date(0),
    })
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [] }))
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as MercadoPagoCreatePayment
        return jsonResponse(paymentFromCreate(body, { id: 99005 }))
      })

    const service = new MercadoPagoCardProviderService(container, options)
    const result = await service.initiatePayment(
      initiateInput({ session_id: "payses_new" })
    )

    expect(result.id).toBe("99005")
    expect(container.attempts.get("mpatt_old_review")?.state).toBe(
      "manual_review"
    )
  })

  test.each(["manual_review", "reviewed"] as const)(
    "never adopts or compensates a winner from an exact %s attempt",
    async (state) => {
      const fingerprint = createPaymentFingerprint({
        amount: 100,
        currencyCode: "BRL",
        providerKind: "card",
        paymentMethodId: "visa",
        token: "card-token-1",
        installments: 1,
      })
      const container = serviceContainer()
      const attemptId = createAttemptId({
        sessionId: "payses_1",
        providerKind: "card",
        requestFingerprint: fingerprint,
      })
      container.attempts.set(attemptId, {
        id: attemptId,
        payment_session_id: "payses_1",
        payment_collection_id: "paycol_cart_1",
        provider_kind: "card",
        request_fingerprint: fingerprint,
        idempotency_key: createIdempotencyKey({
          stableReference: "paycol_cart_1",
          operation: "create",
          providerKind: "card",
          requestFingerprint: fingerprint,
          medusaOperationId: "payses_1",
        }),
        amount: 100,
        currency_code: "brl",
        state,
        reconcile_after: new Date(0),
      })
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          results: [
            storedPayment({
              status: "approved",
              captured: true,
              metadata: {
                ...storedPayment().metadata,
                request_fingerprint: fingerprint,
              },
            }),
          ],
        })
      )
      const service = new MercadoPagoCardProviderService(container, options)

      await expect(service.initiatePayment(initiateInput())).rejects.toThrow(
        "this exact attempt is being reconciled"
      )
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes("/refunds"))
      ).toBe(false)
    }
  )

  test("propagates a genuine attempt database read error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }))
    const container = serviceContainer()
    container.mercadoPagoAttempt.retrieveMercadoPagoAttempt.mockRejectedValueOnce(
      new Error("database unavailable")
    )
    const service = new MercadoPagoCardProviderService(container, options)

    await expect(service.initiatePayment(initiateInput())).rejects.toThrow(
      "database unavailable"
    )
    expect(
      container.mercadoPagoAttempt.createMercadoPagoAttempts
    ).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test("checks idempotency ownership after a concurrent attempt insert", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }))
    const container = serviceContainer()
    const notFound = Object.assign(new Error("not found"), {
      type: "not_found",
    })
    container.mercadoPagoAttempt.retrieveMercadoPagoAttempt
      .mockRejectedValueOnce(notFound)
      .mockResolvedValueOnce({
        payment_session_id: "payses_1",
        payment_collection_id: "paycol_cart_1",
        provider_kind: "card",
        request_fingerprint: createPaymentFingerprint({
          amount: 100,
          currencyCode: "BRL",
          providerKind: "card",
          paymentMethodId: "visa",
          token: "card-token-1",
          installments: 1,
        }),
        idempotency_key: "foreign-idempotency-key",
      })
    container.mercadoPagoAttempt.createMercadoPagoAttempts.mockRejectedValueOnce(
      Object.assign(new Error("duplicate"), { code: "23505" })
    )
    const service = new MercadoPagoCardProviderService(container, options)

    await expect(service.initiatePayment(initiateInput())).rejects.toThrow(
      "attempt ownership mismatch"
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test("does not recover a canceled payment with the same fingerprint from another session", async () => {
    const fingerprint = createPaymentFingerprint({
      amount: 100,
      currencyCode: "BRL",
      providerKind: "card",
      paymentMethodId: "visa",
      token: "card-token-1",
      installments: 1,
    })
    const canceled = storedPayment({
      status: "cancelled",
      metadata: {
        ...storedPayment().metadata,
        payment_session_id: "payses_canceled",
        request_fingerprint: fingerprint,
      },
    })
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [canceled] }))
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as MercadoPagoCreatePayment
        return jsonResponse(paymentFromCreate(body, { id: 67891 }))
      })

    const service = new MercadoPagoCardProviderService(
      serviceContainer(),
      options
    )
    const result = await service.initiatePayment(initiateInput())

    expect(result.id).toBe("67891")
    expect(result.data?.session_id).toBe("payses_1")
    expect(fetchMock.mock.calls[1][1]?.method).toBe("POST")
  })

  test("does not adopt a terminal payment owned by the current session", async () => {
    const fingerprint = createPaymentFingerprint({
      amount: 100,
      currencyCode: "BRL",
      providerKind: "card",
      paymentMethodId: "visa",
      token: "card-token-1",
      installments: 1,
    })
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            storedPayment({
              status: "cancelled",
              metadata: {
                ...storedPayment().metadata,
                request_fingerprint: fingerprint,
              },
            }),
          ],
        })
      )
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as MercadoPagoCreatePayment
        return jsonResponse(paymentFromCreate(body, { id: 67892 }))
      })

    const service = new MercadoPagoCardProviderService(
      serviceContainer(),
      options
    )

    await expect(service.initiatePayment(initiateInput())).resolves.toMatchObject({
      id: "67892",
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test("keeps the creation key stable when retrying the same payment session", async () => {
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
    await service.initiatePayment(initiateInput())

    expect(creationKeys).toHaveLength(2)
    expect(creationKeys[0]).toBe(creationKeys[1])
  })

  test("allows a new card token after a rejected attempt", async () => {
    const rejected = storedPayment({
      status: "rejected",
      metadata: {
        ...storedPayment().metadata,
        payment_session_id: "payses_1",
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

  test("uses a different creation key for every new payment session", async () => {
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
    expect(creationKeys[0]).not.toBe(creationKeys[1])
  })

  test("creates a fresh Pix attempt across Pix to card to Pix session changes", async () => {
    const createdPayments: MercadoPagoPayment[] = []
    const creationKeys: string[] = []
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/search?")) {
        return jsonResponse({ results: createdPayments })
      }

      const body = JSON.parse(String(init?.body)) as MercadoPagoCreatePayment
      const payment = paymentFromCreate(body, {
        id: 20000 + createdPayments.length,
      })
      creationKeys.push(
        String((init?.headers as Record<string, string>)["X-Idempotency-Key"])
      )
      createdPayments.push(payment)
      return jsonResponse(payment)
    })

    const pixService = new MercadoPagoPixProviderService(
      serviceContainer(),
      options
    )
    const cardService = new MercadoPagoCardProviderService(
      serviceContainer(),
      options
    )
    const firstPix = await pixService.initiatePayment(
      initiateInput({
        session_id: "payses_pix_1",
        payer_identification: { type: "CPF", number: "unit-only" },
      })
    )
    await cardService.initiatePayment(
      initiateInput({ session_id: "payses_card_1" })
    )
    const secondPix = await pixService.initiatePayment(
      initiateInput({
        session_id: "payses_pix_2",
        payer_identification: { type: "CPF", number: "unit-only" },
      })
    )

    expect(firstPix.id).toBe("20000")
    expect(secondPix.id).toBe("20002")
    expect(createdPayments).toHaveLength(3)
    expect(new Set(creationKeys).size).toBe(3)
  })

  test("old-session cancellation racing new-session creation cannot cancel the new Pix", async () => {
    const fingerprint = createPaymentFingerprint({
      amount: 100,
      currencyCode: "BRL",
      providerKind: "pix",
      paymentMethodId: "pix",
    })
    const oldPayment = storedPayment({
      id: 31001,
      status: "pending",
      captured: true,
      payment_method_id: "pix",
      payment_type_id: "bank_transfer",
      metadata: {
        ...storedPayment().metadata,
        payment_session_id: "payses_pix_old",
        provider_kind: "pix",
        request_fingerprint: fingerprint,
      },
    })
    const oldData = {
      ...storedData,
      id: "31001",
      session_id: "payses_pix_old",
      provider_kind: "pix",
      status: "pending",
      payment_method_id: "pix",
      payment_type_id: "bank_transfer",
      request_fingerprint: fingerprint,
    }
    let markCancelStarted!: () => void
    let releaseCancel!: () => void
    const cancelStarted = new Promise<void>((resolve) => {
      markCancelStarted = resolve
    })
    const cancelMayFinish = new Promise<void>((resolve) => {
      releaseCancel = resolve
    })

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (
        url.endsWith("/v1/payments/31001") &&
        (!init?.method || init.method === "GET")
      ) {
        return jsonResponse(oldPayment)
      }
      if (url.endsWith("/v1/payments/31001") && init?.method === "PUT") {
        markCancelStarted()
        await cancelMayFinish
        return jsonResponse({ ...oldPayment, status: "cancelled" })
      }
      if (url.includes("/search?")) {
        return jsonResponse({ results: [oldPayment] })
      }
      if (url.endsWith("/v1/payments") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as MercadoPagoCreatePayment
        return jsonResponse(paymentFromCreate(body, { id: 31002 }))
      }

      throw new Error(`Unexpected request: ${url}`)
    })

    const oldService = new MercadoPagoPixProviderService(
      serviceContainer(),
      options
    )
    const newService = new MercadoPagoPixProviderService(
      serviceContainer(),
      options
    )
    const cancelPromise = oldService.cancelPayment({ data: oldData })
    await cancelStarted

    let newAttempt
    try {
      newAttempt = await newService.initiatePayment(
        initiateInput({
          session_id: "payses_pix_new",
          payer_identification: { type: "CPF", number: "unit-only" },
        })
      )
    } finally {
      releaseCancel()
    }
    const canceledAttempt = await cancelPromise

    expect(newAttempt.id).toBe("31002")
    expect(newAttempt.data?.session_id).toBe("payses_pix_new")
    expect(canceledAttempt.data?.id).toBe("31001")
    expect(canceledAttempt.data?.status).toBe("cancelled")
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("/refunds"))
    ).toBe(false)
  })

  test("does not compensate the winner when unrelated concurrent attempts race", async () => {
    let searchCount = 0
    let releaseSearches!: () => void
    const searchesStarted = new Promise<void>((resolve) => {
      releaseSearches = resolve
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

    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1)
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
    ).toContain("session ownership mismatch")
    expect(creationKeys).toHaveLength(2)
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

  test("never promotes client-supplied 3DS data to a trusted challenge", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [] }))
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as MercadoPagoCreatePayment
        return jsonResponse(paymentFromCreate(body))
      })
    const service = new MercadoPagoCardProviderService(
      serviceContainer(),
      options
    )
    const result = await service.initiatePayment(
      initiateInput({
        three_ds_info: {
          external_resource_url: "https://attacker.fake.invalid/phish",
          creq: "untrusted-client-creq",
        },
      })
    )

    expect(result.data?.three_ds_info).toBeUndefined()
    expect(JSON.stringify(result.data)).not.toContain("attacker.fake.invalid")
  })

  test("preserves stored 3DS continuation when pending GET responses omit it", async () => {
    const pendingChallenge = storedPayment({
      status: "pending",
      status_detail: "pending_challenge",
      three_ds_info: undefined,
    })
    const challengeData = {
      ...storedData,
      status: "pending",
      status_detail: "pending_challenge",
      three_ds_info: {
        external_resource_url: "https://issuer.example.test/challenge",
        creq: "stored-challenge-request",
      },
    }
    fetchMock.mockImplementation(async () => jsonResponse(pendingChallenge))

    const container = serviceContainer()
    seedStoredContinuation(container)
    const service = new MercadoPagoCardProviderService(container, options)
    const status = await service.getPaymentStatus({ data: challengeData })
    const authorized = await service.authorizePayment({ data: challengeData })
    const retrieved = await service.retrievePayment({ data: challengeData })
    const updated = await service.updatePayment({
      amount: { value: "100" },
      currency_code: "BRL",
      data: challengeData,
    })

    for (const result of [status, authorized, retrieved, updated]) {
      expect(result.data).toMatchObject({
        three_ds_info: challengeData.three_ds_info,
      })
    }
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  test.each([
    ["null fields", { external_resource_url: null, creq: null }],
    ["empty object", {}],
    ["omitted", undefined],
  ])(
    "uses same-attempt server continuation when remote 3DS is %s",
    async (_label, remoteThreeDsInfo) => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          storedPayment({
            status: "pending",
            status_detail: "pending_challenge",
            three_ds_info: remoteThreeDsInfo,
          })
        )
      )
      const container = serviceContainer()
      seedStoredContinuation(container)
      const service = new MercadoPagoCardProviderService(container, options)

      const result = await service.getPaymentStatus({ data: storedData })
      expect(result.data?.three_ds_info).toEqual({
        external_resource_url: "https://issuer.example.test/challenge",
        creq: "stored-challenge-request",
      })
    }
  )

  test("fails closed when a null remote 3DS continuation has no trusted stored value", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        storedPayment({
          status: "pending",
          status_detail: "pending_challenge",
          three_ds_info: { external_resource_url: null, creq: null },
        })
      )
    )
    const service = new MercadoPagoCardProviderService(
      serviceContainer(),
      options
    )

    await expect(
      service.getPaymentStatus({ data: storedData })
    ).rejects.toThrow("continuation is unavailable for this payment attempt")
  })

  test("never reuses a trusted challenge from another session", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        storedPayment({
          status: "pending",
          status_detail: "pending_challenge",
          three_ds_info: undefined,
        })
      )
    )
    const container = serviceContainer()
    seedStoredContinuation(container, { sessionId: "payses_other" })
    const service = new MercadoPagoCardProviderService(container, options)

    await expect(
      service.getPaymentStatus({ data: storedData })
    ).rejects.toThrow("continuation is unavailable for this payment attempt")
  })

  test("continues to reject non-HTTPS 3DS challenge URLs", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        storedPayment({
          status: "pending",
          status_detail: "pending_challenge",
          three_ds_info: {
            external_resource_url: "http://issuer.example.test/challenge",
            creq: "challenge-request",
          },
        })
      )
    )

    const service = new MercadoPagoCardProviderService(
      serviceContainer(),
      options
    )

    await expect(
      service.getPaymentStatus({ data: storedData })
    ).rejects.toThrow("3DS challenge URL must use HTTPS")
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

  test("ignores a valid payment webhook when no live session owns it", async () => {
    const now = Date.now()
    const timestamp = String(now)
    const dataId = "orphan-123"
    const requestId = "request-orphan"
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
      serviceContainer([]),
      options
    )

    await expect(
      service.getWebhookActionAndData({
        data: { type: "payment", data_id: dataId },
        rawData: "{}",
        headers: {
          "x-request-id": requestId,
          "x-signature": `ts=${timestamp},v1=${signature}`,
        },
      })
    ).resolves.toEqual({ action: PaymentActions.NOT_SUPPORTED })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test("recognizes a late orphan webhook without adopting another session", async () => {
    const timestamp = String(Date.now())
    const dataId = "orphan-tracked-123"
    const requestId = "request-orphan-tracked"
    const manifest = `id:${dataId};request-id:${requestId};ts:${timestamp};`
    const signature = createHmac("sha256", options.webhookSecret)
      .update(manifest)
      .digest("hex")
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        storedPayment({ id: dataId, status: "approved", captured: true })
      )
    )
    const container = serviceContainer([])
    seedStoredContinuation(container, { remotePaymentId: dataId })
    const service = new MercadoPagoCardProviderService(container, options)

    await expect(
      service.getWebhookActionAndData({
        data: { type: "payment", data_id: dataId },
        rawData: "{}",
        headers: {
          "x-request-id": requestId,
          "x-signature": `ts=${timestamp},v1=${signature}`,
        },
      })
    ).resolves.toEqual({ action: PaymentActions.NOT_SUPPORTED })
    expect(container.paymentSessionService.update).not.toHaveBeenCalled()
    expect(Array.from(container.attempts.values())[0]).toMatchObject({
      state: "remote_found",
      remote_payment_id: dataId,
      remote_status: "approved",
    })
    expect(container.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("mercado_pago_orphan_webhook_recognized")
    )
  })

  test("does not mask an ownership error for a webhook with an active session", async () => {
    const timestamp = String(Date.now())
    const dataId = "active-123"
    const requestId = "request-active"
    const manifest = `id:${dataId};request-id:${requestId};ts:${timestamp};`
    const signature = createHmac("sha256", options.webhookSecret)
      .update(manifest)
      .digest("hex")
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        storedPayment({
          id: dataId,
          metadata: {
            ...storedPayment().metadata,
            request_fingerprint: "unexpected-fingerprint",
          },
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

    await expect(
      service.getWebhookActionAndData({
        data: { type: "payment", data_id: dataId },
        rawData: "{}",
        headers: {
          "x-request-id": requestId,
          "x-signature": `ts=${timestamp},v1=${signature}`,
        },
      })
    ).rejects.toThrow("fingerprint mismatch for webhook")
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
