import { applyProfiles, planProfiles, profileMeasures, rollbackProfiles, SHIPPING_PROFILE_KEY, SHIPPING_PROFILE_VERSION, validateProfiles,
  type ProfileStore, type ShippingProfile, type Variant } from "../shipping-profiles-core"
import { shippingProfiles } from "../data/shipping-profiles-20261012"
import { buildQuotePayload } from "../../modules/melhor-envio/quote"

const profile: ShippingProfile = { product_id: "prod_test", variant_id: "variant_test", sku: "test", title: "test",
  base_weight_g: 560, weight_basis: "calculated_net", weight_margin_pct: 10,
  height_cm: 8, width_cm: 15, length_cm: 20, dimensions_basis: "estimated_package",
  sources: ["https://bunker81.com.br/"], notes: "Provisional packaging estimate" }
function fixture(profiles = [profile]) {
  const rows = new Map(profiles.map(p => [p.variant_id, { id: p.variant_id, product_id: p.product_id, sku: p.sku,
    weight: null, height: null, width: null, length: null, metadata: { existing: "preserve" } } as Variant]))
  const update = jest.fn(async (id, data) => { rows.set(id, { ...rows.get(id)!, ...data }); return rows.get(id) })
  const store: ProfileStore = { retrieve: async id => structuredClone(rows.get(id)!), update }
  return { rows, update, store }
}

describe("provisional catalog shipping import", () => {
  it("covers the 72 current variants with valid identities, sources, measures and 10% policy", () => {
    expect(shippingProfiles).toHaveLength(72)
    expect(() => validateProfiles(shippingProfiles)).not.toThrow()
    expect(profileMeasures(profile).weight).toBe(616)
    expect(profileMeasures({ ...profile, base_weight_g: 96, weight_basis: "gross", weight_margin_pct: 0 }).weight).toBe(96)
    expect(() => validateProfiles([{ ...profile, base_weight_g: NaN }])).toThrow()
    expect(() => validateProfiles([profile, profile])).toThrow()
    expect(() => validateProfiles([{ ...profile, weight_basis: "gross" }])).toThrow()
  })

  it("defaults to a read-only plan and checks every variant identity before writing", async () => {
    const second = { ...profile, variant_id: "variant_2", sku: "other" }
    const f = fixture([profile, second])
    expect((await planProfiles([profile], f.store))[0].status).toBe("fill_missing")
    expect(f.update).not.toHaveBeenCalled()
    f.rows.get(second.variant_id)!.product_id = "different_product"
    await expect(applyProfiles([profile, second], f.store)).rejects.toThrow(/identity changed/)
    expect(f.update).not.toHaveBeenCalled()
  })

  it("fills missing measures once, preserves unrelated metadata and can restore original nulls", async () => {
    const f = fixture()
    expect(await applyProfiles([profile], f.store)).toEqual({ applied: 1, preserved: 0 })
    expect(f.rows.get(profile.variant_id)).toMatchObject({ weight: 616, height: 8, width: 15, length: 20,
      metadata: { existing: "preserve", [SHIPPING_PROFILE_KEY]: { version: SHIPPING_PROFILE_VERSION, status: "provisional" } } })
    expect(await applyProfiles([profile], f.store)).toEqual({ applied: 0, preserved: 1 })
    expect(f.update).toHaveBeenCalledTimes(1)
    f.rows.get(profile.variant_id)!.metadata!.later_note = "keep"
    expect(await rollbackProfiles([profile], f.store)).toEqual({ restored: 1, conflicts: 0 })
    expect(f.rows.get(profile.variant_id)).toMatchObject({ weight: null, height: null, width: null, length: null,
      metadata: { existing: "preserve", later_note: "keep", [SHIPPING_PROFILE_KEY]: null } })
  })

  it("never replaces existing positive measurements and rolls back only fields it filled", async () => {
    const f = fixture()
    f.rows.get(profile.variant_id)!.weight = 700
    await applyProfiles([profile], f.store)
    expect(f.rows.get(profile.variant_id)!.weight).toBe(700)
    f.rows.get(profile.variant_id)!.weight = 750
    expect(await rollbackProfiles([profile], f.store)).toEqual({ restored: 1, conflicts: 0 })
    expect(f.rows.get(profile.variant_id)).toMatchObject({ weight: 750, height: null })
  })

  it("preserves supplier/store corrections made after the import", async () => {
    const f = fixture()
    await applyProfiles([profile], f.store)
    f.rows.get(profile.variant_id)!.weight = 650
    expect(await rollbackProfiles([profile], f.store)).toEqual({ restored: 0, conflicts: 1 })
    expect(f.rows.get(profile.variant_id)!.weight).toBe(650)
  })

  it("recovers a partially committed import without undoing a previous completed run", async () => {
    const prior = { ...profile, variant_id: "prior", sku: "prior" }
    const second = { ...profile, variant_id: "second", sku: "second" }
    const f = fixture([prior, profile, second])
    await applyProfiles([prior], f.store)
    const original = f.store.update
    let failed = false
    f.store.update = async (id, data) => {
      await original(id, data)
      if (id === second.variant_id && !failed) { failed = true; throw new Error("connection lost after commit") }
    }
    await expect(applyProfiles([prior, profile, second], f.store)).rejects.toThrow(/rollback restored=2/)
    expect(f.rows.get(prior.variant_id)!.weight).toBe(616)
    expect(f.rows.get(profile.variant_id)!.weight).toBeNull()
    expect(f.rows.get(second.variant_id)!.weight).toBeNull()
  })

  it("passes per-item weights, package measures and quantities to the existing quote path", () => {
    const m = profileMeasures(profile)
    const result = buildQuotePayload({ environment: "production", accessToken: "test-only", userAgent: "test@example.com",
      originPostalCode: "50610545", catalogWeightUnit: "g", catalogDimensionUnit: "cm", serviceIds: [1] }, {
      postalCode: "58010000", currencyCode: "brl", items: [{ id: "line", quantity: 3, unit_price: 49.9, variant: m }] })
    expect(result.source).toBe("products")
    expect(result.payload).toMatchObject({ products: [{ quantity: 3, weight: 0.616, height: 8, width: 15, length: 20 }] })
  })
})
