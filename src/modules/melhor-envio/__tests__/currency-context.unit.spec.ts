import { MelhorEnvioFulfillmentService } from "../service"
import { MelhorEnvioClient } from "../quote"
import { readMelhorEnvioConfig } from "../config"
import type { CalculateShippingOptionPriceDTO } from "@medusajs/framework/types"
import { createMedusaContainer } from "@medusajs/framework/utils"
import { asValue } from "@medusajs/framework/awilix"

const config = readMelhorEnvioConfig({ MELHOR_ENVIO_ENV: "production", MELHOR_ENVIO_ACCESS_TOKEN: "test-only-token",
  MELHOR_ENVIO_USER_AGENT: "test@example.com", MELHOR_ENVIO_SERVICE_IDS: "1",
  MELHOR_ENVIO_CATALOG_WEIGHT_UNIT: "g", MELHOR_ENVIO_CATALOG_DIMENSION_UNIT: "cm" })!
const context = { id: "cart_test", shipping_address: { country_code: "br", postal_code: "01001000" },
  items: [{ id: "line", quantity: 2, unit_price: 49.9, variant: { weight: 616, height: 8, width: 15, length: 20 } }] } as unknown as CalculateShippingOptionPriceDTO["context"]
const quote = { service_id: 1, carrier_name: "Correios", service_name: "PAC", price: 24.5, currency: "brl" as const,
  quote_metadata: { source: "products" as const, origin_postal_code: "50610545", destination_postal_code: "01001000" } }

describe("shipping currency from authoritative cart", () => {
  afterEach(() => jest.restoreAllMocks())

  it("receives the cart dependency through Medusa's actual fulfillment provider loader", async () => {
    const retrieveCart = jest.fn().mockResolvedValue({ id: "cart_test", currency_code: "brl" })
    const container = createMedusaContainer()
    container.register({ cart: asValue({ retrieveCart }), logger: asValue({ error: jest.fn() }),
      fulfillmentProviderService: asValue({ list: async () => [], create: async () => [], update: async () => [] }) })
    const loadProviders = require("@medusajs/fulfillment/dist/loaders/providers").default
    await loadProviders({ container, options: { providers: [{ resolve: { services: [MelhorEnvioFulfillmentService] }, id: "melhor-envio", options: config }] } })
    const provider = container.resolve<MelhorEnvioFulfillmentService>("fp_melhor-envio_melhor-envio")
    jest.spyOn(MelhorEnvioClient.prototype, "quote").mockResolvedValue([quote])
    await expect(provider.calculatePrice({ service_id: 1 }, {}, context)).resolves.toMatchObject({ calculated_amount: 24.5 })
    expect(retrieveCart).toHaveBeenCalledWith("cart_test", { select: ["id", "currency_code"] })
  })

  it("quotes a projected cart without currency and uses the same safe path when applying shipping", async () => {
    const retrieveCart = jest.fn().mockResolvedValue({ id: "cart_test", currency_code: "brl" })
    const spy = jest.spyOn(MelhorEnvioClient.prototype, "quote").mockResolvedValue([quote])
    const provider = new MelhorEnvioFulfillmentService({ cart: { retrieveCart } }, config)
    expect(await provider.calculatePrice({ service_id: 1 }, { currency_code: "usd", quoted_price: 0 }, context)).toMatchObject({ calculated_amount: 24.5 })
    expect(await provider.validateFulfillmentData({ service_id: 1 }, { currency_code: "usd" }, context)).toMatchObject({ currency: "brl", quoted_price: 24.5 })
    expect(retrieveCart).toHaveBeenCalledWith("cart_test", { select: ["id", "currency_code"] })
    expect(spy).toHaveBeenCalledWith({ postalCode: "01001000", currencyCode: "brl", items: context.items })
  })

  it("retains the existing complete-context behavior without an unnecessary cart lookup", async () => {
    const retrieveCart = jest.fn()
    jest.spyOn(MelhorEnvioClient.prototype, "quote").mockResolvedValue([quote])
    const provider = new MelhorEnvioFulfillmentService({ cart: { retrieveCart } }, config)
    await provider.calculatePrice({ service_id: 1 }, {}, { ...context, currency_code: "BRL" })
    expect(retrieveCart).not.toHaveBeenCalled()
  })

  it("rejects a real USD cart even when browser data says BRL, before contacting Melhor Envio", async () => {
    const retrieveCart = jest.fn().mockResolvedValue({ id: "cart_test", currency_code: "usd" })
    const spy = jest.spyOn(MelhorEnvioClient.prototype, "quote")
    const provider = new MelhorEnvioFulfillmentService({ cart: { retrieveCart } }, config)
    await expect(provider.calculatePrice({ service_id: 1 }, { currency_code: "brl" }, context)).rejects.toThrow(/require BRL/)
    expect(spy).not.toHaveBeenCalled()
  })

  it.each([{ id: "different_cart", currency_code: "brl" }, { id: "cart_test", currency_code: "" }])(
    "rejects an unverifiable cart response", async cart => {
      const retrieveCart = jest.fn().mockResolvedValue(cart)
      const spy = jest.spyOn(MelhorEnvioClient.prototype, "quote")
      const provider = new MelhorEnvioFulfillmentService({ cart: { retrieveCart } }, config)
      await expect(provider.calculatePrice({ service_id: 1 }, {}, context)).rejects.toThrow(/could not verify/)
      expect(spy).not.toHaveBeenCalled()
    })

  it("does not guess currency when a cart ID or injected service is missing", async () => {
    const spy = jest.spyOn(MelhorEnvioClient.prototype, "quote")
    const provider = new MelhorEnvioFulfillmentService({}, config)
    await expect(provider.calculatePrice({ service_id: 1 }, {}, context)).rejects.toThrow(/verifiable currency/)
    expect(spy).not.toHaveBeenCalled()
  })
})
