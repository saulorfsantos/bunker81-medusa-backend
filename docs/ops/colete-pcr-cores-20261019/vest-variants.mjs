// Colete Modular PCR Rossi: one product, four colours (Saulo, 19/10/2026).
// Usage: node vest-variants.mjs <env-file> preview|apply|rollback
//   preview  GET only: prints current state, orders that use the product and the plan.
//   apply    idempotent writes; every created id goes to apply-log.json for rollback.
//   rollback undoes what apply-log.json records (deletes only what apply created).
// Nothing existing is deleted: the current variant (SKU 26201022, Multicam per Rossi)
// keeps its id; its option and value are renamed in place.
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const LOG = join(HERE, "apply-log.json")
const SNAPSHOT = join(HERE, "before-snapshot.json")

const PRODUCT_ID = "prod_01M3Z407FZ3TB8M68M9A5TG32P"
const EXISTING_VARIANT_ID = "variant_01M3Z407HT178T24J0F6EEMGX8"
const OPTION_TITLE = "Cor"
// Rossi codes (rossi.com.br/pt-br/produtos/43497..43500). Image ids = this product's photos.
const COLOURS = [
  // p9hft is the side-by-side Multicam + Preto photo: second picture of those two only.
  { value: "Multicam", sku: "26201022", image: "img_01M3Z407G1AW3JV3KW7M5DGVGX", extra: ["p9hft"], existing: true },
  { value: "Verde Militar", sku: "26201021", image: "w3g8y7" },
  { value: "Preto", sku: "26201023", image: "vurod", extra: ["p9hft"] },
  { value: "Cáqui", sku: "26201024", image: "5t0z1l" },
]
const PRICE = { currency_code: "brl", amount: 614 }

const [envFile, mode = "preview"] = process.argv.slice(2)
if (!envFile || !["preview", "apply", "rollback"].includes(mode)) {
  console.error("usage: node vest-variants.mjs <env-file> preview|apply|rollback")
  process.exit(2)
}
const env = Object.fromEntries(
  readFileSync(envFile, "utf8")
    .split("\n")
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]),
)
const BASE = env.MEDUSA_BACKEND_URL
const AUTH = "Basic " + Buffer.from(`${env.MEDUSA_ADMIN_API_KEY}:`).toString("base64")

async function api(method, path, body) {
  if (mode === "preview" && method !== "GET") throw new Error(`preview tried ${method} ${path}`)
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: AUTH, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 400)}`)
  if (method !== "GET") console.log(`  ${method} ${path} -> ${res.status}`)
  return text ? JSON.parse(text) : {}
}

const PRODUCT_FIELDS =
  "id,title,handle,status,*options,*options.values,*variants,*variants.options,*variants.prices,*variants.images,*variants.inventory_items,*images,*images.variants,*sales_channels"

async function loadProduct() {
  const { product } = await api("GET", `/admin/products/${PRODUCT_ID}?fields=${encodeURIComponent(PRODUCT_FIELDS)}`)
  return product
}

function describe(product) {
  console.log(`${product.title} (${product.status})`)
  for (const option of product.options)
    console.log(`  option ${option.id} "${option.title}" exclusive=${option.is_exclusive} values=${option.values.map((v) => `${v.value}[${v.id}]`).join(", ")}`)
  for (const variant of product.variants)
    console.log(
      `  variant ${variant.id} sku=${variant.sku} "${variant.title}" opts=${variant.options.map((o) => o.value).join("/")} ` +
        `price=${variant.prices.map((p) => `${p.amount} ${p.currency_code}`).join(",")} inv=${variant.inventory_items.length} own_imgs=${product.images.filter((i) => (i.variants ?? []).some((v) => v.id === variant.id)).map((i) => i.id).join(",") || "-"} thumb=${variant.thumbnail ? "yes" : "no"}`,
    )
}

async function ordersUsingProduct() {
  const hits = []
  for (let offset = 0; ; offset += 100) {
    const page = await api("GET", `/admin/orders?limit=100&offset=${offset}&fields=id,display_id,status,*items`)
    for (const order of page.orders)
      for (const item of order.items ?? [])
        if (item.product_id === PRODUCT_ID || item.variant_id === EXISTING_VARIANT_ID)
          hits.push(`#${order.display_id} ${order.status} variant=${item.variant_id}`)
    if (offset + 100 >= page.count) return { total: page.count, hits }
  }
}

async function mainLocation(product) {
  const { stock_locations } = await api("GET", "/admin/stock-locations?fields=id,name,*sales_channels&limit=50")
  const channelIds = new Set(product.sales_channels.map((c) => c.id))
  const served = stock_locations.filter((l) => (l.sales_channels ?? []).some((c) => channelIds.has(c.id)))
  return { all: stock_locations, served }
}

function readLog() {
  return existsSync(LOG) ? JSON.parse(readFileSync(LOG, "utf8")) : { created: {}, renamed: {} }
}
function saveLog(log) {
  writeFileSync(LOG, JSON.stringify(log, null, 2))
}

async function preview() {
  const product = await loadProduct()
  describe(product)
  const images = new Set(product.images.map((i) => i.id))
  for (const c of COLOURS) if (!images.has(c.image)) throw new Error(`image ${c.image} (${c.value}) not on product`)
  const skuTaken = await api("GET", `/admin/product-variants?sku=${COLOURS.filter((c) => !c.existing).map((c) => c.sku).join("&sku=")}&fields=id,sku,product_id`)
  console.log(`\nSKUs to create already in use elsewhere: ${skuTaken.variants.map((v) => `${v.sku}@${v.product_id}`).join(", ") || "none"}`)
  const orders = await ordersUsingProduct()
  console.log(`orders scanned: ${orders.total}; using this product: ${orders.hits.join("; ") || "none"}`)
  const locations = await mainLocation(product)
  console.log(`stock locations: ${locations.all.map((l) => `${l.name}[${l.id}]`).join(", ")}; serving this channel: ${locations.served.map((l) => l.name).join(", ") || "NONE"}`)
  if (!existsSync(SNAPSHOT)) writeFileSync(SNAPSHOT, JSON.stringify(product, null, 2))
  console.log(`\nPLAN
  1. rename option "${product.options[0]?.title}" -> "${OPTION_TITLE}", value "${product.options[0]?.values[0]?.value}" -> "Multicam"
  2. add values ${COLOURS.filter((c) => !c.existing).map((c) => c.value).join(", ")}
  3. variant ${EXISTING_VARIANT_ID} title -> "Multicam" (+ inventory item 26201022, stock 0)
  4. create variants ${COLOURS.filter((c) => !c.existing).map((c) => `${c.value}=${c.sku}`).join(", ")} at R$ ${PRICE.amount}, same weight/dimensions, stock 0
  5. attach each colour's photo to its variant and use it as the variant thumbnail
  snapshot: ${SNAPSHOT}`)
}

async function apply() {
  const log = readLog()
  let product = await loadProduct()
  if (product.options.length !== 1) throw new Error("expected exactly one option; stop and inspect")
  const option = product.options[0]
  if (!option.is_exclusive) throw new Error("option is shared with other products; renaming would affect them")
  const existing = product.variants.find((v) => v.id === EXISTING_VARIANT_ID)
  if (!existing || existing.sku !== "26201022") throw new Error("existing variant changed; stop and inspect")

  console.log("1. option and value")
  const firstValue = existing.options[0]
  if (firstValue.value !== "Multicam") {
    log.renamed.value = { option_id: option.id, value_id: firstValue.id, from: firstValue.value }
    saveLog(log)
    await api("POST", `/admin/product-options/${option.id}/values/${firstValue.id}`, { value: "Multicam" })
  }
  if (option.title !== OPTION_TITLE) {
    log.renamed.option = { option_id: option.id, from: option.title }
    saveLog(log)
    await api("POST", `/admin/product-options/${option.id}`, { title: OPTION_TITLE })
  }

  console.log("2. values")
  product = await loadProduct()
  const have = new Set(product.options[0].values.map((v) => v.value))
  const missingValues = COLOURS.map((c) => c.value).filter((v) => !have.has(v))
  if (missingValues.length) {
    // Values are matched by text, so "Multicam" keeps its id; ranks set the shop order.
    const { product_option } = await api("POST", `/admin/product-options/${option.id}?fields=id,*values`, {
      values: COLOURS.map((c) => c.value),
      ranks: Object.fromEntries(COLOURS.map((c, rank) => [c.value, rank])),
    })
    log.created.values = product_option.values.filter((v) => missingValues.includes(v.value)).map((v) => v.id)
    saveLog(log)
    product = await loadProduct()
    const linked = new Set(product.options[0].values.map((v) => v.id))
    const unlinked = log.created.values.filter((id) => !linked.has(id))
    if (unlinked.length)
      await api("POST", `/admin/products/${PRODUCT_ID}/options/batch`, {
        update: [{ product_option_id: option.id, add: unlinked }],
      })
  }

  console.log("3. existing variant")
  if (existing.title !== "Multicam") {
    log.renamed.variant = { variant_id: existing.id, from: existing.title }
    saveLog(log)
    await api("POST", `/admin/products/${PRODUCT_ID}/variants/${existing.id}`, { title: "Multicam" })
  }
  if (existing.inventory_items.length === 0) {
    const { inventory_item } = await api("POST", "/admin/inventory-items", {
      sku: existing.sku,
      title: `${product.title} - Multicam`,
      requires_shipping: true,
      weight: existing.weight,
      length: existing.length,
      height: existing.height,
      width: existing.width,
    })
    log.created.existingInventoryItem = inventory_item.id
    saveLog(log)
    await api("POST", `/admin/products/${PRODUCT_ID}/variants/${existing.id}/inventory-items`, {
      inventory_item_id: inventory_item.id,
      required_quantity: 1,
    })
  }

  console.log("4. new variants")
  product = await loadProduct()
  log.created.variants ??= []
  for (const [rank, colour] of COLOURS.entries()) {
    if (colour.existing || product.variants.some((v) => v.sku === colour.sku)) continue
    const { product: after } = await api("POST", `/admin/products/${PRODUCT_ID}/variants?fields=id,*variants`, {
      title: colour.value,
      sku: colour.sku,
      manage_inventory: true,
      allow_backorder: false,
      variant_rank: rank,
      weight: existing.weight,
      length: existing.length,
      height: existing.height,
      width: existing.width,
      metadata: existing.metadata ?? undefined,
      prices: [PRICE],
      options: { [OPTION_TITLE]: colour.value },
    })
    const created = after.variants.find((v) => v.sku === colour.sku)
    log.created.variants.push(created.id)
    saveLog(log)
  }

  console.log("5. photos and stock levels")
  product = await loadProduct()
  const { served } = await mainLocation(product)
  for (const colour of COLOURS) {
    const variant = product.variants.find((v) => v.sku === colour.sku)
    // variant.images falls back to every product photo when none is attached, so
    // check the explicit image → variant link instead.
    const image = product.images.find((i) => i.id === colour.image)
    if (!(image.variants ?? []).some((v) => v.id === variant.id))
      await api("POST", `/admin/products/${PRODUCT_ID}/variants/${variant.id}/images/batch`, { add: [colour.image] })
    for (const extraId of colour.extra ?? []) {
      const extra = product.images.find((i) => i.id === extraId)
      if (!(extra.variants ?? []).some((v) => v.id === variant.id))
        await api("POST", `/admin/products/${PRODUCT_ID}/variants/${variant.id}/images/batch`, { add: [extraId] })
    }
    const url = image.url
    if (variant.thumbnail !== url) await api("POST", `/admin/products/${PRODUCT_ID}/variants/${variant.id}`, { thumbnail: url })
    if (served.length === 1) {
      const itemId = variant.inventory_items[0]?.inventory_item_id
      const { inventory_item } = await api("GET", `/admin/inventory-items/${itemId}?fields=id,*location_levels`)
      if (!(inventory_item.location_levels ?? []).some((l) => l.location_id === served[0].id))
        await api("POST", `/admin/inventory-items/${itemId}/location-levels`, { location_id: served[0].id, stocked_quantity: 0 })
    }
  }
  if (served.length !== 1) console.log(`  stock levels skipped: ${served.length} locations serve the channel`)

  describe(await loadProduct())
  console.log(`APPLIED. log: ${LOG}`)
}

async function rollback() {
  const log = readLog()
  for (const id of log.created.variants ?? []) await api("DELETE", `/admin/products/${PRODUCT_ID}/variants/${id}`)
  if (log.created.existingInventoryItem) {
    await api("DELETE", `/admin/products/${PRODUCT_ID}/variants/${EXISTING_VARIANT_ID}/inventory-items/${log.created.existingInventoryItem}`)
    await api("DELETE", `/admin/inventory-items/${log.created.existingInventoryItem}`)
  }
  for (const id of log.created.values ?? []) await api("DELETE", `/admin/product-options/${log.renamed.option?.option_id ?? ""}/values/${id}`)
  if (log.renamed.variant) await api("POST", `/admin/products/${PRODUCT_ID}/variants/${EXISTING_VARIANT_ID}`, { title: log.renamed.variant.from, thumbnail: null })
  if (log.renamed.option) await api("POST", `/admin/product-options/${log.renamed.option.option_id}`, { title: log.renamed.option.from })
  if (log.renamed.value) await api("POST", `/admin/product-options/${log.renamed.value.option_id}/values/${log.renamed.value.value_id}`, { value: log.renamed.value.from })
  await api("POST", `/admin/products/${PRODUCT_ID}/variants/${EXISTING_VARIANT_ID}/images/batch`, { remove: [COLOURS[0].image, ...COLOURS[0].extra] }).catch((e) => console.log("  ", e.message))
  describe(await loadProduct())
  console.log("ROLLED BACK")
}

await { preview, apply, rollback }[mode]()
