import {
  assignProducts, exclusiveAssign, MENU_MARKER_KEY, PREVIOUS_CATEGORIES_KEY, restoreProductCategories, menuHandles, planMenu, prepareMenu, rollbackMenu, suggestCategory, switchMenu, validateMenu,
  type CategoryRow, type MenuStore, type ProductRow,
} from "../menu-categories-core"
import { magazineBrandRules, menuCategories, retiredCategoryHandles, suggestionRules } from "../data/menu-categories-20261016"
import { shippingProfiles } from "../data/shipping-profiles-20261012"

const legacy: CategoryRow[] = [
  { id: "c_airsoft", handle: "airsoft", name: "Airsoft", parent_category_id: null, rank: 0, is_active: true, metadata: { keep: 1 } },
  { id: "c_rifles", handle: "rifles", name: "Rifles", parent_category_id: "c_airsoft", rank: 0, is_active: true },
  { id: "c_pressao", handle: "pressao", name: "Pressão", parent_category_id: null, rank: 1, is_active: true },
  { id: "c_acessorios", handle: "acessorios", name: "Acessórios", parent_category_id: null, rank: 2, is_active: true },
  { id: "c_cutelaria", handle: "cutelaria", name: "Cutelaria", parent_category_id: null, rank: 3, is_active: true },
]

function fixture(products: ProductRow[] = []) {
  const rows = new Map(legacy.map(row => [row.id, structuredClone(row)]))
  const items = new Map(products.map(product => [product.id, structuredClone(product)]))
  let next = 0
  const store: MenuStore = {
    listCategories: async () => [...rows.values()].map(row => structuredClone(row)),
    createCategory: jest.fn(async data => {
      const row: CategoryRow = { id: `new_${next++}`, handle: data.handle, name: data.name,
        parent_category_id: data.parent_category_id, rank: data.rank, is_active: data.is_active, metadata: data.metadata }
      rows.set(row.id, row)
      return structuredClone(row)
    }),
    updateCategory: jest.fn(async (id, data) => { rows.set(id, { ...rows.get(id)!, ...data }) }),
    listProducts: async () => [...items.values()].map(product => structuredClone(product)),
    setProductCategories: jest.fn(async (id, ids) => { items.set(id, { ...items.get(id)!, category_ids: ids }) }),
    replaceProductCategories: jest.fn(async (id, ids, metadata) => { items.set(id, { ...items.get(id)!, category_ids: ids, metadata }) }),
  }
  const byHandle = (handle: string) => [...rows.values()].find(row => row.handle === handle)
  return { rows, items, store, byHandle }
}

describe("storefront menu categories", () => {
  it("validates the approved menu: 7 tabs in sketch order, unique handles, Dots / Lunetas together", () => {
    expect(() => validateMenu(menuCategories, retiredCategoryHandles)).not.toThrow()
    expect(menuCategories.map(top => top.name)).toEqual([
      "Armas Airsoft", "Airguns e Carabinas", "Suprimentos", "Peças", "Loadout", "Acessórios", "Magazines",
    ])
    const acessorios = menuCategories.find(top => top.handle === "acessorios")!
    expect(acessorios.children.slice(0, 2)).toEqual([{ handle: "dots", name: "Dots / Lunetas" }, { handle: "lanternas-laser", name: "Lanternas e Laser" }])
    expect(menuCategories.find(top => top.handle === "pecas")!.children[0].name).toBe("Buckings e Engrenagens")
    expect(menuCategories.find(top => top.handle === "magazines")!.children.map(child => child.name)).toEqual(["Rossi", "Specna Arms"])
    expect(menuCategories.find(top => top.handle === "armas-airsoft")!.children.map(child => child.handle)).toEqual(["pistolas-gbb-co2"])
    expect(menuCategories.find(top => top.handle === "airguns-carabinas")!.children.map(child => child.name)).toEqual(["Rossi", "Specna Arms"])
    expect(() => validateMenu([...menuCategories, { handle: "bbs", name: "Dup", children: [] }], [])).toThrow(/unique/)
    expect(() => validateMenu(menuCategories, ["acessorios"])).toThrow(/retired/)
  })

  it("suggests a sub-item for the current catalogue titles and leaves unknown ones for review", () => {
    const suggest = (title: string) => suggestCategory(title, suggestionRules, magazineBrandRules)
    expect(suggest("BB's Tracer Tango Down 0.25g 2.800un")).toBe("bbs")
    expect(suggest("BB's Sniper Tango Down 0.36g 1.000un")).toBe("bbs")
    expect(suggest("Magazine M4 Mid-Cap HP Polímero 130 BB's Rossi")).toBe("magazines-rossi")
    expect(suggest("Combo Specna Arms 5 Mid-Cap 125 BB's")).toBe("magazines-specna-arms")
    expect(suggest("Coldre Tan Porta Magazine Pistola Rossi")).toBe("coldres")
    expect(suggest("Luneta Rossi 4.5x20 WA Mount 3/8 11mm")).toBe("dots")
    expect(suggest("Mira Holográfica Dot 551 Red/Green Rossi")).toBe("dots")
    expect(suggest("Elevador de Mount para Trilho 22mm")).toBe("bipes-grips-trilhos")
    expect(suggest("Cilindro CO2 12g Leão")).toBe("gas")
    expect(suggest("COLETE MUDULAR PCR ROSSI")).toBe("coletes-modulares")
    expect(suggest("Canivete Jiboia Karambit F386 Rossi")).toBeNull()
    const titles = [...new Set(shippingProfiles.map(profile => profile.title))]
    const unresolved = titles.filter(title => !suggest(title))
    expect(unresolved).toEqual(expect.arrayContaining(["OLEO LUBRIFICANTE SHIELD 300ML ROSSI"]))
    expect(unresolved.length).toBeLessThanOrEqual(5)
  })

  it("prepare creates only the missing categories, hidden, and is idempotent", async () => {
    const { store, byHandle, rows } = fixture()
    expect(planMenu(menuCategories, legacy).filter(item => item.status === "reuse").map(item => item.handle))
      .toEqual(["armas-airsoft", "airguns-carabinas"])
    const expected = menuHandles(menuCategories).length - 3
    expect(await prepareMenu(menuCategories, store)).toEqual({ created: expected })
    expect(await prepareMenu(menuCategories, store)).toEqual({ created: 0 })
    expect(byHandle("pistolas-gbb-co2")).toMatchObject({ parent_category_id: "c_airsoft", is_active: false })
    expect(byHandle("dots")).toMatchObject({ parent_category_id: "c_acessorios", is_active: false })
    expect(byHandle("airguns-rossi")?.parent_category_id).toBe("c_pressao")
    expect(rows.get("c_airsoft")).toEqual(legacy[0])
    expect(store.updateCategory).not.toHaveBeenCalled()
  })

  it("assign adds reviewed categories, keeps current ones and rejects unknown input", async () => {
    const { store, items, byHandle } = fixture([{ id: "p1", title: "BB's", category_ids: ["c_airsoft"] }])
    await expect(assignProducts(menuCategories, [{ product_id: "p1", category_handle: "bbs" }], store)).rejects.toThrow(/prepare first/)
    await prepareMenu(menuCategories, store)
    await expect(assignProducts(menuCategories, [{ product_id: "p1", category_handle: "cutelaria" }], store)).rejects.toThrow(/not in the menu/)
    expect(await assignProducts(menuCategories, [{ product_id: "nope", category_handle: "bbs" }], store)).toEqual({ updated: 0, unchanged: 0, missing_products: ["nope"] })
    expect(await assignProducts(menuCategories, [{ product_id: "p1", category_handle: "bbs" }], store)).toEqual({ updated: 1, unchanged: 0, missing_products: [] })
    expect(items.get("p1")!.category_ids).toEqual(["c_airsoft", byHandle("bbs")!.id])
    expect(await assignProducts(menuCategories, [{ product_id: "p1", category_handle: "bbs" }], store)).toEqual({ updated: 0, unchanged: 1, missing_products: [] })
  })

  it("switch refuses orphans, then publishes the menu and rollback restores the old one", async () => {
    const { store, byHandle, rows } = fixture([
      { id: "p_knife", title: "Canivete", category_ids: ["c_cutelaria"] },
      { id: "p_rifle", title: "Rifle", category_ids: ["c_rifles"] },
      { id: "p_dot", title: "Red Dot", category_ids: ["c_acessorios"] },
    ])
    await expect(switchMenu(menuCategories, store, { allowOrphans: false })).rejects.toThrow(/prepare first/)
    await prepareMenu(menuCategories, store)
    await expect(switchMenu(menuCategories, store, { allowOrphans: false })).rejects.toThrow(/2 product\(s\) would leave the menu: Canivete \| Rifle/)
    await assignProducts(menuCategories, [{ product_id: "p_rifle", category_handle: "armas-airsoft" }], store)
    const result = await switchMenu(menuCategories, store, { allowOrphans: true })
    expect(result).toMatchObject({ hidden: 2, orphans: 1 })

    expect(rows.get("c_airsoft")).toMatchObject({ handle: "armas-airsoft", name: "Armas Airsoft", rank: 0, is_active: true })
    expect(rows.get("c_airsoft")!.metadata).toMatchObject({ keep: 1, [MENU_MARKER_KEY]: { previous: { handle: "airsoft", name: "Airsoft" } } })
    expect(rows.get("c_pressao")).toMatchObject({ handle: "airguns-carabinas", rank: 1, is_active: true })
    expect(rows.get("c_acessorios")).toMatchObject({ rank: 5, is_active: true })
    expect(byHandle("magazines")).toMatchObject({ rank: 6, is_active: true })
    expect(byHandle("lanternas-laser")).toMatchObject({ rank: 1, is_active: true })
    expect(rows.get("c_cutelaria")!.is_active).toBe(false)
    expect(rows.get("c_rifles")!.is_active).toBe(false)

    expect(await switchMenu(menuCategories, store, { allowOrphans: true })).toMatchObject({ activated: 0, hidden: 0 })

    await rollbackMenu(store)
    expect(rows.get("c_airsoft")).toMatchObject({ handle: "airsoft", name: "Airsoft", rank: 0, is_active: true, metadata: { keep: 1 } })
    expect(rows.get("c_pressao")).toMatchObject({ handle: "pressao", name: "Pressão", is_active: true })
    expect(rows.get("c_cutelaria")!.is_active).toBe(true)
    expect(rows.get("c_rifles")!.is_active).toBe(true)
    expect(byHandle("magazines")!.is_active).toBe(false)
    expect(byHandle("dots")!.is_active).toBe(false)
  })

  it("exclusive keeps each product only in its menu category and restore-products undoes it", async () => {
    const { store, items, byHandle } = fixture([
      { id: "p_bb", title: "BB's", category_ids: ["c_airsoft"], metadata: { keep: true } },
      { id: "p_knife", title: "Canivete", category_ids: ["c_cutelaria"] },
      { id: "p_dot", title: "Red Dot", category_ids: ["c_acessorios"] },
    ])
    await prepareMenu(menuCategories, store)
    const assignments = [
      { product_id: "p_bb", category_handle: "bbs" },
      { product_id: "p_knife", category_handle: "loadout" },
      { product_id: "p_dot", category_handle: "dots" },
      { product_id: "gone", category_handle: "dots" },
    ]
    await assignProducts(menuCategories, assignments, store)
    await switchMenu(menuCategories, store, { allowOrphans: false })
    expect(items.get("p_bb")!.category_ids).toEqual(["c_airsoft", byHandle("bbs")!.id])

    expect(await exclusiveAssign(menuCategories, assignments, store)).toEqual({ updated: 2, unchanged: 1, missing_products: ["gone"] })
    expect(items.get("p_bb")).toMatchObject({ category_ids: [byHandle("bbs")!.id], metadata: { keep: true, [PREVIOUS_CATEGORIES_KEY]: ["c_airsoft", byHandle("bbs")!.id] } })
    expect(items.get("p_knife")!.category_ids).toEqual(["c_cutelaria", byHandle("loadout")!.id])
    expect(items.get("p_dot")!.category_ids).toEqual([byHandle("dots")!.id])
    expect((await exclusiveAssign(menuCategories, assignments, store)).unchanged).toBe(3)

    expect(await restoreProductCategories(store)).toEqual({ restored: 2 })
    expect(items.get("p_bb")).toMatchObject({ category_ids: ["c_airsoft", byHandle("bbs")!.id], metadata: { keep: true, [PREVIOUS_CATEGORIES_KEY]: null } })
    expect(await restoreProductCategories(store)).toEqual({ restored: 0 })
  })
})
