export const MENU_VERSION = "bunker-menu-20261016"
export const MENU_MARKER_KEY = "bunker_menu"

export type MenuChild = { handle: string; name: string }
export type MenuCategory = MenuChild & { reuse?: string; children: MenuChild[] }
export type Rule = { pattern: RegExp; handle: string }

export type CategoryRow = {
  id: string
  handle: string
  name: string
  parent_category_id: string | null
  rank: number | null
  is_active: boolean
  metadata?: Record<string, unknown> | null
}
export type ProductRow = { id: string; title: string; category_ids: string[] }
export type Assignment = { product_id: string; category_handle: string }

export type CategoryCreate = {
  name: string
  handle: string
  parent_category_id: string | null
  rank: number
  is_active: false
  is_internal: false
  metadata: Record<string, unknown>
}
export type CategoryUpdate = Partial<Pick<CategoryRow, "name" | "handle" | "is_active">> & {
  rank?: number
  metadata?: Record<string, unknown>
}

export type MenuStore = {
  listCategories(): Promise<CategoryRow[]>
  createCategory(data: CategoryCreate): Promise<CategoryRow>
  updateCategory(id: string, data: CategoryUpdate): Promise<unknown>
  listProducts(): Promise<ProductRow[]>
  setProductCategories(productId: string, categoryIds: string[]): Promise<unknown>
}

type Marker = {
  version: string
  created?: boolean
  previous?: Pick<CategoryRow, "name" | "handle" | "rank" | "is_active">
}

function marker(row: CategoryRow): Marker | undefined {
  const value = row.metadata?.[MENU_MARKER_KEY]
  return value && typeof value === "object" ? value as Marker : undefined
}

function withMarker(row: CategoryRow | undefined, value: Marker): Record<string, unknown> {
  return { ...(row?.metadata ?? {}), [MENU_MARKER_KEY]: value }
}

function withoutMarker(row: CategoryRow): Record<string, unknown> {
  const { [MENU_MARKER_KEY]: _removed, ...rest } = row.metadata ?? {}
  return rest
}

export function menuHandles(menu: MenuCategory[]): string[] {
  return menu.flatMap(top => [top.handle, ...top.children.map(child => child.handle)])
}

export function validateMenu(menu: MenuCategory[], retired: string[]): void {
  const handles = menuHandles(menu)
  if (new Set(handles).size !== handles.length) throw new Error("Menu handles must be unique")
  for (const top of menu) {
    for (const node of [top, ...top.children]) {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(node.handle)) throw new Error(`Invalid handle: ${node.handle}`)
      if (!node.name.trim()) throw new Error(`Missing name: ${node.handle}`)
    }
  }
  const reused = menu.flatMap(top => top.reuse ? [top.reuse] : [])
  if (retired.some(handle => handles.includes(handle) || reused.includes(handle))) {
    throw new Error("A retired category cannot also be part of the menu")
  }
}

/** First matching rule wins; magazines go to their brand sub-item when the title names it. */
export function suggestCategory(title: string, rules: Rule[], brandRules: Rule[]): string | null {
  const match = rules.find(rule => rule.pattern.test(title))?.handle ?? null
  if (match !== "magazines") return match
  return brandRules.find(rule => rule.pattern.test(title))?.handle ?? match
}

/** Resolves each menu entry to an existing row: by its new handle, else by the handle it reuses. */
function resolveMenu(menu: MenuCategory[], rows: CategoryRow[]) {
  const byHandle = new Map(rows.map(row => [row.handle, row]))
  const resolved = new Map<string, CategoryRow | undefined>()
  for (const top of menu) {
    const topRow = byHandle.get(top.handle) ?? (top.reuse ? byHandle.get(top.reuse) : undefined)
    resolved.set(top.handle, topRow)
    for (const child of top.children) {
      const childRow = byHandle.get(child.handle)
      if (childRow && topRow && childRow.parent_category_id !== topRow.id) {
        throw new Error(`Handle ${child.handle} already exists under another parent`)
      }
      resolved.set(child.handle, childRow)
    }
  }
  return resolved
}

export type PlanItem = { handle: string; name: string; parent: string | null; status: "reuse" | "exists" | "create" }

export function planMenu(menu: MenuCategory[], rows: CategoryRow[]): PlanItem[] {
  const resolved = resolveMenu(menu, rows)
  return menu.flatMap(top => {
    const topRow = resolved.get(top.handle)
    const topStatus: PlanItem["status"] = !topRow ? "create" : topRow.handle === top.handle ? "exists" : "reuse"
    return [
      { handle: top.handle, name: top.name, parent: null, status: topStatus },
      ...top.children.map(child => ({
        handle: child.handle, name: child.name, parent: top.handle,
        status: (resolved.get(child.handle) ? "exists" : "create") as PlanItem["status"],
      })),
    ]
  })
}

/** Creates the missing categories hidden (inactive). Never touches rows that already exist. */
export async function prepareMenu(menu: MenuCategory[], store: MenuStore) {
  let created = 0
  let rows = await store.listCategories()
  for (const [topIndex, top] of menu.entries()) {
    let topRow = resolveMenu(menu, rows).get(top.handle)
    if (!topRow) {
      topRow = await store.createCategory({
        name: top.name, handle: top.handle, parent_category_id: null, rank: topIndex,
        is_active: false, is_internal: false, metadata: withMarker(undefined, { version: MENU_VERSION, created: true }),
      })
      rows = [...rows, topRow]
      created++
    }
    for (const [childIndex, child] of top.children.entries()) {
      if (rows.some(row => row.handle === child.handle)) continue
      const childRow = await store.createCategory({
        name: child.name, handle: child.handle, parent_category_id: topRow.id, rank: childIndex,
        is_active: false, is_internal: false, metadata: withMarker(undefined, { version: MENU_VERSION, created: true }),
      })
      rows = [...rows, childRow]
      created++
    }
  }
  return { created }
}

/** Adds the reviewed category to each product, keeping the categories it already has. */
export async function assignProducts(menu: MenuCategory[], assignments: Assignment[], store: MenuStore) {
  const allowed = new Set(menuHandles(menu))
  const rows = await store.listCategories()
  const resolved = resolveMenu(menu, rows)
  const products = new Map((await store.listProducts()).map(product => [product.id, product]))
  const wanted = new Map<string, Set<string>>()
  for (const { product_id, category_handle } of assignments) {
    if (!allowed.has(category_handle)) throw new Error(`Category ${category_handle} is not in the menu`)
    const row = resolved.get(category_handle)
    if (!row) throw new Error(`Category ${category_handle} does not exist yet: run prepare first`)
    if (!products.has(product_id)) throw new Error(`Unknown product ${product_id}`)
    wanted.set(product_id, (wanted.get(product_id) ?? new Set()).add(row.id))
  }
  let updated = 0
  let unchanged = 0
  for (const [productId, categoryIds] of wanted) {
    const current = products.get(productId)!.category_ids
    const next = [...new Set([...current, ...categoryIds])]
    if (next.length === current.length) {
      unchanged++
      continue
    }
    await store.setProductCategories(productId, next)
    updated++
  }
  return { updated, unchanged }
}

/** Products that would be left with no visible category once only the menu is active. */
export function orphanProducts(menu: MenuCategory[], rows: CategoryRow[], products: ProductRow[]): ProductRow[] {
  const resolved = resolveMenu(menu, rows)
  const visible = new Set([...resolved.values()].flatMap(row => row ? [row.id] : []))
  return products.filter(product => !product.category_ids.some(id => visible.has(id)))
}

/**
 * Publishes the menu: renames reused categories, activates and orders the menu, and hides
 * every other category. Refuses while a product would vanish from the menu unless allowed.
 */
export async function switchMenu(menu: MenuCategory[], store: MenuStore, options: { allowOrphans: boolean }) {
  const rows = await store.listCategories()
  const resolved = resolveMenu(menu, rows)
  const missing = menuHandles(menu).filter(handle => !resolved.get(handle))
  if (missing.length) throw new Error(`Run prepare first; missing: ${missing.join(", ")}`)
  const orphans = orphanProducts(menu, rows, await store.listProducts())
  if (orphans.length && !options.allowOrphans) {
    throw new Error(`${orphans.length} product(s) would leave the menu: ${orphans.map(p => p.title).join(" | ")}`)
  }

  const menuIds = new Set<string>()
  let activated = 0
  for (const [topIndex, top] of menu.entries()) {
    for (const [index, node] of [
      [topIndex, top] as const,
      ...top.children.map((child, childIndex) => [childIndex, child] as const),
    ]) {
      const row = resolved.get(node.handle)!
      menuIds.add(row.id)
      const target = { name: node.name, handle: node.handle, rank: index, is_active: true }
      if (row.name === target.name && row.handle === target.handle && row.rank === target.rank && row.is_active) continue
      const previous = marker(row)?.previous ?? { name: row.name, handle: row.handle, rank: row.rank, is_active: row.is_active }
      const created = marker(row)?.created
      await store.updateCategory(row.id, {
        ...target,
        metadata: withMarker(row, { version: MENU_VERSION, ...(created ? { created } : { previous }) }),
      })
      activated++
    }
  }

  let hidden = 0
  for (const row of rows) {
    if (menuIds.has(row.id) || !row.is_active) continue
    await store.updateCategory(row.id, {
      is_active: false,
      metadata: withMarker(row, {
        version: MENU_VERSION,
        previous: { name: row.name, handle: row.handle, rank: row.rank, is_active: row.is_active },
      }),
    })
    hidden++
  }
  return { activated, hidden, orphans: orphans.length }
}

/** Undoes the switch: restores previous names/handles/visibility and hides created categories. */
export async function rollbackMenu(store: MenuStore) {
  let restored = 0
  let hidden = 0
  for (const row of await store.listCategories()) {
    const value = marker(row)
    if (!value || value.version !== MENU_VERSION) continue
    if (value.created) {
      if (row.is_active) {
        await store.updateCategory(row.id, { is_active: false })
        hidden++
      }
      continue
    }
    if (value.previous) {
      const { rank, ...previous } = value.previous
      await store.updateCategory(row.id, {
        ...previous,
        ...(typeof rank === "number" ? { rank } : {}),
        metadata: withoutMarker(row),
      })
      restored++
    }
  }
  return { restored, hidden }
}
