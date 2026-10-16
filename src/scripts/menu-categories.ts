import { readFileSync } from "node:fs"
import type { MedusaContainer } from "@medusajs/framework"
import type { IProductModuleService } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  assignProducts, orphanProducts, planMenu, prepareMenu, rollbackMenu, suggestCategory, switchMenu, validateMenu,
  type Assignment, type CategoryRow, type MenuStore, type ProductRow,
} from "./menu-categories-core"
import { magazineBrandRules, menuCategories, retiredCategoryHandles, suggestionRules } from "./data/menu-categories-20261016"
import { menuAssignments } from "./data/menu-assignments-20261016"

const MODES = ["preview", "prepare", "assign", "switch", "rollback"] as const

// BUNKER_MENU_MODE=preview (default, read-only) | prepare | assign | switch | rollback
// assign uses data/menu-assignments-20261016.ts, or BUNKER_MENU_ASSIGNMENTS (JSON file) when set.
// switch refuses while products would leave the menu, unless BUNKER_MENU_ALLOW_ORPHANS=true.
export default async function menuCategoriesCommand({ container }: { container: MedusaContainer }) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const productService = container.resolve<IProductModuleService>(Modules.PRODUCT)
  const mode = (process.env.BUNKER_MENU_MODE || "preview") as typeof MODES[number]
  if (!MODES.includes(mode)) throw new Error(`BUNKER_MENU_MODE must be one of ${MODES.join(", ")}`)
  validateMenu(menuCategories, retiredCategoryHandles)

  const store: MenuStore = {
    listCategories: async () => await productService.listProductCategories({}, {
      select: ["id", "handle", "name", "parent_category_id", "rank", "is_active", "metadata"], take: null,
    }) as CategoryRow[],
    createCategory: async data => (await productService.createProductCategories([data]))[0] as CategoryRow,
    updateCategory: (id, data) => productService.updateProductCategories(id, data),
    listProducts: async () => (await productService.listProducts({}, {
      select: ["id", "title"], relations: ["categories"], take: null,
    })).map((product): ProductRow => ({
      id: product.id, title: product.title, category_ids: (product.categories ?? []).map(category => category.id),
    })),
    setProductCategories: (productId, categoryIds) => productService.updateProducts(productId, { category_ids: categoryIds }),
  }

  if (mode === "preview") {
    const rows = await store.listCategories()
    const plan = planMenu(menuCategories, rows)
    for (const item of plan) logger.info(`MENU_PLAN ${item.status} ${item.parent ? `${item.parent} > ` : ""}${item.handle} "${item.name}"`)
    const handleById = new Map(rows.map(row => [row.id, row.handle]))
    const products = await store.listProducts()
    for (const product of products) {
      const current = product.category_ids.map(id => handleById.get(id) ?? id).join(",")
      const suggested = suggestCategory(product.title, suggestionRules, magazineBrandRules) ?? "REVISAR"
      logger.info(`MENU_PRODUCT\t${product.id}\t${product.title}\t${current}\t${suggested}`)
    }
    const orphans = orphanProducts(menuCategories, rows, products).length
    logger.info(`MENU_PREVIEW create=${plan.filter(i => i.status === "create").length} reuse=${plan.filter(i => i.status === "reuse").length} products=${products.length} outside_menu_today=${orphans}. No writes.`)
  } else if (mode === "prepare") {
    logger.info(`MENU_PREPARED ${JSON.stringify(await prepareMenu(menuCategories, store))}. New categories stay hidden until switch.`)
  } else if (mode === "assign") {
    const file = process.env.BUNKER_MENU_ASSIGNMENTS
    const assignments = file ? JSON.parse(readFileSync(file, "utf8")) as Assignment[] : menuAssignments
    logger.info(`MENU_ASSIGNED ${JSON.stringify(await assignProducts(menuCategories, assignments, store))}`)
  } else if (mode === "switch") {
    const allowOrphans = process.env.BUNKER_MENU_ALLOW_ORPHANS === "true"
    logger.info(`MENU_SWITCHED ${JSON.stringify(await switchMenu(menuCategories, store, { allowOrphans }))}`)
  } else {
    logger.info(`MENU_ROLLBACK ${JSON.stringify(await rollbackMenu(store))}`)
  }
}
