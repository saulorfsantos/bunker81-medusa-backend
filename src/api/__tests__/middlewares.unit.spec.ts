import {
  addPaymentCollectionReference,
  normalizeMercadoPagoWebhookQuery,
} from "../middlewares"

describe("Mercado Pago API middleware", () => {
  test("injects the authoritative payment collection route ID", () => {
    const req = {
      body: { data: { payment_collection_id: "untrusted" } },
      params: { id: "paycol_authoritative" },
    }
    const next = jest.fn()

    addPaymentCollectionReference(req as never, {} as never, next)

    expect(req.body.data.payment_collection_id).toBe("paycol_authoritative")
    expect(next).toHaveBeenCalledTimes(1)
  })

  test("normalizes Mercado Pago data.id and topic from query parameters", () => {
    const req = {
      body: {
        type: "body-topic",
        data: { id: "body-id" },
      },
      params: { provider: "mercadopago-card_mercadopago" },
      query: {
        "data.id": "ABC123",
        type: "PAYMENT",
      },
    }
    const next = jest.fn()

    normalizeMercadoPagoWebhookQuery(req as never, {} as never, next)

    expect(req.body).toMatchObject({
      data_id: "abc123",
      type: "payment",
    })
    expect(next).toHaveBeenCalledTimes(1)
  })
})
