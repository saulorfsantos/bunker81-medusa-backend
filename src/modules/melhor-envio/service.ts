import { AbstractFulfillmentProviderService } from "@medusajs/framework/utils"
import type {
  CalculateShippingOptionPriceDTO,
  CalculatedShippingOptionPrice,
  CreateShippingOptionDTO,
  CreateFulfillmentResult,
  FulfillmentDTO,
  FulfillmentItemDTO,
  FulfillmentOption,
  FulfillmentOrderDTO,
} from "@medusajs/framework/types"
import { MelhorEnvioConfig } from "./config"
import { MelhorEnvioClient, Quote, QuoteContext } from "./quote"

type OptionData = { service_id?: number }

export class MelhorEnvioFulfillmentService extends AbstractFulfillmentProviderService {
  static identifier = "melhor-envio"
  private readonly client: MelhorEnvioClient
  private readonly config: MelhorEnvioConfig

  constructor(_: unknown, config: MelhorEnvioConfig) {
    super()
    this.config = config
    this.client = new MelhorEnvioClient(config)
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return this.config.serviceIds.map((service_id) => ({ id: `service-${service_id}`, service_id }))
  }

  async validateOption(data: OptionData): Promise<boolean> {
    return this.config.serviceIds.includes(Number(data.service_id))
  }

  async canCalculate(data: CreateShippingOptionDTO): Promise<boolean> {
    return this.validateOption((data.data || {}) as OptionData)
  }

  private quoteContext(context: CalculateShippingOptionPriceDTO["context"]): QuoteContext {
    const shippingAddress = context.shipping_address as { postal_code?: string; country_code?: string } | undefined
    if (shippingAddress?.country_code?.toLowerCase() !== "br") throw new Error("Melhor Envio supports Brazilian delivery only")
    return {
      postalCode: shippingAddress.postal_code || "",
      currencyCode: String(context.currency_code || ""),
      items: (context.items || []) as QuoteContext["items"],
    }
  }

  private async selectedQuote(optionData: OptionData, context: CalculateShippingOptionPriceDTO["context"]): Promise<Quote> {
    const serviceId = Number(optionData.service_id)
    if (!this.config.serviceIds.includes(serviceId)) throw new Error("Unknown Melhor Envio service ID")
    const quotes = await this.client.quote(this.quoteContext(context))
    const quote = quotes.find((item) => item.service_id === serviceId)
    if (!quote) throw new Error("Requested Melhor Envio service is unavailable for this cart")
    return quote
  }

  async calculatePrice(
    optionData: CalculateShippingOptionPriceDTO["optionData"],
    _data: CalculateShippingOptionPriceDTO["data"],
    context: CalculateShippingOptionPriceDTO["context"]
  ): Promise<CalculatedShippingOptionPrice> {
    // Always re-quote server-side. A price or service supplied by the browser is never trusted.
    const quote = await this.selectedQuote(optionData as OptionData, context)
    return { calculated_amount: quote.price, is_calculated_price_tax_inclusive: true }
  }

  async validateFulfillmentData(
    optionData: Record<string, unknown>,
    _data: Record<string, unknown>,
    context: unknown
  ): Promise<Record<string, unknown>> {
    const quote = await this.selectedQuote(optionData as OptionData, context as CalculateShippingOptionPriceDTO["context"])
    return {
      service_id: quote.service_id,
      carrier_name: quote.carrier_name,
      service_name: quote.service_name,
      quoted_price: quote.price,
      delivery_time: quote.delivery_time,
      currency: quote.currency,
      quote_metadata: quote.quote_metadata,
      quoted_at: new Date().toISOString(),
    }
  }

  async createFulfillment(
    _data: Record<string, unknown>,
    _items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
    _order: Partial<FulfillmentOrderDTO> | undefined,
    _fulfillment: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>
  ): Promise<CreateFulfillmentResult> {
    throw new Error("Melhor Envio label purchase is outside this release")
  }

  async cancelFulfillment(): Promise<Record<string, never>> {
    throw new Error("Melhor Envio logistics are outside this release")
  }

  async createReturnFulfillment(): Promise<CreateFulfillmentResult> {
    throw new Error("Melhor Envio returns are outside this release")
  }
}

export default MelhorEnvioFulfillmentService
