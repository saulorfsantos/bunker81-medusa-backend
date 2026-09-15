import {
  ContainerRegistrationKeys,
  Modules,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import { MERCADO_PAGO_ATTEMPT_MODULE } from "../../modules/mercado-pago-attempt"
import type { StoredMercadoPagoAttempt } from "../../modules/mercado-pago/attempts"
import type { MercadoPagoPayment } from "../../modules/mercado-pago/types"
import { reconcileMercadoPagoOrphanAttempts } from "../mercado-pago-orphan-reconciliation"

const NOW = Date.parse("2026-09-15T15:00:00.000Z")

const attemptFixture = (
  overrides: Partial<StoredMercadoPagoAttempt> = {}
): StoredMercadoPagoAttempt => ({
  id: "mpatt_unit_1",
  payment_session_id: "payses_lost_1",
  payment_collection_id: "paycol_1",
  provider_kind: "card",
  request_fingerprint: "fingerprint-1",
  idempotency_key: "idempotency-unit-1",
  amount: 100,
  currency_code: "brl",
  state: "creating",
  reconcile_after: new Date(NOW - 1),
  reconciliation_attempts: 0,
  created_at: new Date(NOW - 11 * 60 * 1000),
  ...overrides,
})

const paymentFixture = (
  attempt: StoredMercadoPagoAttempt,
  overrides: Partial<MercadoPagoPayment> = {}
): MercadoPagoPayment => ({
  id: "mp_1",
  status: "pending",
  transaction_amount: 100,
  currency_id: "BRL",
  external_reference: attempt.payment_collection_id,
  payment_method_id: attempt.provider_kind === "pix" ? "pix" : "visa",
  payment_type_id:
    attempt.provider_kind === "pix" ? "bank_transfer" : "credit_card",
  live_mode: false,
  metadata: {
    payment_session_id: attempt.payment_session_id,
    payment_collection_id: attempt.payment_collection_id,
    provider_kind: attempt.provider_kind,
    request_fingerprint: attempt.request_fingerprint,
  },
  ...overrides,
})

const setup = (
  initialAttempts: StoredMercadoPagoAttempt[],
  paymentModuleOverrides: Record<string, unknown> = {}
) => {
  const attempts = new Map(initialAttempts.map((attempt) => [attempt.id, attempt]))
  const attemptStore = {
    listMercadoPagoAttempts: jest.fn().mockImplementation(async () =>
      Array.from(attempts.values())
    ),
    updateMercadoPagoAttempts: jest.fn().mockImplementation(async (data) => {
      const updated = { ...attempts.get(data.id), ...data }
      attempts.set(data.id, updated as StoredMercadoPagoAttempt)
      return updated
    }),
  }
  const paymentModule = {
    retrievePaymentSession: jest.fn().mockRejectedValue(new Error("not found")),
    listPaymentSessions: jest.fn().mockResolvedValue([]),
    updatePaymentSession: jest.fn(),
    ...paymentModuleOverrides,
  }
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const container = {
    resolve: jest.fn((key: string) => {
      if (key === MERCADO_PAGO_ATTEMPT_MODULE) return attemptStore
      if (key === Modules.PAYMENT) return paymentModule
      if (key === ContainerRegistrationKeys.LOGGER) return logger
      throw new Error(`Unexpected dependency: ${key}`)
    }),
  }

  return { attempts, attemptStore, paymentModule, logger, container }
}

describe("Mercado Pago orphan attempt reconciliation", () => {
  test("does not search before the orphan grace period expires", async () => {
    const attempt = attemptFixture({
      reconcile_after: new Date(NOW + 60 * 1000),
    })
    const context = setup([attempt])
    const client = {
      searchPayments: jest.fn(),
      cancelPayment: jest.fn(),
      validateEnvironment: jest.fn(),
    }

    await reconcileMercadoPagoOrphanAttempts(context.container as never, {
      client,
      liveMode: false,
      now: NOW,
    })

    expect(client.searchPayments).not.toHaveBeenCalled()
    expect(context.attemptStore.updateMercadoPagoAttempts).not.toHaveBeenCalled()
    expect(context.attempts.get(attempt.id)?.state).toBe("creating")
  })

  test("recovers a payment after delayed search indexing when its session is alive", async () => {
    const attempt = attemptFixture()
    const liveSession = {
      id: attempt.payment_session_id,
      amount: 100,
      currency_code: "brl",
      payment_collection_id: attempt.payment_collection_id,
      status: PaymentSessionStatus.PENDING_AUTHORIZATION,
      data: {
        session_id: attempt.payment_session_id,
        payment_collection_id: attempt.payment_collection_id,
      },
    }
    const context = setup([attempt], {
      retrievePaymentSession: jest.fn().mockResolvedValue(liveSession),
      updatePaymentSession: jest.fn().mockResolvedValue(liveSession),
    })
    const payment = paymentFixture(attempt)
    const client = {
      searchPayments: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([payment]),
      cancelPayment: jest.fn(),
      validateEnvironment: jest.fn(),
    }

    await reconcileMercadoPagoOrphanAttempts(context.container as never, {
      client,
      liveMode: false,
      now: NOW,
    })
    expect(context.attempts.get(attempt.id)?.state).toBe("creating")

    await reconcileMercadoPagoOrphanAttempts(context.container as never, {
      client,
      liveMode: false,
      now: NOW + 5 * 60 * 1000,
    })
    expect(context.paymentModule.updatePaymentSession).toHaveBeenCalledTimes(1)
    expect(context.attempts.get(attempt.id)).toMatchObject({
      state: "bound",
      remote_payment_id: "mp_1",
    })
    expect(client.cancelPayment).not.toHaveBeenCalled()
  })

  test.each([
    ["card", "in_process"],
    ["pix", "pending"],
  ] as const)(
    "compensates a cancellable %s orphan exactly once",
    async (providerKind, status) => {
      const attempt = attemptFixture({ provider_kind: providerKind })
      const payment = paymentFixture(attempt, { status })
      const canceled = { ...payment, status: "cancelled" }
      const context = setup([attempt])
      const client = {
        searchPayments: jest.fn().mockResolvedValue([payment]),
        cancelPayment: jest.fn().mockResolvedValue(canceled),
        validateEnvironment: jest.fn().mockResolvedValue(undefined),
      }

      await reconcileMercadoPagoOrphanAttempts(context.container as never, {
        client,
        liveMode: false,
        now: NOW,
      })
      await reconcileMercadoPagoOrphanAttempts(context.container as never, {
        client,
        liveMode: false,
        now: NOW + 5 * 60 * 1000,
      })

      expect(client.cancelPayment).toHaveBeenCalledTimes(1)
      expect(client.validateEnvironment).toHaveBeenCalledTimes(1)
      expect(context.attempts.get(attempt.id)?.state).toBe("compensated")
    }
  )

  test("never cancels an orphan candidate bound to a different live session", async () => {
    const attempt = attemptFixture()
    const payment = paymentFixture(attempt)
    const differentSession = {
      id: "payses_winner",
      payment_collection_id: attempt.payment_collection_id,
      status: PaymentSessionStatus.AUTHORIZED,
      data: { id: String(payment.id), session_id: "payses_winner" },
    }
    const context = setup([attempt], {
      listPaymentSessions: jest.fn().mockResolvedValue([differentSession]),
    })
    const client = {
      searchPayments: jest.fn().mockResolvedValue([payment]),
      cancelPayment: jest.fn(),
      validateEnvironment: jest.fn(),
    }

    await reconcileMercadoPagoOrphanAttempts(context.container as never, {
      client,
      liveMode: false,
      now: NOW,
    })

    expect(client.cancelPayment).not.toHaveBeenCalled()
    expect(context.attempts.get(attempt.id)).toMatchObject({
      state: "manual_review",
      last_error_code: "remote_payment_bound_to_different_live_session",
    })
    expect(context.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("mercado_pago_orphan_manual_review")
    )
  })

  test("sends multiple strictly owned remote matches to manual review", async () => {
    const attempt = attemptFixture()
    const context = setup([attempt])
    const client = {
      searchPayments: jest.fn().mockResolvedValue([
        paymentFixture(attempt, { id: "mp_1" }),
        paymentFixture(attempt, { id: "mp_2" }),
      ]),
      cancelPayment: jest.fn(),
      validateEnvironment: jest.fn(),
    }

    await reconcileMercadoPagoOrphanAttempts(context.container as never, {
      client,
      liveMode: false,
      now: NOW,
    })

    expect(client.cancelPayment).not.toHaveBeenCalled()
    expect(context.attempts.get(attempt.id)).toMatchObject({
      state: "manual_review",
      last_error_code: "multiple_remote_payments_match_attempt",
    })
    expect(context.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("multiple_remote_payments_match_attempt")
    )
  })

  test.each(["authorized", "approved"])(
    "sends a %s orphan to structured manual review without cancellation or refund",
    async (status) => {
      const attempt = attemptFixture()
      const payment = paymentFixture(attempt, { status })
      const context = setup([attempt])
      const client = {
        searchPayments: jest.fn().mockResolvedValue([payment]),
        cancelPayment: jest.fn(),
        validateEnvironment: jest.fn(),
      }

      await reconcileMercadoPagoOrphanAttempts(context.container as never, {
        client,
        liveMode: false,
        now: NOW,
      })

      expect(client.cancelPayment).not.toHaveBeenCalled()
      expect(context.attempts.get(attempt.id)).toMatchObject({
        state: "manual_review",
        remote_status: status,
      })
      expect(context.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("mercado_pago_orphan_manual_review")
      )
    }
  )
})
