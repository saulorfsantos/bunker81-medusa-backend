import { readMelhorEnvioConfig } from "../config"
import { buildQuotePayload, MelhorEnvioClient, normalizeQuotes } from "../quote"
import { MelhorEnvioFulfillmentService } from "../service"
import { fulfillmentProviders } from "../providers"
import { readFileSync } from "node:fs"

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
    expect(() => readMelhorEnvioConfig({ ...env, MELHOR_ENVIO_ENV: "invalid" })).toThrow(/sandbox or production/)
    const demo = readMelhorEnvioConfig({
      ...env, MELHOR_ENVIO_DEMO_FALLBACK_ENABLED: "true", MELHOR_ENVIO_DEMO_WEIGHT_KG: "0.5",
      MELHOR_ENVIO_DEMO_HEIGHT_CM: "10", MELHOR_ENVIO_DEMO_WIDTH_CM: "15", MELHOR_ENVIO_DEMO_LENGTH_CM: "20",
    })!
    expect(buildQuotePayload(demo, cart)).toMatchObject({ source: "demo_volume", payload: { volumes: [{ weight: 0.5, height: 10, width: 15, length: 20, insurance: 99.8 }] } })
  })

  it("defaults production preview off and requires explicit opt-in with all positive dimensions", () => {
    const productionEnv = { ...env, MELHOR_ENVIO_ENV: "production" }
    const production = readMelhorEnvioConfig(productionEnv)!
    expect(production.environment).toBe("production")
    expect(production.productionPreviewVolume).toBeUndefined()
    expect(() => buildQuotePayload(production, cart)).toThrow(/fallback is disabled/)
    expect(() => readMelhorEnvioConfig({ ...productionEnv, MELHOR_ENVIO_PRODUCTION_PREVIEW_FALLBACK_ENABLED: "true" })).toThrow(/four positive/)
    expect(() => readMelhorEnvioConfig({ ...productionEnv, MELHOR_ENVIO_PRODUCTION_PREVIEW_FALLBACK_ENABLED: "yes" })).toThrow(/must be true or false/)
    expect(() => readMelhorEnvioConfig({ ...env, MELHOR_ENVIO_PRODUCTION_PREVIEW_FALLBACK_ENABLED: "true" })).toThrow(/only in Melhor Envio production/)
    const preview = readMelhorEnvioConfig({
      ...productionEnv, MELHOR_ENVIO_PRODUCTION_PREVIEW_FALLBACK_ENABLED: "true",
      MELHOR_ENVIO_DEMO_WEIGHT_KG: "0.5", MELHOR_ENVIO_DEMO_HEIGHT_CM: "10",
      MELHOR_ENVIO_DEMO_WIDTH_CM: "15", MELHOR_ENVIO_DEMO_LENGTH_CM: "20",
    })!
    expect(preview.demoVolume).toBeUndefined()
    expect(buildQuotePayload(preview, cart)).toMatchObject({
      source: "production_preview_volume",
      payload: { volumes: [{ weight: 0.5, height: 10, width: 15, length: 20, insurance: 99.8 }] },
    })
  })

  it("normalizes custom price and delivery time, discarding unavailable services", () => {
    const metadata = { source: "products" as const, origin_postal_code: "50610545", destination_postal_code: "01001000" }
    expect(normalizeQuotes([...response, { id: 2, error: "unavailable" }], metadata)).toEqual([{
      service_id: 1, carrier_name: "Correios", service_name: "PAC", price: 20.5,
      delivery_time: 7, currency: "brl", quote_metadata: metadata,
    }])
    expect(normalizeQuotes([{ ...response[0], custom_price: null }], metadata)[0].price).toBe(18)
    expect(normalizeQuotes([{ ...response[0], custom_price: null, price: "19.99" }], metadata)[0].price).toBe(19.99)
    expect(normalizeQuotes([{ ...response[0], custom_price: "invalid" }], metadata)).toEqual([])
  })

  it.each([
    ["19.99", 19.99],
    ["18.35", 18.35],
    ["0.07", 0.07],
    ["1.10", 1.10],
  ])("preserves valid two-decimal custom price %s without scaling", (input, expected) => {
    const metadata = { source: "products" as const, origin_postal_code: "50610545", destination_postal_code: "01001000" }
    expect(normalizeQuotes([{ ...response[0], custom_price: input }], metadata)[0].price).toBe(expected)
    expect(normalizeQuotes([{ ...response[0], custom_price: Number(input) }], metadata)[0].price).toBe(expected)
  })

  it.each([0, -1, NaN, Infinity, "1.001", 1.001, "1.100"])("rejects invalid monetary price %s", (input) => {
    const metadata = { source: "products" as const, origin_postal_code: "50610545", destination_postal_code: "01001000" }
    expect(normalizeQuotes([{ ...response[0], custom_price: input }], metadata)).toEqual([])
  })

  it.each([
    ["sandbox", "https://sandbox.melhorenvio.com.br", "demo_volume"],
    ["production", "https://melhorenvio.com.br", "production_preview_volume"],
  ] as const)("sends only the %s calculate request with preview metadata", async (environment, base, source) => {
    const fetcher = jest.fn().mockResolvedValue({ ok: true, json: async () => response })
    const configured = readMelhorEnvioConfig({
      ...env, MELHOR_ENVIO_ENV: environment,
      [environment === "sandbox" ? "MELHOR_ENVIO_DEMO_FALLBACK_ENABLED" : "MELHOR_ENVIO_PRODUCTION_PREVIEW_FALLBACK_ENABLED"]: "true",
      MELHOR_ENVIO_DEMO_WEIGHT_KG: "0.5", MELHOR_ENVIO_DEMO_HEIGHT_CM: "10",
      MELHOR_ENVIO_DEMO_WIDTH_CM: "15", MELHOR_ENVIO_DEMO_LENGTH_CM: "20",
    })!
    const client = new MelhorEnvioClient(configured, fetcher)
    expect((await client.quote(cart))[0]).toMatchObject({ price: 20.5, quote_metadata: { source } })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(`${base}/api/v2/me/shipment/calculate`, expect.objectContaining({
      method: "POST", headers: expect.objectContaining({ Accept: "application/json", "Content-Type": "application/json", "User-Agent": env.MELHOR_ENVIO_USER_AGENT, Authorization: "Bearer test-only-token" }),
    }))
  })

  it("has no cart, checkout or label generation endpoint in the client", () => {
    const clientSource = readFileSync(require.resolve("../quote"), "utf8")
    expect(clientSource).not.toMatch(/\/api\/v2\/me\/(cart|shipment\/(checkout|generate))/)
    expect(Object.getOwnPropertyNames(MelhorEnvioClient.prototype)).toEqual(["constructor", "quote"])
  })

  it("rejects fulfillment, cancellation and returns without contacting the quote client", async () => {
    const spy = jest.spyOn(MelhorEnvioClient.prototype, "quote")
    try {
      const provider = new MelhorEnvioFulfillmentService({}, readMelhorEnvioConfig({ ...env, MELHOR_ENVIO_ENV: "production" })!)
      await expect(provider.createFulfillment({}, [], undefined, {})).rejects.toThrow(/outside this release/)
      await expect(provider.cancelFulfillment()).rejects.toThrow(/outside this release/)
      await expect(provider.createReturnFulfillment()).rejects.toThrow(/outside this release/)
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
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
