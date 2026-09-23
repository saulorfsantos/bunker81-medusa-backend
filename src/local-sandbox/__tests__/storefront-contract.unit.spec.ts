import {
  CARD140_CATEGORIES,
  CARD140_PRODUCTS,
  STOREFRONT_CATEGORY_IDS,
  STOREFRONT_REGION_ID,
  assertStorefrontContract,
} from "../storefront-contract"

/**
 * These identifiers are a contract with the reviewed storefront's
 * `src/lib/medusa.ts`. If that file changes, this suite is where the drift
 * should surface — before anyone spends a Docker smoke on an empty storefront.
 */
const STOREFRONT_MEDUSA_TS = {
  BRAZIL_REGION_ID: "reg_01KS62SJ6RCSCZFKJYZ12FN96Y",
  MEDUSA_CATEGORY_IDS: {
    AIRSOFT: "pcat_01KS4XNZC8VHRNTH47Z8EBA45R",
    ACESSORIOS: "pcat_01KS4XNZC8KQFD0DQQHG48YGTB",
    PRESSAO: "pcat_01KS4XNZC82BKQYV0XD2K7MM59",
    CUTELARIA: "pcat_01KS4XNZC7QE2V16G7AYK0TB9G",
  },
} as const

describe("Card 140 storefront id contract", () => {
  it("mirrors the region id the storefront pins", () => {
    expect(STOREFRONT_REGION_ID).toBe(STOREFRONT_MEDUSA_TS.BRAZIL_REGION_ID)
  })

  it("mirrors every category id the storefront pins", () => {
    expect(STOREFRONT_CATEGORY_IDS).toEqual(STOREFRONT_MEDUSA_TS.MEDUSA_CATEGORY_IDS)
  })

  it("accepts the current contract", () => {
    expect(() => assertStorefrontContract()).not.toThrow()
  })

  it("creates one root category fixture per pinned id", () => {
    expect(CARD140_CATEGORIES.map((category) => category.id).sort()).toEqual(
      Object.values(STOREFRONT_MEDUSA_TS.MEDUSA_CATEGORY_IDS).slice().sort()
    )
  })

  it("covers every consumed category with a synthetic product", () => {
    const covered = new Set(CARD140_PRODUCTS.map((product) => product.categoryKey))
    for (const key of Object.keys(STOREFRONT_MEDUSA_TS.MEDUSA_CATEGORY_IDS)) {
      expect(covered).toContain(key)
    }
  })

  it("keeps the dataset synthetic and local", () => {
    const serialized = JSON.stringify({ CARD140_CATEGORIES, CARD140_PRODUCTS })
    expect(serialized).not.toMatch(/APP_USR-/)
    expect(serialized).not.toMatch(/https?:\/\//)
  })
})
