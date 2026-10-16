import type { MedusaContainer } from "@medusajs/framework"
import type { IFulfillmentModuleService, IProductModuleService, IStoreModuleService } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import { IMPORT_MARKER_KEY, IMPORT_VERSION, planImport, toWorkflowProduct, validateImport } from "./catalog-import-core"
import { menuHandles } from "./menu-categories-core"
import { menuCategories } from "./data/menu-categories-20261016"
import { leaoProducts } from "./data/leao-produtos-20261016"

const MODES = ["preview", "apply", "unpublish"] as const

// BUNKER_CATALOG_MODE=preview (default, read-only) | apply | unpublish
// apply creates only missing products (by handle and SKU), published, price = cost + 40%, no stock.
// Needs the menu categories (menu-categories prepare). unpublish moves these products back to draft.
export default async function catalogImportCommand({ container }: { container: MedusaContainer }) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const productService = container.resolve<IProductModuleService>(Modules.PRODUCT)
  const mode = (process.env.BUNKER_CATALOG_MODE || "preview") as typeof MODES[number]
  if (!MODES.includes(mode)) throw new Error(`BUNKER_CATALOG_MODE must be one of ${MODES.join(", ")}`)
  validateImport(leaoProducts, menuHandles(menuCategories))

  if (mode === "unpublish") {
    const products = await productService.listProducts({ handle: leaoProducts.map(p => p.handle) }, { select: ["id", "handle", "status", "metadata"], take: null })
    const ours = products.filter(p => (p.metadata?.[IMPORT_MARKER_KEY] as { version?: string } | undefined)?.version === IMPORT_VERSION)
    for (const product of ours) await productService.updateProducts(product.id, { status: "draft" })
    logger.info(`CATALOG_UNPUBLISHED ${ours.length} product(s) moved to draft. Nothing deleted.`)
    return
  }

  const existingProducts = await productService.listProducts({ handle: leaoProducts.map(p => p.handle) }, { select: ["handle"], take: null })
  const existingVariants = await productService.listProductVariants({ sku: leaoProducts.map(p => p.sku) }, { select: ["sku"], take: null })
  const plan = planImport(leaoProducts, {
    handles: existingProducts.map(p => p.handle),
    skus: existingVariants.flatMap(v => v.sku ? [v.sku] : []),
  })
  for (const item of plan) {
    logger.info(`CATALOG_ITEM ${item.status}\t${item.sku}\t${item.title}\tcusto=${item.cost.toFixed(2)}\tloja=${item.price.toFixed(2)}\t${item.category_handle}`)
  }
  const toCreate = plan.filter(item => item.status === "create")
  if (mode === "preview") {
    logger.info(`CATALOG_PREVIEW create=${toCreate.length} exists=${plan.length - toCreate.length}. No writes.`)
    return
  }

  const categories = await productService.listProductCategories({ handle: [...new Set(toCreate.map(i => i.category_handle))] }, { select: ["id", "handle"], take: null })
  const categoryId = new Map(categories.map(c => [c.handle, c.id]))
  const missing = toCreate.filter(i => !categoryId.has(i.category_handle)).map(i => i.category_handle)
  if (missing.length) throw new Error(`Run menu-categories prepare first; missing: ${[...new Set(missing)].join(", ")}`)

  const storeService = container.resolve<IStoreModuleService>(Modules.STORE)
  const [store] = await storeService.listStores({}, { select: ["id", "default_sales_channel_id"] })
  if (!store?.default_sales_channel_id) throw new Error("Store has no default sales channel")
  const fulfillmentService = container.resolve<IFulfillmentModuleService>(Modules.FULFILLMENT)
  const [profile] = await fulfillmentService.listShippingProfiles({ type: "default" }, { select: ["id"] })
  if (!profile) throw new Error("No default shipping profile")

  if (toCreate.length) {
    await createProductsWorkflow(container).run({
      input: {
        products: toCreate.map(item => toWorkflowProduct(item, {
          categoryId: categoryId.get(item.category_handle)!,
          salesChannelId: store.default_sales_channel_id!,
          shippingProfileId: profile.id,
        })),
      },
    })
  }
  logger.info(`CATALOG_APPLIED created=${toCreate.length} skipped_existing=${plan.length - toCreate.length}. No stock: shown as unavailable.`)
}
