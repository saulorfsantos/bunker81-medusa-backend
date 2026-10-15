import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
const runCapture = jest.fn()
jest.mock("@medusajs/medusa/core-flows", () => ({ capturePaymentWorkflow: () => ({ run: runCapture }) }))
import { autoCaptureFrom, CARD_PROVIDER, captureMercadoPagoOrder } from "../mercado-pago-auto-capture"
import subscriber from "../../subscribers/mercado-pago-order-placed"
import recovery from "../../jobs/mercado-pago-card-auto-capture"

const since = "2026-10-14T18:00:00Z"
const original = process.env.MERCADO_PAGO_AUTO_CAPTURE_FROM
const payment = (patch = {}) => ({ id: "pay_1", provider_id: CARD_PROVIDER, captured_at: null, canceled_at: null, captures: [], refunds: [], ...patch })
const order = (patch = {}) => ({ id: "order_1", status: "pending", is_draft_order: false, created_at: "2026-10-14T18:05:00Z", payment_collections: [{ payments: [payment()] }], ...patch })
function context(graph = jest.fn().mockResolvedValue({ data: [order()] })) {
  const logger = { info: jest.fn(), error: jest.fn() }
  let tail = Promise.resolve()
  const locking = { execute: jest.fn((_key, task) => {
    const next = tail.then(task)
    tail = next.catch(() => {})
    return next
  }) }
  const container = { resolve: (key: string) => {
    if (key === ContainerRegistrationKeys.QUERY) return { graph }
    if (key === ContainerRegistrationKeys.LOGGER) return logger
    if (key === Modules.LOCKING) return locking
    throw new Error(`Unexpected dependency ${key}`)
  } }
  return { container: container as never, graph, logger, locking }
}
beforeEach(() => { process.env.MERCADO_PAGO_AUTO_CAPTURE_FROM = since; runCapture.mockReset().mockResolvedValue({}) })
afterAll(() => { if (original === undefined) delete process.env.MERCADO_PAGO_AUTO_CAPTURE_FROM; else process.env.MERCADO_PAGO_AUTO_CAPTURE_FROM = original })
test("disabled until an explicit activation date and rejects malformed configuration", async () => {
  delete process.env.MERCADO_PAGO_AUTO_CAPTURE_FROM
  const ctx = context()
  expect(await captureMercadoPagoOrder(ctx.container, "order_1")).toBe(0)
  expect(ctx.graph).not.toHaveBeenCalled()
  expect(() => autoCaptureFrom({ MERCADO_PAGO_AUTO_CAPTURE_FROM: "yesterday" } as never)).toThrow(/ISO/)
})
test("captures a new card order through the native payment workflow", async () => {
  const ctx = context()
  expect(await captureMercadoPagoOrder(ctx.container, "order_1")).toBe(1)
  expect(runCapture).toHaveBeenCalledWith({ input: { payment_id: "pay_1" } })
  expect(ctx.locking.execute).toHaveBeenCalledWith("bunker-mp-capture:order_1", expect.any(Function), { timeout: 120 })
})
test.each([
  { status: "canceled" }, { is_draft_order: true }, { created_at: "2026-10-14T17:59:59Z" }, { created_at: "bad" },
])("does not capture canceled, draft, historical or invalid orders: %j", async patch => {
  const ctx = context(jest.fn().mockResolvedValue({ data: [order(patch)] }))
  await captureMercadoPagoOrder(ctx.container, "order_1")
  expect(runCapture).not.toHaveBeenCalled()
})
test.each([
  { provider_id: "pp_mercadopago-pix_mercadopago" }, { provider_id: "pp_system_default" },
  { captured_at: since }, { canceled_at: since }, { captures: [{ id: "cap_partial" }] }, { refunds: [{ id: "ref_1" }] },
])("skips other methods, manual captures, cancellations and partial operations: %j", async patch => {
  const ctx = context(jest.fn().mockResolvedValue({ data: [order({ payment_collections: [{ payments: [payment(patch)] }] })] }))
  await captureMercadoPagoOrder(ctx.container, "order_1")
  expect(runCapture).not.toHaveBeenCalled()
})
test("concurrent redelivery checks fresh state under the lock and does not capture twice", async () => {
  let captured = false
  const ctx = context(jest.fn().mockImplementation(async () => ({ data: [order({ payment_collections: [{ payments: [payment({ captured_at: captured ? since : null })] }] })] })))
  runCapture.mockImplementation(async () => { captured = true })
  await Promise.all([captureMercadoPagoOrder(ctx.container, "order_1"), captureMercadoPagoOrder(ctx.container, "order_1")])
  expect(runCapture).toHaveBeenCalledTimes(1)
})
test("failed subscriber propagates a sanitized error so the queue can retry", async () => {
  const ctx = context()
  runCapture.mockRejectedValue(new Error("private provider detail"))
  await expect(subscriber({ event: { data: { id: "order_1" } }, container: ctx.container } as never)).rejects.toThrow("auto-capture failed for order order_1")
  expect(JSON.stringify(ctx.logger.error.mock.calls)).not.toContain("private provider detail")
})
test("recovery only scans recent uncaptured card payments and never captures an orphan", async () => {
  jest.useFakeTimers().setSystemTime(new Date("2026-10-15T20:00:00Z"))
  const graph = jest.fn().mockImplementation(async input => {
    if (input.entity === "payment") return { data: [{ id: "pay_1", payment_collection_id: "pc_1" }, { id: "pay_orphan", payment_collection_id: "pc_orphan" }] }
    if (input.entity === "order_payment_collection") return { data: input.filters.payment_collection_id === "pc_orphan" ? [] : [{ order_id: "order_1" }] }
    return { data: [order()] }
  })
  const ctx = context(graph)
  try {
    await recovery(ctx.container)
    expect(graph.mock.calls[0][0].filters).toEqual({ provider_id: CARD_PROVIDER, captured_at: null, canceled_at: null, created_at: { $gte: "2026-10-14T20:00:00.000Z" } })
    expect(runCapture).toHaveBeenCalledTimes(1)
  } finally { jest.useRealTimers() }
})
test("recovery collects every page before mutation and continues after one failure", async () => {
  const graph = jest.fn().mockImplementation(async input => {
    if (input.entity === "payment") return { data: input.pagination.skip ? [{ id: "pay_last", payment_collection_id: "pc_last" }] : Array.from({ length: 100 }, (_, i) => ({ id: `pay_${i}`, payment_collection_id: `pc_${i}` })) }
    if (input.entity === "order_payment_collection") return { data: [{ order_id: input.filters.payment_collection_id }] }
    return { data: [order({ id: input.filters.id })] }
  })
  const ctx = context(graph)
  runCapture.mockRejectedValueOnce(new Error("offline"))
  await recovery(ctx.container)
  expect(graph.mock.calls[1][0].entity).toBe("payment")
  expect(graph.mock.calls[1][0].pagination.skip).toBe(100)
  expect(runCapture).toHaveBeenCalledTimes(101)
  expect(ctx.logger.error).toHaveBeenCalledTimes(1)
})
