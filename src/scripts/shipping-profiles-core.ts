export const SHIPPING_PROFILE_VERSION = "bunker-93-20261012"
export const SHIPPING_PROFILE_KEY = "bunker_shipping_estimate"
export const MEASURE_KEYS = ["weight", "height", "width", "length"] as const
type MeasureKey = typeof MEASURE_KEYS[number]
export type Measures = Record<MeasureKey, number | null>
export type ShippingProfile = {
  product_id: string
  variant_id: string
  sku: string
  title: string
  base_weight_g: number
  weight_basis: "net" | "gross" | "estimate" | "calculated_net"
  weight_margin_pct: 0 | 10
  height_cm: number
  width_cm: number
  length_cm: number
  dimensions_basis: "supplier_package" | "estimated_package"
  sources: string[]
  notes: string
}
export type Variant = Measures & {
  id: string
  product_id: string
  sku?: string | null
  metadata?: Record<string, unknown> | null
}
export type VariantUpdate = Partial<Measures> & { metadata: Record<string, unknown> }
export type ProfileStore = {
  retrieve(id: string): Promise<Variant>
  update(id: string, data: VariantUpdate): Promise<unknown>
}
type Marker = {
  version: string
  status: "provisional"
  previous: Measures
  applied: Measures
  written_fields: MeasureKey[]
  profile: ShippingProfile
}

const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0
const measures = (v: Measures): Measures => Object.fromEntries(MEASURE_KEYS.map(k => [k, v[k] ?? null])) as Measures

export function profileMeasures(profile: ShippingProfile): Measures {
  return {
    weight: Math.ceil(profile.base_weight_g * (100 + profile.weight_margin_pct) / 100 - 1e-9),
    height: profile.height_cm, width: profile.width_cm, length: profile.length_cm,
  }
}

export function validateProfiles(profiles: ShippingProfile[]) {
  const seen = new Set<string>()
  for (const p of profiles) {
    if (!p.variant_id || !p.product_id || !p.sku.trim() || seen.has(p.variant_id)) throw new Error("Invalid or duplicate shipping profile identity")
    seen.add(p.variant_id)
    if (!["net", "gross", "estimate", "calculated_net"].includes(p.weight_basis) ||
      !["supplier_package", "estimated_package"].includes(p.dimensions_basis) ||
      p.weight_margin_pct !== (p.weight_basis === "gross" ? 0 : 10)) throw new Error(`Invalid weight/dimension policy: ${p.sku}`)
    const m = profileMeasures(p)
    if (!positive(p.base_weight_g) || !MEASURE_KEYS.every(k => positive(m[k])) ||
      m.weight! > 30000 || Math.max(m.height!, m.width!, m.length!) > 200) throw new Error(`Invalid shipping measures: ${p.sku}`)
    if (!p.notes || !p.sources.length || p.sources.some(s => !/^https:\/\//.test(s))) throw new Error(`Missing provenance: ${p.sku}`)
  }
}

export async function planProfiles(profiles: ShippingProfile[], store: ProfileStore) {
  validateProfiles(profiles)
  const plan: Array<{ profile: ShippingProfile; variant: Variant; after: Measures; written: MeasureKey[]; status: string }> = []
  // Validate all identities before the first write. Never match by a similar title or create products.
  for (const profile of profiles) {
    const variant = await store.retrieve(profile.variant_id)
    if (variant.id !== profile.variant_id || variant.product_id !== profile.product_id || variant.sku?.trim() !== profile.sku.trim()) {
      throw new Error(`Catalog identity changed for ${profile.sku}; no profiles applied`)
    }
    const candidate = profileMeasures(profile)
    const written = MEASURE_KEYS.filter(k => !positive(variant[k]))
    const after = Object.fromEntries(MEASURE_KEYS.map(k => [k, positive(variant[k]) ? variant[k] : candidate[k]])) as Measures
    const marker = variant.metadata?.[SHIPPING_PROFILE_KEY]
    plan.push({ profile, variant, after, written,
      status: marker ? "already_marked" : written.length ? "fill_missing" : "preserve_existing" })
  }
  return plan
}

export async function applyProfiles(profiles: ShippingProfile[], store: ProfileStore) {
  const plan = await planProfiles(profiles, store)
  const applied: string[] = []
  try {
    for (const item of plan) {
      if (item.status !== "fill_missing") continue
      const current = await store.retrieve(item.variant.id)
      // Do not overwrite a measurement edited after the preflight.
      if (MEASURE_KEYS.some(k => (current[k] ?? null) !== (item.variant[k] ?? null)) || current.metadata?.[SHIPPING_PROFILE_KEY]) {
        throw new Error(`Catalog measures changed during import: ${item.profile.sku}`)
      }
      const marker: Marker = { version: SHIPPING_PROFILE_VERSION, status: "provisional", previous: measures(current),
        applied: item.after, written_fields: item.written, profile: item.profile }
      await store.update(item.variant.id, { ...Object.fromEntries(item.written.map(k => [k, item.after[k]])),
        metadata: { ...current.metadata, [SHIPPING_PROFILE_KEY]: marker } })
      applied.push(item.variant.id)
    }
  } catch (error) {
    // A failed write may have committed remotely. Inspect every planned record, not only acknowledged writes.
    const recovery = await rollbackProfiles(plan.filter(item => item.status === "fill_missing").map(item => item.profile), store)
    throw new Error(`Shipping import failed; rollback restored=${recovery.restored}, conflicts=${recovery.conflicts}: ${String(error)}`)
  }
  return { applied: applied.length, preserved: plan.length - applied.length }
}

export async function rollbackProfiles(profiles: ShippingProfile[], store: ProfileStore) {
  validateProfiles(profiles)
  let restored = 0, conflicts = 0
  for (const profile of profiles) {
    const variant = await store.retrieve(profile.variant_id)
    if (variant.product_id !== profile.product_id || variant.sku?.trim() !== profile.sku.trim()) { conflicts++; continue }
    const marker = variant.metadata?.[SHIPPING_PROFILE_KEY] as Marker | null | undefined
    if (!marker || marker.version !== SHIPPING_PROFILE_VERSION) continue
    if (!Array.isArray(marker.written_fields) || !marker.previous || !marker.applied ||
      marker.written_fields.some(k => !MEASURE_KEYS.includes(k) || variant[k] !== marker.applied[k])) { conflicts++; continue }
    await store.update(variant.id, { ...Object.fromEntries(marker.written_fields.map(k => [k, marker.previous[k]])),
      metadata: { ...variant.metadata, [SHIPPING_PROFILE_KEY]: null } })
    restored++
  }
  return { restored, conflicts }
}
