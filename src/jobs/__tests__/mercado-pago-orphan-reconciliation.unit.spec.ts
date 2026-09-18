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
    listMercadoPagoAttempts: jest.fn().mockImplementation(
      async (
        filters: Record<string, unknown> = {},
        config: Record<string, unknown> = {}
      ) => {
        const states = Array.isArray(filters.state)
          ? filters.state
          : filters.state
            ? [filters.state]
            : undefined
        const due = (
          filters.reconcile_after as { $lte?: Date } | undefined
        )?.$lte
        const ordered = Array.from(attempts.values())
          .filter((attempt) => !states || states.includes(attempt.state))
          .filter(
            (attempt) =>
              !due || Date.parse(String(attempt.reconcile_after)) <= due.getTime()
          )
          .sort((left, right) => {
            const reconcileDifference =
              Date.parse(String(left.reconcile_after)) -
              Date.parse(String(right.reconcile_after))
            const createdDifference =
              Date.parse(String(left.created_at)) -
              Date.parse(String(right.created_at))
            return (
              reconcileDifference ||
              createdDifference ||
              (left.payment_session_id < right.payment_session_id
                ? -1
                : left.payment_session_id > right.payment_session_id
                  ? 1
                  : 0)
            )
          })
        const skip = Number(config.skip || 0)
        const take = Number(config.take || ordered.length)
        return ordered.slice(skip, skip + take)
      }
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
    expect(
      Date.parse(String(context.attempts.get(attempt.id)?.reconcile_after))
    ).toBe(NOW + 5 * 60 * 1000)

    await reconcileMercadoPagoOrphanAttempts(context.container as never, {
      client,
      liveMode: false,
      now: NOW + 60 * 1000,
    })
    expect(client.searchPayments).toHaveBeenCalledTimes(1)

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

  test("does not adopt or compensate a foreign-session remote payment", async () => {
    const attempt = attemptFixture()
    const foreign = paymentFixture(attempt, {
      metadata: {
        payment_session_id: "payses_foreign",
        payment_collection_id: attempt.payment_collection_id,
        provider_kind: attempt.provider_kind,
        request_fingerprint: attempt.request_fingerprint,
      },
    })
    const context = setup([attempt])
    const client = {
      searchPayments: jest.fn().mockResolvedValue([foreign]),
      cancelPayment: jest.fn(),
      validateEnvironment: jest.fn(),
    }

    await reconcileMercadoPagoOrphanAttempts(context.container as never, {
      client,
      liveMode: false,
      now: NOW,
    })

    expect(context.paymentModule.updatePaymentSession).not.toHaveBeenCalled()
    expect(client.cancelPayment).not.toHaveBeenCalled()
    expect(context.attempts.get(attempt.id)).toMatchObject({
      state: "creating",
      last_error_code: "remote_not_yet_indexed",
    })
  })

  test("increases not-found backoff without sleeping", async () => {
    const attempt = attemptFixture()
    const context = setup([attempt])
    const client = {
      searchPayments: jest.fn().mockResolvedValue([]),
      cancelPayment: jest.fn(),
      validateEnvironment: jest.fn(),
    }

    for (const now of [NOW, NOW + 5 * 60 * 1000, NOW + 15 * 60 * 1000]) {
      await reconcileMercadoPagoOrphanAttempts(context.container as never, {
        client,
        liveMode: false,
        now,
      })
    }

    expect(client.searchPayments).toHaveBeenCalledTimes(3)
    expect(context.attempts.get(attempt.id)).toMatchObject({
      reconciliation_attempts: 3,
      state: "creating",
    })
    expect(
      Date.parse(String(context.attempts.get(attempt.id)?.reconcile_after))
    ).toBe(NOW + 35 * 60 * 1000)
  })

  test("filters due states in the database and never loads terminal rows", async () => {
    const relevant = Array.from({ length: 7 }, (_, index) =>
      attemptFixture({
        id: `mpatt_due_${index}`,
        payment_session_id: `payses_due_${String(index).padStart(3, "0")}`,
      })
    )
    const terminal = Array.from({ length: 253 }, (_, index) =>
      attemptFixture({
        id: `mpatt_terminal_${index}`,
        payment_session_id: `payses_terminal_${index}`,
        state: index % 2 ? "bound" : "resolved_terminal",
      })
    )
    const context = setup([...terminal, ...relevant])
    const client = {
      searchPayments: jest.fn().mockResolvedValue([]),
      cancelPayment: jest.fn(),
      validateEnvironment: jest.fn(),
    }

    await reconcileMercadoPagoOrphanAttempts(context.container as never, {
      client,
      liveMode: false,
      now: NOW,
    })

    expect(client.searchPayments).toHaveBeenCalledTimes(7)
    expect(context.attemptStore.listMercadoPagoAttempts).toHaveBeenCalledTimes(1)
    expect(
      context.attemptStore.listMercadoPagoAttempts.mock.calls[0][0]
    ).toEqual({
      state: ["creating", "remote_found"],
      reconcile_after: { $lte: new Date(NOW) },
    })
    expect(
      context.attemptStore.listMercadoPagoAttempts.mock.calls[0][1]
    ).toMatchObject({ take: 100, skip: 0 })
    expect(
      terminal.every(
        ({ id }) => context.attempts.get(id)?.last_reconciled_at === undefined
      )
    ).toBe(true)
  })

  test("bounds one job run to three batches without retaining all rows", async () => {
    const due = Array.from({ length: 351 }, (_, index) =>
      attemptFixture({
        id: `mpatt_batch_${index}`,
        payment_session_id: `payses_batch_${String(index).padStart(3, "0")}`,
      })
    )
    const context = setup(due)
    const client = {
      searchPayments: jest.fn().mockResolvedValue([]),
      cancelPayment: jest.fn(),
      validateEnvironment: jest.fn(),
    }

    await reconcileMercadoPagoOrphanAttempts(context.container as never, {
      client,
      liveMode: false,
      now: NOW,
    })

    expect(context.attemptStore.listMercadoPagoAttempts).toHaveBeenCalledTimes(3)
    expect(client.searchPayments).toHaveBeenCalledTimes(300)
    expect(
      Array.from(context.attempts.values()).filter(
        (candidate) => candidate.last_reconciled_at
      )
    ).toHaveLength(300)
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

  test("uses the same compensation key across concurrent job executions", async () => {
    const attempt = attemptFixture()
    const payment = paymentFixture(attempt)
    const context = setup([attempt])
    let releaseCancellation!: () => void
    const cancellationMayFinish = new Promise<void>((resolve) => {
      releaseCancellation = resolve
    })
    let cancellationCount = 0
    const cancelPayment = jest.fn().mockImplementation(async () => {
      cancellationCount++
      if (cancellationCount === 2) releaseCancellation()
      await cancellationMayFinish
      return { ...payment, status: "cancelled" }
    })
    const client = {
      searchPayments: jest.fn().mockResolvedValue([payment]),
      cancelPayment,
      validateEnvironment: jest.fn().mockResolvedValue(undefined),
    }

    await Promise.all([
      reconcileMercadoPagoOrphanAttempts(context.container as never, {
        client,
        liveMode: false,
        now: NOW,
      }),
      reconcileMercadoPagoOrphanAttempts(context.container as never, {
        client,
        liveMode: false,
        now: NOW,
      }),
    ])

    expect(cancelPayment).toHaveBeenCalledTimes(2)
    expect(cancelPayment.mock.calls[0][1]).toBe(cancelPayment.mock.calls[1][1])
    expect(context.attempts.get(attempt.id)?.state).toBe("compensated")
  })

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
