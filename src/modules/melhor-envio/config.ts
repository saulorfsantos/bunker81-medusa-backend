export type MelhorEnvioConfig = {
  accessToken: string
  userAgent: string
  originPostalCode: string
  catalogWeightUnit?: "g" | "kg"
  catalogDimensionUnit?: "mm" | "cm"
  demoVolume?: { weight: number; height: number; width: number; length: number }
  serviceIds: number[]
}

export function postalCode(value: string): string {
  const digits = value.replace(/\D/g, "")
  if (!/^\d{8}$/.test(digits)) throw new Error("Melhor Envio requires a Brazilian 8-digit postal code")
  return digits
}

export function readMelhorEnvioConfig(env: NodeJS.ProcessEnv): MelhorEnvioConfig | undefined {
  const mode = env.MELHOR_ENVIO_ENV
  const fallback = env.MELHOR_ENVIO_DEMO_FALLBACK_ENABLED === "true"
  if (env.MELHOR_ENVIO_DEMO_FALLBACK_ENABLED && !["true", "false"].includes(env.MELHOR_ENVIO_DEMO_FALLBACK_ENABLED)) {
    throw new Error("MELHOR_ENVIO_DEMO_FALLBACK_ENABLED must be true or false")
  }
  if (fallback && mode !== "sandbox") throw new Error("Demo dimensions are permitted only in Melhor Envio sandbox")
  if (mode === "production") throw new Error("Melhor Envio production is disabled in this release")
  if (mode && mode !== "sandbox") throw new Error("MELHOR_ENVIO_ENV must be sandbox")

  const requested = Object.entries(env).some(([key, value]) => key.startsWith("MELHOR_ENVIO_") && Boolean(value))
  if (!requested) return undefined
  if (!mode || !env.MELHOR_ENVIO_ACCESS_TOKEN || !env.MELHOR_ENVIO_USER_AGENT) {
    throw new Error("Melhor Envio sandbox requires MELHOR_ENVIO_ENV, MELHOR_ENVIO_ACCESS_TOKEN and MELHOR_ENVIO_USER_AGENT")
  }
  if (!/\S+@\S+\.\S+/.test(env.MELHOR_ENVIO_USER_AGENT)) {
    throw new Error("MELHOR_ENVIO_USER_AGENT must include a technical email")
  }
  const weightUnit = env.MELHOR_ENVIO_CATALOG_WEIGHT_UNIT
  const dimensionUnit = env.MELHOR_ENVIO_CATALOG_DIMENSION_UNIT
  if (weightUnit && weightUnit !== "g" && weightUnit !== "kg") throw new Error("Invalid catalog weight unit")
  if (dimensionUnit && dimensionUnit !== "mm" && dimensionUnit !== "cm") throw new Error("Invalid catalog dimension unit")
  const values = [
    env.MELHOR_ENVIO_DEMO_WEIGHT_KG,
    env.MELHOR_ENVIO_DEMO_HEIGHT_CM,
    env.MELHOR_ENVIO_DEMO_WIDTH_CM,
    env.MELHOR_ENVIO_DEMO_LENGTH_CM,
  ]
  let demoVolume: MelhorEnvioConfig["demoVolume"]
  if (fallback) {
    const numbers = values.map((value) => Number(value))
    if (values.some((value) => !value) || numbers.some((value) => !Number.isFinite(value) || value <= 0)) {
      throw new Error("Demo fallback requires four positive package dimensions and weight")
    }
    demoVolume = { weight: numbers[0], height: numbers[1], width: numbers[2], length: numbers[3] }
  }
  const serviceIds = (env.MELHOR_ENVIO_SERVICE_IDS || "").split(",").filter(Boolean).map((id) => Number(id))
  if (!serviceIds.length) throw new Error("MELHOR_ENVIO_SERVICE_IDS requires at least one sandbox service ID")
  if (serviceIds.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(serviceIds).size !== serviceIds.length) {
    throw new Error("MELHOR_ENVIO_SERVICE_IDS must contain unique positive numeric service IDs")
  }
  return {
    accessToken: env.MELHOR_ENVIO_ACCESS_TOKEN,
    userAgent: env.MELHOR_ENVIO_USER_AGENT,
    originPostalCode: postalCode(env.MELHOR_ENVIO_ORIGIN_POSTAL_CODE || "50610545"),
    catalogWeightUnit: weightUnit as MelhorEnvioConfig["catalogWeightUnit"],
    catalogDimensionUnit: dimensionUnit as MelhorEnvioConfig["catalogDimensionUnit"],
    demoVolume,
    serviceIds,
  }
}
