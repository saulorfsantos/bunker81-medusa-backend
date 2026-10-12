import type { MedusaContainer } from "@medusajs/framework"
import type { IProductModuleService } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { applyProfiles, planProfiles, rollbackProfiles, type ProfileStore, type Variant } from "./shipping-profiles-core"
import { shippingProfiles } from "./data/shipping-profiles-20261012"

export default async function shippingProfilesCommand({ container }: { container: MedusaContainer }) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const productService = container.resolve<IProductModuleService>(Modules.PRODUCT)
  const mode = process.env.BUNKER_SHIPPING_MODE || "preview"
  if (!["preview", "apply", "rollback"].includes(mode)) throw new Error("BUNKER_SHIPPING_MODE must be preview, apply or rollback")
  if (mode !== "rollback" && (process.env.MELHOR_ENVIO_CATALOG_WEIGHT_UNIT !== "g" || process.env.MELHOR_ENVIO_CATALOG_DIMENSION_UNIT !== "cm")) {
    throw new Error("These profiles use grams and cm: configure MELHOR_ENVIO_CATALOG_WEIGHT_UNIT=g and MELHOR_ENVIO_CATALOG_DIMENSION_UNIT=cm")
  }
  const store: ProfileStore = {
    retrieve: async id => await productService.retrieveProductVariant(id, {
      select: ["id", "product_id", "sku", "weight", "height", "width", "length", "metadata"],
    }) as Variant,
    update: (id, data) => productService.updateProductVariants(id, data),
  }
  if (mode === "preview") {
    const plan = await planProfiles(shippingProfiles, store)
    for (const item of plan) logger.info(`${item.profile.sku}: ${item.status}, weight_g=${item.after.weight}, H/W/L_cm=${item.after.height}/${item.after.width}/${item.after.length}`)
    logger.info(`SHIPPING_PREVIEW profiles=${plan.length} fill_missing=${plan.filter(i => i.status === "fill_missing").length}. No writes.`)
  } else if (mode === "apply") {
    const result = await applyProfiles(shippingProfiles, store)
    logger.info(`SHIPPING_APPLIED ${JSON.stringify(result)}. Provisional profiles; validate freight before checkout release.`)
  } else {
    const result = await rollbackProfiles(shippingProfiles, store)
    logger.info(`SHIPPING_ROLLBACK ${JSON.stringify(result)}`)
    if (result.conflicts) throw new Error("Rollback preserved later manual changes; inspect catalog conflicts")
  }
}
