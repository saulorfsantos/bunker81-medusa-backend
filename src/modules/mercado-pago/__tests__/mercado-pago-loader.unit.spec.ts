import { asValue } from "@medusajs/framework/awilix"
import { moduleLoader, registerMedusaModule } from "@medusajs/framework/modules-sdk"
import { createMedusaContainer, Modules } from "@medusajs/framework/utils"
import paymentModule from "@medusajs/payment"

const providerIds = [
  "pp_mercadopago-pix_mercadopago",
  "pp_mercadopago-card_mercadopago",
]

describe("Mercado Pago payment module dependency bridge", () => {
  const previousEnv = {
    MERCADO_PAGO_ACCESS_TOKEN: process.env.MERCADO_PAGO_ACCESS_TOKEN,
    MERCADO_PAGO_WEBHOOK_SECRET: process.env.MERCADO_PAGO_WEBHOOK_SECRET,
    MERCADO_PAGO_WEBHOOK_BASE_URL: process.env.MERCADO_PAGO_WEBHOOK_BASE_URL,
    MERCADO_PAGO_LIVE_MODE: process.env.MERCADO_PAGO_LIVE_MODE,
  }

  afterAll(() => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  async function loadPayment(withAttempt: boolean) {
    process.env.MERCADO_PAGO_ACCESS_TOKEN = "TEST-loader-only"
    process.env.MERCADO_PAGO_WEBHOOK_SECRET = "loader-only-secret"
    process.env.MERCADO_PAGO_WEBHOOK_BASE_URL = "https://example.test"
    process.env.MERCADO_PAGO_LIVE_MODE = "false"

    // Read the actual runtime declaration, including its module dependencies.
    const config = require("../../../../medusa-config")
    const paymentDeclaration = Object.values(config.modules).find(
      (module: any) => module.resolve === "@medusajs/medusa/payment"
    )
    expect(paymentDeclaration).toBeDefined()

    const container = createMedusaContainer()
    const attempt = {
      listMercadoPagoAttempts: () => [],
      createMercadoPagoAttempts: () => [],
      updateMercadoPagoAttempts: () => [],
      retrieveMercadoPagoAttempt: () => ({}),
    }
    if (withAttempt) container.register("mercadoPagoAttempt", asValue(attempt))

    let paymentContainer: ReturnType<typeof createMedusaContainer> | undefined
    const resolution = registerMedusaModule({
      moduleKey: Modules.PAYMENT,
      moduleDeclaration: paymentDeclaration as Parameters<typeof registerMedusaModule>[0]["moduleDeclaration"],
      moduleExports: {
        ...paymentModule,
        loaders: [
          // Stub DB-backed payment services; the module loader, isolated
          // container, and Medusa payment provider loader are real.
          async ({ container: local }: { container: typeof container }) => {
            paymentContainer = local
            local.register("paymentProviderService", asValue({
              list: async () => [],
              upsert: async () => [],
            }))
            local.register("paymentSessionService", asValue({
              list: async () => [],
              retrieve: async () => ({}),
              update: async () => ({}),
            }))
          },
          ...(paymentModule.loaders ?? []),
        ],
      },
    })
    // Avoid model discovery/DB connection; retain Medusa's real module loading.
    resolution[Modules.PAYMENT].resolutionPath = ""
    await moduleLoader({
      container,
      moduleResolutions: resolution,
      logger: { error: () => undefined } as never,
    })

    expect(paymentContainer).toBeDefined()
    return { paymentContainer: paymentContainer!, attempt }
  }

  it("resolves Pix and Card through Medusa's isolated payment module loader", async () => {
    const { paymentContainer, attempt } = await loadPayment(true)
    for (const id of providerIds) {
      expect(paymentContainer.resolve(id)).toBeDefined()
    }
    expect(paymentContainer.resolve("mercadoPagoAttempt")).toBe(attempt)
  })

  it("fails closed when the attempt module is not registered", async () => {
    const { paymentContainer } = await loadPayment(false)
    for (const id of providerIds) {
      expect(() => paymentContainer.resolve(id)).toThrow(
        /mercadoPagoAttempt|Mercado Pago attempt module is required/
      )
    }
  })
})
