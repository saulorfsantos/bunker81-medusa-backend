import type { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateRegionsWorkflow } from "@medusajs/medusa/core-flows"
import {
  backfillMercadoPagoRegionProviders,
  type RegionGraphQuery,
} from "./mercado-pago-region-backfill-core"

export default async function mercadoPagoRegionBackfill({
  container,
}: {
  container: MedusaContainer
}) {
  const query = container.resolve(
    ContainerRegistrationKeys.QUERY
  ) as RegionGraphQuery
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  return backfillMercadoPagoRegionProviders({
    query,
    logger,
    updateRegionProviders: async (regionId, providerIds) => {
      await updateRegionsWorkflow(container).run({
        input: {
          selector: { id: regionId },
          update: { payment_providers: providerIds },
        },
      })
    },
  })
}
