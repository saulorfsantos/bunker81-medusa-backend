export const IMPORT_VERSION = "bunker-catalog-20261016"
export const IMPORT_MARKER_KEY = "bunker_catalog_import"
/** Store price = reseller cost + 40% (Saulo, 16 Oct 2026). */
export const MARKUP = 0.4

export type ImportProduct = {
  handle: string
  sku: string
  title: string
  description: string
  brand: string
  /** Reseller price per unit, in BRL. */
  cost: number
  category_handle: string
  source: string
}

export function storePrice(cost: number): number {
  return Math.round(cost * (1 + MARKUP) * 100) / 100
}

export function validateImport(products: ImportProduct[], allowedCategories: string[]): void {
  const handles = new Set<string>()
  const skus = new Set<string>()
  for (const product of products) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(product.handle)) throw new Error(`Invalid handle: ${product.handle}`)
    if (handles.has(product.handle)) throw new Error(`Duplicate handle: ${product.handle}`)
    if (skus.has(product.sku)) throw new Error(`Duplicate SKU: ${product.sku}`)
    handles.add(product.handle)
    skus.add(product.sku)
    if (!(Number.isFinite(product.cost) && product.cost > 0)) throw new Error(`Invalid cost: ${product.handle}`)
    if (Math.abs(product.cost * 100 - Math.round(product.cost * 100)) > 1e-6) throw new Error(`Cost must have cents only: ${product.handle}`)
    if (!allowedCategories.includes(product.category_handle)) throw new Error(`Category ${product.category_handle} is not in the menu`)
    for (const field of ["sku", "title", "description", "brand", "source"] as const) {
      if (!product[field].trim()) throw new Error(`Missing ${field}: ${product.handle}`)
    }
  }
}

export type ImportPlanItem = ImportProduct & { price: number; status: "create" | "exists" }

export function planImport(products: ImportProduct[], existing: { handles: string[]; skus: string[] }): ImportPlanItem[] {
  return products.map(product => ({
    ...product,
    price: storePrice(product.cost),
    status: existing.handles.includes(product.handle) || existing.skus.includes(product.sku) ? "exists" : "create",
  }))
}

/** Input for Medusa's createProductsWorkflow: published, one default variant, BRL price, no stock. */
export function toWorkflowProduct(
  item: ImportPlanItem,
  context: { categoryId: string; salesChannelId: string; shippingProfileId: string },
) {
  return {
    title: item.title,
    handle: item.handle,
    description: item.description,
    status: "published" as const,
    category_ids: [context.categoryId],
    shipping_profile_id: context.shippingProfileId,
    sales_channels: [{ id: context.salesChannelId }],
    metadata: {
      brand: item.brand,
      [IMPORT_MARKER_KEY]: { version: IMPORT_VERSION, source: item.source, cost_brl: item.cost, markup: MARKUP },
    },
    options: [{ title: "Padrão", values: ["Padrão"] }],
    variants: [{
      title: "Padrão",
      sku: item.sku,
      manage_inventory: true,
      allow_backorder: false,
      options: { Padrão: "Padrão" },
      prices: [{ amount: item.price, currency_code: "brl" }],
    }],
  }
}
