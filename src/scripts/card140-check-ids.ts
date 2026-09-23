import { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createCartWorkflow,
  listShippingOptionsForCartWorkflow,
} from "@medusajs/medusa/core-flows"
import {
  assertCard140SandboxEnv,
  verifyCard140Runtime,
} from "../local-sandbox/preflight"
import {
  CARD140_CATEGORIES,
  CARD140_COUNTRY_CODE,
  CARD140_CURRENCY_CODE,
  CARD140_PRODUCTS,
  STOREFRONT_REGION_ID,
  assertStorefrontContract,
} from "../local-sandbox/storefront-contract"

// Same fail-closed gate as the fixture: this script must never touch anything
// but the disposable local sandbox.
assertCard140SandboxEnv(process.env)
assertStorefrontContract()

type CheckResult = { name: string; ok: boolean; detail: string }

const results: CheckResult[] = []

const record = (name: string, ok: boolean, detail: string): boolean => {
  results.push({ name, ok, detail })
  return ok
}

/**
 * Verifies that the disposable backend exposes exactly the identities the
 * reviewed storefront hardcodes, and that the minimal product -> variant ->
 * cart -> checkout path resolves. Fails loudly instead of leaving the
 * storefront silently empty.
 */
export default async function card140CheckIds({
  container,
}: {
  container: MedusaContainer
}) {
  await verifyCard140Runtime(process.env)

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "currency_code", "countries.iso_2"],
    filters: { id: STOREFRONT_REGION_ID },
  })
  const region = regions[0]
  const regionOk = record(
    "region",
    Boolean(region) &&
      region.currency_code === CARD140_CURRENCY_CODE &&
      (region.countries ?? []).some(
        (country: { iso_2: string }) => country.iso_2 === CARD140_COUNTRY_CODE
      ),
    region
      ? `${region.id} currency=${region.currency_code} countries=${(region.countries ?? [])
          .map((country: { iso_2: string }) => country.iso_2)
          .join(",")}`
      : `missing region ${STOREFRONT_REGION_ID} expected by the storefront`
  )

  const { data: categories } = await query.graph({
    entity: "product_category",
    fields: ["id", "name", "is_active", "is_internal", "parent_category_id"],
    filters: { id: CARD140_CATEGORIES.map((category) => category.id) },
  })
  const categoryById = new Map(
    categories.map((category: { id: string }) => [category.id, category])
  )
  for (const expected of CARD140_CATEGORIES) {
    const found = categoryById.get(expected.id) as
      | {
          id: string
          is_active: boolean
          is_internal: boolean
          parent_category_id: string | null
        }
      | undefined
    record(
      `category:${expected.key}`,
      Boolean(found) &&
        found!.is_active === true &&
        found!.is_internal === false &&
        found!.parent_category_id === null,
      found
        ? `${found.id} active=${found.is_active} internal=${found.is_internal} root=${
            found.parent_category_id === null
          }`
        : `missing category ${expected.id} expected by the storefront`
    )
  }

  // The storefront lists products per category id, so every consumed category
  // must resolve to at least one published product carrying a BRL variant.
  const { data: products } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "handle",
      "status",
      "categories.id",
      "variants.id",
      "variants.sku",
      "variants.manage_inventory",
    ],
  })

  let checkoutVariantId: string | undefined
  for (const expected of CARD140_CATEGORIES) {
    const inCategory = products.filter(
      (product: { status: string; categories?: { id: string }[] }) =>
        product.status === "published" &&
        (product.categories ?? []).some((category) => category.id === expected.id)
    )
    const withVariant = inCategory.filter(
      (product: { variants?: unknown[] }) => (product.variants ?? []).length > 0
    )
    record(
      `product-in-category:${expected.key}`,
      withVariant.length > 0,
      withVariant.length
        ? `${withVariant.length} published product(s) with variants`
        : `no published product with a variant in category ${expected.id}`
    )
    checkoutVariantId ??= withVariant[0]?.variants?.[0]?.id
  }

  const expectedSkus = new Set(CARD140_PRODUCTS.map((product) => product.sku))
  const variantSkus = new Set(
    products.flatMap((product: { variants?: { sku: string }[] }) =>
      (product.variants ?? []).map((variant) => variant.sku)
    )
  )
  record(
    "fixture-skus",
    [...expectedSkus].every((sku) => variantSkus.has(sku)),
    `expected ${expectedSkus.size} fixture SKUs, found ${
      [...expectedSkus].filter((sku) => variantSkus.has(sku)).length
    }`
  )

  const { data: inventoryLevels } = await query.graph({
    entity: "inventory_level",
    fields: ["id", "location_id", "stocked_quantity", "reserved_quantity"],
  })
  record(
    "inventory",
    inventoryLevels.length >= CARD140_PRODUCTS.length &&
      inventoryLevels.every(
        (level: { stocked_quantity: number }) => level.stocked_quantity > 0
      ),
    `${inventoryLevels.length} inventory level(s), all stocked`
  )

  const { data: salesChannels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name"],
  })
  const salesChannel = salesChannels[0]
  record(
    "sales-channel",
    Boolean(salesChannel),
    salesChannel ? `${salesChannel.id}` : "no sales channel available"
  )

  // The decisive end-to-end assertion: a cart built on the storefront's region
  // id with a fixture variant proves region, BRL pricing and inventory agree.
  if (regionOk && checkoutVariantId && salesChannel) {
    try {
      const { result: cart } = await createCartWorkflow(container).run({
        input: {
          region_id: STOREFRONT_REGION_ID,
          sales_channel_id: salesChannel.id,
          currency_code: CARD140_CURRENCY_CODE,
          email: "card140-local-fixture@example.test",
          shipping_address: {
            city: "Sao Paulo",
            province: "SP",
            postal_code: "01001000",
            country_code: CARD140_COUNTRY_CODE,
            address_1: "Local fixture only",
          },
          items: [{ variant_id: checkoutVariantId, quantity: 1 }],
        },
      })

      const lineItem = (cart.items ?? [])[0]
      record(
        "cart",
        cart.region_id === STOREFRONT_REGION_ID &&
          cart.currency_code === CARD140_CURRENCY_CODE &&
          Boolean(lineItem) &&
          Number(lineItem?.unit_price) > 0,
        `cart ${cart.id} region=${cart.region_id} currency=${cart.currency_code} unit_price=${lineItem?.unit_price}`
      )

      const { result: shippingOptions } =
        await listShippingOptionsForCartWorkflow(container).run({
          // Region, sales channel and address are derived from the cart. The
          // two flags mirror the rules the fixture puts on its test shipping
          // option, which is what the storefront's store API call resolves.
          input: {
            cart_id: cart.id,
            is_return: false,
            enabled_in_store: true,
          },
        })
      record(
        "shipping-options",
        shippingOptions.length > 0,
        `${shippingOptions.length} shipping option(s) reachable from the fixture stock location`
      )
    } catch (error) {
      record(
        "cart",
        false,
        `cart or shipping lookup failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`
      )
    }
  } else {
    record(
      "cart",
      false,
      "skipped: region, variant or sales channel prerequisites failed"
    )
  }

  for (const result of results) {
    logger[result.ok ? "info" : "error"](
      `[card140:check-ids] ${result.ok ? "PASS" : "FAIL"} ${result.name} — ${result.detail}`
    )
  }

  const failed = results.filter((result) => !result.ok)
  if (failed.length) {
    throw new Error(
      `Card 140 storefront id parity failed (${failed.length}/${results.length}): ` +
        failed.map((result) => result.name).join(", ")
    )
  }

  logger.info(
    `[card140:check-ids] all ${results.length} checks passed; the reviewed storefront can talk to this disposable backend`
  )
}
