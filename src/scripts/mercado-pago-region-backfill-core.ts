export const MERCADO_PAGO_PROVIDER_IDS = [
  "pp_mercadopago-pix_mercadopago",
  "pp_mercadopago-card_mercadopago",
] as const

const REGION_PAGE_SIZE = 100

export type RegionSnapshot = {
  id: string
  name?: string | null
  currency_code?: string | null
  countries?: Array<{ iso_2?: string | null }> | null
  payment_providers?: Array<{ id?: string | null }> | null
}

export type RegionGraphQuery = {
  graph: (input: {
    entity: string
    fields: string[]
    filters: Record<string, unknown>
    pagination: {
      take: number
      skip: number
      order: Record<string, "ASC" | "DESC">
    }
  }) => Promise<{ data: RegionSnapshot[] }>
}

type BackfillDependencies = {
  query: RegionGraphQuery
  updateRegionProviders: (
    regionId: string,
    providerIds: string[]
  ) => Promise<void>
  logger?: { info: (message: string) => void }
}

const normalized = (value: string | null | undefined) =>
  value?.trim().toLowerCase()

export const selectBrazilRegion = (regions: RegionSnapshot[]) => {
  const candidates = regions.filter(
    (region) =>
      normalized(region.currency_code) === "brl" &&
      region.countries?.some((country) => normalized(country.iso_2) === "br")
  )

  if (candidates.length !== 1) {
    throw new Error(
      `Mercado Pago region backfill requires exactly one existing BRL region assigned to country BR; found ${candidates.length}. Refusing to create or update any region.`
    )
  }

  return candidates[0]
}

export const mergePaymentProviderIds = (region: RegionSnapshot) => {
  if (!Array.isArray(region.payment_providers)) {
    throw new Error(
      `Mercado Pago region backfill could not read existing payment providers for region ${region.id}; refusing to replace provider links.`
    )
  }

  const existingProviderIds = region.payment_providers.map((provider) => {
    if (typeof provider.id !== "string" || !provider.id.trim()) {
      throw new Error(
        `Mercado Pago region backfill found an invalid payment provider link for region ${region.id}; refusing to replace provider links.`
      )
    }
    return provider.id
  })

  return Array.from(
    new Set([...existingProviderIds, ...MERCADO_PAGO_PROVIDER_IDS])
  )
}

export const backfillMercadoPagoRegionProviders = async ({
  query,
  updateRegionProviders,
  logger,
}: BackfillDependencies) => {
  const regions: RegionSnapshot[] = []
  let skip = 0

  for (;;) {
    const { data } = await query.graph({
      entity: "region",
      fields: [
        "id",
        "name",
        "currency_code",
        "countries.iso_2",
        "payment_providers.id",
      ],
      filters: { currency_code: "brl" },
      pagination: {
        take: REGION_PAGE_SIZE,
        skip,
        order: { id: "ASC" },
      },
    })

    regions.push(...data)
    if (data.length < REGION_PAGE_SIZE) {
      break
    }
    skip += data.length
  }

  const region = selectBrazilRegion(regions)
  const providerIds = mergePaymentProviderIds(region)
  const existingProviderIds = new Set(
    region.payment_providers!.map((provider) => provider.id as string)
  )
  const missingProviderIds = MERCADO_PAGO_PROVIDER_IDS.filter(
    (providerId) => !existingProviderIds.has(providerId)
  )

  if (!missingProviderIds.length) {
    logger?.info(
      `Mercado Pago region backfill: region ${region.id} already has all required providers; no changes made.`
    )
    return { changed: false, regionId: region.id, providerIds }
  }

  await updateRegionProviders(region.id, providerIds)
  logger?.info(
    `Mercado Pago region backfill: added ${missingProviderIds.join(
      ", "
    )} to region ${region.id}; preserved ${existingProviderIds.size} existing provider link(s).`
  )

  return { changed: true, regionId: region.id, providerIds }
}
