import type { MelhorEnvioConfig } from "./config"

export function fulfillmentProviders(config: MelhorEnvioConfig) {
  return [
    { resolve: "@medusajs/medusa/fulfillment-manual", id: "manual" },
    { resolve: "./src/modules/melhor-envio", id: "melhor-envio", options: config },
  ]
}
