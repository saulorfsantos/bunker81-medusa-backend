import { readMelhorEnvioConfig } from "../config"
import { buildQuotePayload, MelhorEnvioClient, normalizeQuotes } from "../quote"
import { MelhorEnvioFulfillmentService } from "../service"
import { fulfillmentProviders } from "../providers"

const env = {
  MELHOR_ENVIO_ENV: "sandbox",
  MELHOR_ENVIO_ACCESS_TOKEN: "test-only-token",
  MELHOR_ENVIO_USER_AGENT: "Bunker81 (tech@example.com)",
  MELHOR_ENVIO_ORIGIN_POSTAL_CODE: "50610-545",
  MELHOR_ENVIO_SERVICE_IDS: "1,2",
}
const config = readMelhorEnvioConfig(env)!
const cart = {
  postalCode: "01001-000",
  currencyCode: "brl",
  items: [{ id: "line_1", quantity: 2, unit_price: 49.9, variant: { weight: 400, height: 10, width: 20, length: 30 } }],
}
const response = [{ id: 1, name: "PAC", company: { name: "Correios" }, price: "18.00", custom_price: "20.50", delivery_time: 5, custom_delivery_time: 7 }]

describe("Melhor Envio sandbox quote", () => {
  it("keeps the existing manual fulfillment provider for pickup", () => {
    expect(fulfillmentProviders(config).map((provider) => provider.id)).toEqual(["manual", "melhor-envio"])
  })
  it("uses real product dimensions with explicit catalog units", () => {
    const result = buildQuotePayload({ ...config, catalogWeightUnit: "g", catalogDimensionUnit: "cm" }, cart)
    expect(result.source).toBe("products")
    expect(result.payload).toEqual({
      from: { postal_code: "50610545" }, to: { postal_code: "01001000" },
      products: [{ id: "line_1", quantity: 2, weight: 0.4, height: 10, width: 20, length: 30, insurance_value: 49.9 }],
    })
  })

  it("requires explicit sandbox fallback and never accepts it in production", () => {
    expect(() => buildQuotePayload(config, cart)).toThrow(/fallback is disabled/)
    expect(() => readMelhorEnvioConfig({ ...env, MELHOR_ENVIO_ENV: "production", MELHOR_ENVIO_DEMO_FALLBACK_ENABLED: "true" })).toThrow(/only in Melhor Envio sandbox/)
    expect(() => readMelhorEnvioConfig({ ...env, MELHOR_ENVIO_ENV: "production" })).toThrow(/production is disabled/)
    const demo = readMelhorEnvioConfig({
      ...env, MELHOR_ENVIO_DEMO_FALLBACK_ENABLED: "true", MELHOR_ENVIO_DEMO_WEIGHT_KG: "0.5",
      MELHOR_ENVIO_DEMO_HEIGHT_CM: "10", MELHOR_ENVIO_DEMO_WIDTH_CM: "15", MELHOR_ENVIO_DEMO_LENGTH_CM: "20",
    })!
    expect(buildQuotePayload(demo, cart)).toMatchObject({ source: "demo_volume", payload: { volumes: [{ weight: 0.5, height: 10, width: 15, length: 20, insurance: 99.8 }] } })
  })

  it("normalizes custom price and delivery time, discarding unavailable services", () => {
    const metadata = { source: "products" as const, origin_postal_code: "50610545", destination_postal_code: "01001000" }
    expect(normalizeQuotes([...response, { id: 2, error: "unavailable" }], metadata)).toEqual([{
      service_id: 1, carrier_name: "Correios", service_name: "PAC", price: 20.5,
      delivery_time: 7, currency: "brl", quote_metadata: metadata,
    }])
    expect(normalizeQuotes([{ ...response[0], custom_price: null }], metadata)[0].price).toBe(18)
    expect(normalizeQuotes([{ ...response[0], custom_price: "invalid" }], metadata)).toEqual([])
  })

  it("sends only the sandbox calculate request with required headers", async () => {
    const fetcher = jest.fn().mockResolvedValue({ ok: true, json: async () => response })
    const client = new MelhorEnvioClient({ ...config, catalogWeightUnit: "g", catalogDimensionUnit: "cm" }, fetcher)
    expect((await client.quote(cart))[0].price).toBe(20.5)
    expect(fetcher).toHaveBeenCalledWith("https://sandbox.melhorenvio.com.br/api/v2/me/shipment/calculate", expect.objectContaining({
      method: "POST", headers: expect.objectContaining({ Accept: "application/json", "Content-Type": "application/json", "User-Agent": env.MELHOR_ENVIO_USER_AGENT, Authorization: "Bearer test-only-token" }),
    }))
  })

  it("re-quotes selected service and ignores a browser-supplied price", async () => {
    const spy = jest.spyOn(MelhorEnvioClient.prototype, "quote").mockResolvedValue(normalizeQuotes(response, {
      source: "products", origin_postal_code: "50610545", destination_postal_code: "01001000",
    }))
    try {
      const provider = new MelhorEnvioFulfillmentService({}, config)
      const context = { shipping_address: { postal_code: "01001000", country_code: "br" }, currency_code: "brl", items: cart.items }
      expect(await provider.getFulfillmentOptions()).toEqual([{ id: "service-1", service_id: 1 }, { id: "service-2", service_id: 2 }])
      expect(await provider.canCalculate({ data: { service_id: 1 } } as never)).toBe(true)
      expect(await provider.canCalculate({ data: { service_id: 99 } } as never)).toBe(false)
      expect(await provider.calculatePrice({ service_id: 1 }, { quoted_price: 0.01 }, context as never)).toMatchObject({ calculated_amount: 20.5 })
      expect(await provider.validateFulfillmentData({ service_id: 1 }, { quoted_price: 0.01, service_id: 2 }, context as never)).toMatchObject({ service_id: 1, quoted_price: 20.5 })
      await expect(provider.calculatePrice({ service_id: 2 }, {}, context as never)).rejects.toThrow(/unavailable/)
      expect(spy).toHaveBeenCalledTimes(3)
    } finally {
      spy.mockRestore()
    }
  })
})
