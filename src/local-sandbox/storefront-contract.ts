/**
 * Identity contract between the Card 140 disposable backend and the reviewed
 * storefront.
 *
 * The storefront pins region and category ids in `src/lib/medusa.ts`
 * (`BRAZIL_REGION_ID`, `MEDUSA_CATEGORY_IDS`). They are public catalog
 * identifiers, not credentials: replicating them here lets a throwaway local
 * backend answer the existing storefront without touching storefront code.
 *
 * Nothing in this file is copied from production beyond those identifiers — the
 * names, handles, prices and stock below are synthetic.
 */

/** Região Brasil (BRL) expected by the storefront for `calculated_price`. */
export const STOREFRONT_REGION_ID = "reg_01KS62SJ6RCSCZFKJYZ12FN96Y"

/** Categories the storefront requests by id on the home and product routes. */
export const STOREFRONT_CATEGORY_IDS = {
  AIRSOFT: "pcat_01KS4XNZC8VHRNTH47Z8EBA45R",
  ACESSORIOS: "pcat_01KS4XNZC8KQFD0DQQHG48YGTB",
  PRESSAO: "pcat_01KS4XNZC82BKQYV0XD2K7MM59",
  CUTELARIA: "pcat_01KS4XNZC7QE2V16G7AYK0TB9G",
} as const

export type StorefrontCategoryKey = keyof typeof STOREFRONT_CATEGORY_IDS

export const CARD140_CURRENCY_CODE = "brl"
export const CARD140_COUNTRY_CODE = "br"
export const CARD140_STOCKED_QUANTITY = 25

export type Card140CategoryFixture = {
  key: StorefrontCategoryKey
  id: string
  name: string
  handle: string
}

/**
 * Root categories only: the storefront navigation lists them with
 * `parent_category_id: null` and `include_descendants_tree`.
 */
export const CARD140_CATEGORIES: readonly Card140CategoryFixture[] = [
  {
    key: "AIRSOFT",
    id: STOREFRONT_CATEGORY_IDS.AIRSOFT,
    name: "Airsoft",
    handle: "airsoft",
  },
  {
    key: "PRESSAO",
    id: STOREFRONT_CATEGORY_IDS.PRESSAO,
    name: "Pressao",
    handle: "pressao",
  },
  {
    key: "ACESSORIOS",
    id: STOREFRONT_CATEGORY_IDS.ACESSORIOS,
    name: "Acessorios",
    handle: "acessorios",
  },
  {
    key: "CUTELARIA",
    id: STOREFRONT_CATEGORY_IDS.CUTELARIA,
    name: "Cutelaria",
    handle: "cutelaria",
  },
] as const

export type Card140ProductFixture = {
  categoryKey: StorefrontCategoryKey
  title: string
  handle: string
  sku: string
  /** Price in BRL, matching the existing fixture's minor-unit convention. */
  amount: number
}

/**
 * One synthetic product per consumed category, so every storefront section the
 * reviewed code renders resolves to a product instead of an empty list. This is
 * a minimal parity dataset, not a copy of the production catalog.
 */
export const CARD140_PRODUCTS: readonly Card140ProductFixture[] = [
  {
    categoryKey: "AIRSOFT",
    title: "Card 140 Local Airsoft",
    handle: "card140-local-airsoft",
    sku: "CARD140-BRL-AIRSOFT",
    amount: 199,
  },
  {
    categoryKey: "PRESSAO",
    title: "Card 140 Local Pressao",
    handle: "card140-local-pressao",
    sku: "CARD140-BRL-PRESSAO",
    amount: 249,
  },
  {
    categoryKey: "ACESSORIOS",
    title: "Card 140 Local Acessorio",
    handle: "card140-local-acessorio",
    sku: "CARD140-BRL-ACESSORIOS",
    amount: 79,
  },
  {
    categoryKey: "CUTELARIA",
    title: "Card 140 Local Cutelaria",
    handle: "card140-local-cutelaria",
    sku: "CARD140-BRL-CUTELARIA",
    amount: 129,
  },
] as const

export class Card140ContractError extends Error {
  constructor(message: string) {
    super(`Card 140 storefront contract invalid: ${message}`)
    this.name = "Card140ContractError"
  }
}

const ID_PATTERN = /^(reg|pcat)_[0-9A-HJKMNP-TV-Z]{26}$/

/**
 * Fails closed on a malformed or duplicated identifier before any database work
 * happens, so a typo surfaces as a contract error rather than as a silently
 * empty storefront.
 */
export const assertStorefrontContract = (): void => {
  const ids = [
    STOREFRONT_REGION_ID,
    ...CARD140_CATEGORIES.map((category) => category.id),
  ]
  for (const id of ids) {
    if (!ID_PATTERN.test(id)) {
      throw new Card140ContractError(`${id} is not a valid prefixed Medusa id`)
    }
  }
  if (new Set(ids).size !== ids.length) {
    throw new Card140ContractError("region and category ids must be unique")
  }

  const categoryKeys = CARD140_CATEGORIES.map((category) => category.key)
  const expectedKeys = Object.keys(STOREFRONT_CATEGORY_IDS) as StorefrontCategoryKey[]
  for (const key of expectedKeys) {
    if (!categoryKeys.includes(key)) {
      throw new Card140ContractError(`category ${key} has no fixture`)
    }
    const fixture = CARD140_CATEGORIES.find((category) => category.key === key)!
    if (fixture.id !== STOREFRONT_CATEGORY_IDS[key]) {
      throw new Card140ContractError(`category ${key} does not use the storefront id`)
    }
  }

  const skus = CARD140_PRODUCTS.map((product) => product.sku)
  if (new Set(skus).size !== skus.length) {
    throw new Card140ContractError("product SKUs must be unique")
  }
  for (const product of CARD140_PRODUCTS) {
    if (!categoryKeys.includes(product.categoryKey)) {
      throw new Card140ContractError(`product ${product.sku} targets an unknown category`)
    }
    if (!Number.isSafeInteger(product.amount) || product.amount <= 0) {
      throw new Card140ContractError(`product ${product.sku} has a non-positive price`)
    }
  }
}
