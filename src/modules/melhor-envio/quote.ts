import { MelhorEnvioConfig, postalCode } from "./config"

type Item = {
  id: string
  quantity: number
  unit_price?: number | null
  variant?: { weight?: number | null; height?: number | null; width?: number | null; length?: number | null } | null
}

export type QuoteContext = { postalCode: string; currencyCode: string; items: Item[] }
export type Quote = {
  service_id: number
  carrier_name: string
  service_name: string
  price: number
  delivery_time?: number
  currency: "brl"
  quote_metadata: { source: "products" | "demo_volume"; origin_postal_code: string; destination_postal_code: string }
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

export function buildQuotePayload(config: MelhorEnvioConfig, context: QuoteContext) {
  if (context.currencyCode.toLowerCase() !== "brl") throw new Error("Melhor Envio quotes require BRL")
  if (!context.items.length) throw new Error("Cannot quote an empty cart")
  const destination = postalCode(context.postalCode)
  const products = context.items.map((item) => {
    const variant = item.variant
    if (!variant || !config.catalogWeightUnit || !config.catalogDimensionUnit ||
      !positive(variant.weight) || !positive(variant.height) || !positive(variant.width) || !positive(variant.length) ||
      !Number.isInteger(item.quantity) || item.quantity <= 0 || !positive(item.unit_price)) return null
    const dimensionFactor = config.catalogDimensionUnit === "mm" ? 0.1 : 1
    return {
      id: item.id,
      quantity: item.quantity,
      weight: config.catalogWeightUnit === "g" ? variant.weight / 1000 : variant.weight,
      height: variant.height * dimensionFactor,
      width: variant.width * dimensionFactor,
      length: variant.length * dimensionFactor,
      insurance_value: Math.round(item.unit_price * 100) / 100,
    }
  })
  const base = { from: { postal_code: config.originPostalCode }, to: { postal_code: destination } }
  if (products.every((product) => product !== null)) {
    return { payload: { ...base, products }, source: "products" as const }
  }
  if (!config.demoVolume) throw new Error("Catalog dimensions, weight, unit settings or value are missing; demo fallback is disabled")
  if (context.items.some((item) => !positive(item.unit_price) || !Number.isInteger(item.quantity) || item.quantity <= 0)) {
    throw new Error("Demo volume requires trustworthy cart item values")
  }
  const insurance = Math.round(context.items.reduce((sum, item) => sum + item.unit_price! * item.quantity, 0) * 100) / 100
  // One explicit demonstration package; this is not a packing algorithm.
  return { payload: { ...base, volumes: [{ ...config.demoVolume, insurance }] }, source: "demo_volume" as const }
}

function price(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined
  if (typeof value === "string" && !/^\d+(?:\.\d{1,2})?$/.test(value)) return undefined
  const number = Number(value)
  return Number.isFinite(number) && number > 0 && Math.abs(number * 100 - Math.round(number * 100)) < 1e-6
    ? number
    : undefined
}

export function normalizeQuotes(raw: unknown, metadata: Quote["quote_metadata"]): Quote[] {
  if (!Array.isArray(raw)) throw new Error("Invalid Melhor Envio quote response")
  return raw.flatMap((entry): Quote[] => {
    if (!entry || typeof entry !== "object") return []
    const row = entry as Record<string, unknown>
    if (row.error || !Number.isInteger(row.id) || !row.company || typeof row.company !== "object") return []
    const company = row.company as Record<string, unknown>
    const hasCustomPrice = row.custom_price !== null && row.custom_price !== undefined && row.custom_price !== ""
    const amount = hasCustomPrice ? price(row.custom_price) : price(row.price)
    if (!amount || typeof company.name !== "string" || typeof row.name !== "string") return []
    const delivery = row.custom_delivery_time ?? row.delivery_time
    const days = typeof delivery === "string" || typeof delivery === "number" ? Number(delivery) : undefined
    return [{
      service_id: row.id as number,
      carrier_name: company.name,
      service_name: row.name,
      price: amount,
      ...(days !== undefined && Number.isFinite(days) && days >= 0 ? { delivery_time: days } : {}),
      currency: "brl",
      quote_metadata: metadata,
    }]
  })
}

export class MelhorEnvioClient {
  constructor(private readonly config: MelhorEnvioConfig, private readonly fetcher: typeof fetch = fetch) {}

  async quote(context: QuoteContext): Promise<Quote[]> {
    const { payload, source } = buildQuotePayload(this.config, context)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    try {
      const response = await this.fetcher("https://sandbox.melhorenvio.com.br/api/v2/me/shipment/calculate", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": this.config.userAgent,
          Authorization: `Bearer ${this.config.accessToken}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`Melhor Envio sandbox quote failed (${response.status})`)
      return normalizeQuotes(await response.json(), {
        source,
        origin_postal_code: this.config.originPostalCode,
        destination_postal_code: postalCode(context.postalCode),
      })
    } finally {
      clearTimeout(timeout)
    }
  }
}
