import { createHmac } from "node:crypto"
import {
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import {
  createIdempotencyKey,
  createPaymentFingerprint,
} from "../idempotency"
import { validateMercadoPagoSignature } from "../signature"
import {
  mapMercadoPagoStatus,
  mapMercadoPagoWebhookAction,
} from "../status"

describe("Mercado Pago payment primitives", () => {
  test("keeps create idempotency keys stable for identical attempts", () => {
    const requestFingerprint = createPaymentFingerprint({
      amount: 123.45,
      currencyCode: "BRL",
      providerKind: "pix",
      paymentMethodId: "pix",
    })
    const input = {
      stableReference: "paycol_test",
      operation: "create" as const,
      providerKind: "pix",
    }

    expect(requestFingerprint).toHaveLength(64)
    expect(createIdempotencyKey(input)).toBe(createIdempotencyKey(input))
    expect(createIdempotencyKey(input)).toHaveLength(64)
  })

  test("uses distinct idempotency keys for distinct refund amounts", () => {
    const first = createIdempotencyKey({
      stableReference: "paycol_test",
      operation: "refund",
      providerKind: "card",
      requestFingerprint: "first",
    })
    const second = createIdempotencyKey({
      stableReference: "paycol_test",
      operation: "refund",
      providerKind: "card",
      requestFingerprint: "second",
    })

    expect(first).not.toBe(second)
  })

  test("allows separate Medusa refund records for the same amount", () => {
    const base = {
      stableReference: "paycol_test",
      operation: "refund" as const,
      providerKind: "card",
      requestFingerprint: "same-amount",
    }

    expect(
      createIdempotencyKey({ ...base, medusaOperationId: "refund_1" })
    ).not.toBe(
      createIdempotencyKey({ ...base, medusaOperationId: "refund_2" })
    )
  })

  test("maps asynchronous and terminal statuses", () => {
    expect(mapMercadoPagoStatus("pending")).toBe(
      PaymentSessionStatus.PENDING_AUTHORIZATION
    )
    expect(mapMercadoPagoStatus("in_process")).toBe(
      PaymentSessionStatus.PENDING_AUTHORIZATION
    )
    expect(mapMercadoPagoStatus("approved")).toBe(
      PaymentSessionStatus.CAPTURED
    )
    expect(mapMercadoPagoStatus("rejected")).toBe(PaymentSessionStatus.ERROR)
    expect(mapMercadoPagoStatus("expired")).toBe(
      PaymentSessionStatus.CANCELED
    )
  })

  test("maps webhook statuses without treating pending as success", () => {
    expect(mapMercadoPagoWebhookAction("pending")).toBe(
      PaymentActions.PENDING_AUTHORIZATION
    )
    expect(mapMercadoPagoWebhookAction("approved")).toBe(
      PaymentActions.SUCCESSFUL
    )
    expect(mapMercadoPagoWebhookAction("rejected")).toBe(
      PaymentActions.FAILED
    )
    expect(mapMercadoPagoWebhookAction("refunded")).toBe(
      PaymentActions.NOT_SUPPORTED
    )
  })

  test("validates Mercado Pago's signed webhook manifest", () => {
    const now = 1_700_000_000_000
    const timestamp = String(now / 1000)
    const dataId = "12345"
    const requestId = "request-test"
    const secret = "test-only-secret"
    const manifest = `id:${dataId};request-id:${requestId};ts:${timestamp};`
    const signature = createHmac("sha256", secret)
      .update(manifest)
      .digest("hex")

    expect(() =>
      validateMercadoPagoSignature({
        signature: `ts=${timestamp},v1=${signature}`,
        requestId,
        dataId,
        secret,
        toleranceSeconds: 300,
        now: () => now,
      })
    ).not.toThrow()
  })

  test("rejects an invalid HMAC before any timestamp-expiry path", () => {
    const now = 1_700_000_000_000
    const timestamp = String(now / 1000)

    expect(() =>
      validateMercadoPagoSignature({
        signature: `ts=${timestamp},v1=${"0".repeat(64)}`,
        requestId: "request-test",
        dataId: "12345",
        secret: "test-only-secret",
        toleranceSeconds: 300,
        now: () => now,
      })
    ).toThrow("Invalid Mercado Pago webhook signature")
  })

  test("accepts Mercado Pago millisecond timestamps and normalizes data IDs", () => {
    const now = 1_700_000_000_000
    const timestamp = String(now)
    const secret = "test-only-secret"
    const manifest = `id:abc123;request-id:request-test;ts:${timestamp};`
    const signature = createHmac("sha256", secret)
      .update(manifest)
      .digest("hex")

    expect(() =>
      validateMercadoPagoSignature({
        signature: `ts=${timestamp},v1=${signature}`,
        requestId: "request-test",
        dataId: "ABC123",
        secret,
        toleranceSeconds: 300,
        now: () => now,
      })
    ).not.toThrow()
  })
})
