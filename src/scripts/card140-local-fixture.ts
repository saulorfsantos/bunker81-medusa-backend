import { MedusaContainer } from "@medusajs/framework"
import {
  ContainerRegistrationKeys,
  ModuleRegistrationName,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils"
import {
  createApiKeysWorkflow,
  createInventoryLevelsWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createStockLocationsWorkflow,
  createStoresWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from "@medusajs/medusa/core-flows"
import {
  assertCard140SandboxEnv,
  verifyCard140Runtime,
} from "../local-sandbox/preflight"

// This assertion runs as soon as Medusa imports the script. medusa-config.ts
// repeats it before any database connection whenever the sandbox marker exists.
assertCard140SandboxEnv(process.env)

const FIXTURE_HANDLE = "card140-local-fixture"
const FIXTURE_SKU = "CARD140-BRL-001"

export default async function card140LocalFixture({
  container,
}: {
  container: MedusaContainer
}) {
  await verifyCard140Runtime(process.env)

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const fulfillment = container.resolve(ModuleRegistrationName.FULFILLMENT)

  for (const entity of ["product", "region", "stock_location", "sales_channel"]) {
    const { data } = await query.graph({ entity, fields: ["id"] })
    if (data.length) {
      throw new Error(
        `Expected an empty disposable database, but ${entity} already contains data; ` +
          "run npm run local:down and recreate it"
      )
    }
  }

  logger.info("Creating the isolated Card 140 BRL/Brazil fixture...")

  const {
    result: [salesChannel],
  } = await createSalesChannelsWorkflow(container).run({
    input: {
      salesChannelsData: [
        {
          name: "Card 140 Local Sales Channel",
          description: "Disposable local-only fixture",
        },
      ],
    },
  })

  const {
    result: [apiKey],
  } = await createApiKeysWorkflow(container).run({
    input: {
      api_keys: [
        {
          title: "Card 140 Local Publishable Key",
          type: "publishable",
          created_by: "",
        },
      ],
    },
  })
  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: { id: apiKey.id, add: [salesChannel.id] },
  })

  await createStoresWorkflow(container).run({
    input: {
      stores: [
        {
          name: "Card 140 Local Store",
          supported_currencies: [{ currency_code: "brl", is_default: true }],
          default_sales_channel_id: salesChannel.id,
        },
      ],
    },
  })

  const {
    result: [region],
  } = await createRegionsWorkflow(container).run({
    input: {
      regions: [
        {
          name: "Card 140 Brazil",
          currency_code: "brl",
          countries: ["br"],
          // Mercado Pago is intentionally not registered or selected here.
          payment_providers: ["pp_system_default"],
        },
      ],
    },
  })
  await createTaxRegionsWorkflow(container).run({
    input: [{ country_code: "br", provider_id: "tp_system" }],
  })

  const {
    result: [stockLocation],
  } = await createStockLocationsWorkflow(container).run({
    input: {
      locations: [
        {
          name: "Card 140 Local Warehouse",
          address: {
            city: "Sao Paulo",
            province: "SP",
            postal_code: "01001000",
            country_code: "BR",
            address_1: "Local fixture only",
          },
        },
      ],
    },
  })

  await link.create({
    [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
    [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" },
  })

  const { data: shippingProfiles } = await query.graph({
    entity: "shipping_profile",
    fields: ["id"],
  })
  if (shippingProfiles.length !== 1) {
    throw new Error("Expected exactly one default shipping profile in the disposable database")
  }
  const shippingProfile = shippingProfiles[0]

  const fulfillmentSet = await fulfillment.createFulfillmentSets({
    name: "Card 140 Brazil delivery",
    type: "shipping",
    service_zones: [
      {
        name: "Card 140 Brazil",
        geo_zones: [{ country_code: "br", type: "country" }],
      },
    ],
  })
  await link.create({
    [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
    [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet.id },
  })

  await createShippingOptionsWorkflow(container).run({
    input: [
      {
        name: "Card 140 Test Shipping",
        price_type: "flat",
        provider_id: "manual_manual",
        service_zone_id: fulfillmentSet.service_zones[0].id,
        shipping_profile_id: shippingProfile.id,
        type: {
          label: "Local test shipping",
          description: "No external carrier API is called",
          code: "card140-local",
        },
        prices: [{ currency_code: "brl", amount: 15 }],
        rules: [
          { attribute: "enabled_in_store", value: "true", operator: "eq" },
          { attribute: "is_return", value: "false", operator: "eq" },
        ],
      },
    ],
  })

  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: { id: stockLocation.id, add: [salesChannel.id] },
  })

  await createProductsWorkflow(container).run({
    input: {
      products: [
        {
          title: "Card 140 Local Product",
          handle: FIXTURE_HANDLE,
          description: "Disposable product without remote images or external integrations",
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          options: [{ title: "Variant", values: ["Local"] }],
          variants: [
            {
              title: "Local",
              sku: FIXTURE_SKU,
              manage_inventory: true,
              options: { Variant: "Local" },
              prices: [{ currency_code: "brl", amount: 199 }],
            },
          ],
          sales_channels: [{ id: salesChannel.id }],
        },
      ],
    },
  })

  const { data: inventoryItems } = await query.graph({
    entity: "inventory_item",
    fields: ["id", "sku"],
  })
  const fixtureInventory = inventoryItems.filter((item) => item.sku === FIXTURE_SKU)
  if (fixtureInventory.length !== 1) {
    throw new Error("Expected exactly one Card 140 inventory item")
  }

  await createInventoryLevelsWorkflow(container).run({
    input: {
      inventory_levels: [
        {
          location_id: stockLocation.id,
          stocked_quantity: 25,
          inventory_item_id: fixtureInventory[0].id,
        },
      ],
    },
  })

  logger.info(
    "Card 140 fixture ready: BRL/BR, 1 local product, stock 25, manual test shipping; no order or payment created"
  )
}
