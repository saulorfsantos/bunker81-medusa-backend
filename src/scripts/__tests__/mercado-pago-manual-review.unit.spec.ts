import type { StoredMercadoPagoAttempt } from "../../modules/mercado-pago/attempts"
import {
  listManualReviewAttempts,
  resolveManualReviewAttempt,
} from "../mercado-pago-manual-review"

const fixture = (
  overrides: Partial<StoredMercadoPagoAttempt> = {}
): StoredMercadoPagoAttempt => ({
  id: "mpatt_review_1",
  payment_session_id: "payses_review_1",
  payment_collection_id: "paycol_review_1",
  provider_kind: "card",
  request_fingerprint: "fingerprint-review-1",
  idempotency_key: "idempotency-review-1",
  amount: 100,
  currency_code: "brl",
  state: "manual_review",
  reconcile_after: new Date(0),
  remote_payment_id: "mp_remote_1",
  remote_status: "approved",
  three_ds_info: {
    external_resource_url: "https://issuer.example.test/challenge",
    creq: "sensitive-continuation",
  },
  manual_review_at: new Date("2026-09-15T15:00:00.000Z"),
  created_at: new Date("2026-09-15T14:00:00.000Z"),
  ...overrides,
})

const setup = (attempts: StoredMercadoPagoAttempt[]) => {
  const records = new Map(attempts.map((attempt) => [attempt.id, attempt]))
  const store = {
    listMercadoPagoAttempts: jest.fn().mockImplementation(async () =>
      Array.from(records.values()).filter(
        (attempt) => attempt.state === "manual_review"
      )
    ),
    retrieveMercadoPagoAttempt: jest.fn().mockImplementation(async (id) => {
      const attempt = records.get(id)
      if (!attempt) throw new Error("not found")
      return attempt
    }),
    createMercadoPagoAttempts: jest.fn(),
    updateMercadoPagoAttempts: jest.fn().mockImplementation(async (data) => {
      const updated = { ...records.get(data.id), ...data }
      records.set(data.id, updated as StoredMercadoPagoAttempt)
      return updated
    }),
  }
  const logger = { info: jest.fn() }
  return { records, store, logger }
}

describe("Mercado Pago manual review operator command", () => {
  test("lists only sanitized manual-review metadata", async () => {
    const context = setup([
      fixture(),
      fixture({ id: "mpatt_bound", state: "bound" }),
    ])

    await expect(
      listManualReviewAttempts(context.store, context.logger)
    ).resolves.toBe(1)
    const output = context.logger.info.mock.calls.flat().join("\n")
    expect(output).toContain("mpatt_review_1")
    expect(output).not.toContain("sensitive-continuation")
  })

  test("resolves one explicit attempt idempotently without remote actions", async () => {
    const context = setup([fixture()])

    const first = await resolveManualReviewAttempt(
      context.store,
      context.logger,
      {
        attemptId: "mpatt_review_1",
        reviewedBy: "operator@example.test",
        note: "order and ledger checked",
      }
    )
    const second = await resolveManualReviewAttempt(
      context.store,
      context.logger,
      {
        attemptId: "mpatt_review_1",
        reviewedBy: "operator@example.test",
      }
    )

    expect(first.changed).toBe(true)
    expect(second.changed).toBe(false)
    expect(context.store.updateMercadoPagoAttempts).toHaveBeenCalledTimes(1)
    expect(context.records.get("mpatt_review_1")).toMatchObject({
      state: "reviewed",
      reviewed_by: "operator@example.test",
      review_note: "order and ledger checked",
      three_ds_info: null,
    })
    expect(context.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"remote_action_performed":false')
    )
  })

  test("refuses to resolve a non-manual attempt", async () => {
    const context = setup([fixture({ state: "bound" })])

    await expect(
      resolveManualReviewAttempt(context.store, context.logger, {
        attemptId: "mpatt_review_1",
        reviewedBy: "operator@example.test",
      })
    ).rejects.toThrow("not manual_review")
    expect(context.store.updateMercadoPagoAttempts).not.toHaveBeenCalled()
  })
})
