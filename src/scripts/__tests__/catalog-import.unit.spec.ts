import { IMPORT_MARKER_KEY, planImport, storePrice, toWorkflowProduct, validateImport } from "../catalog-import-core"
import { menuHandles } from "../menu-categories-core"
import { menuCategories } from "../data/menu-categories-20261016"
import { leaoProducts } from "../data/leao-produtos-20261016"
import { menuAssignments } from "../data/menu-assignments-20261016"
import { shippingProfiles } from "../data/shipping-profiles-20261012"

const allowed = menuHandles(menuCategories)

describe("Leão catalogue import", () => {
  it("prices every item at reseller cost + 40%, rounded to cents", () => {
    expect(storePrice(899)).toBe(1258.6)
    expect(storePrice(1049)).toBe(1468.6)
    expect(storePrice(779)).toBe(1090.6)
    expect(storePrice(4)).toBe(5.6)
    expect(storePrice(5.11)).toBe(7.15)
    expect(storePrice(45.89)).toBe(64.25)
    expect(storePrice(20.19)).toBe(28.27)
    expect(storePrice(2200.46)).toBe(3080.64)
  })

  it("has valid, unique products in menu categories that are not already in the store", () => {
    expect(() => validateImport(leaoProducts, allowed)).not.toThrow()
    expect(leaoProducts).toHaveLength(27)
    expect(leaoProducts.filter(p => p.brand === "Specna Arms").map(p => p.sku)).toEqual(["SA-S02-MC", "SA-S03-MC", "SA-S03-TAN", "SA-S03-OLV"])
    const currentSkus = new Set(shippingProfiles.map(p => p.sku))
    expect(leaoProducts.filter(p => currentSkus.has(p.sku))).toEqual([])
    expect(() => validateImport([...leaoProducts, leaoProducts[0]], allowed)).toThrow(/Duplicate handle/)
    expect(() => validateImport([{ ...leaoProducts[0], category_handle: "cutelaria" }], allowed)).toThrow(/not in the menu/)
    expect(() => validateImport([{ ...leaoProducts[0], cost: 0 }], allowed)).toThrow(/Invalid cost/)
    expect(() => validateImport([{ ...leaoProducts[0], cost: 1.001 }], allowed)).toThrow(/cents/)
  })

  it("skips products that already exist by handle or SKU", () => {
    const plan = planImport(leaoProducts.slice(0, 3), { handles: [leaoProducts[0].handle], skus: [leaoProducts[1].sku] })
    expect(plan.map(item => item.status)).toEqual(["exists", "exists", "create"])
    expect(plan[2].price).toBe(storePrice(leaoProducts[2].cost))
  })

  it("creates a published product with one BRL price, managed stock, brand and cost marker", () => {
    const [item] = planImport([leaoProducts[0]], { handles: [], skus: [] })
    const product = toWorkflowProduct(item, { categoryId: "pcat_1", salesChannelId: "sc_1", shippingProfileId: "sp_1" })
    expect(product).toMatchObject({
      status: "published", category_ids: ["pcat_1"], shipping_profile_id: "sp_1", sales_channels: [{ id: "sc_1" }],
      metadata: { brand: "Specna Arms", [IMPORT_MARKER_KEY]: { cost_brl: 899, markup: 0.4 } },
    })
    expect(product.variants).toEqual([expect.objectContaining({
      sku: "SA-S02-MC", manage_inventory: true, allow_backorder: false,
      prices: [{ amount: 1258.6, currency_code: "brl" }],
    })])
  })
})

describe("menu assignments for the current catalogue", () => {
  it("places each of the 72 current products in one menu category", () => {
    const productIds = new Set(shippingProfiles.map(p => p.product_id))
    expect(menuAssignments).toHaveLength(72)
    expect(new Set(menuAssignments.map(a => a.product_id)).size).toBe(72)
    expect(menuAssignments.every(a => productIds.has(a.product_id))).toBe(true)
    expect(menuAssignments.every(a => allowed.includes(a.category_handle))).toBe(true)
    const knife = shippingProfiles.find(p => p.title.startsWith("Canivete Jiboia"))!
    expect(menuAssignments.find(a => a.product_id === knife.product_id)?.category_handle).toBe("loadout")
  })
})
