import {
  backfillMercadoPagoRegionProviders,
  MERCADO_PAGO_PROVIDER_IDS,
  type RegionSnapshot,
} from "../mercado-pago-region-backfill-core"

const systemProvider = { id: "pp_system_default" }

const brazilRegion = (
  paymentProviders: Array<{ id: string }> = [systemProvider],
  id = "reg_brazil"
): RegionSnapshot => ({
  id,
  name: "Brazil",
  currency_code: "brl",
  countries: [{ iso_2: "br" }],
  payment_providers: paymentProviders,
})

const createHarness = (initialRegions: RegionSnapshot[]) => {
  let regions = initialRegions
  const query = {
    graph: jest.fn().mockImplementation(async () => ({ data: regions })),
  }
  const updateRegionProviders = jest
    .fn()
    .mockImplementation(async (regionId: string, providerIds: string[]) => {
      regions = regions.map((region) =>
        region.id === regionId
          ? {
              ...region,
              payment_providers: providerIds.map((id) => ({ id })),
            }
          : region
      )
    })

  return { query, updateRegionProviders }
}

describe("Mercado Pago existing-region provider backfill", () => {
  test("adds Pix and card while preserving system_default", async () => {
    const harness = createHarness([brazilRegion()])

    const result = await backfillMercadoPagoRegionProviders(harness)

    expect(result).toEqual({
      changed: true,
      regionId: "reg_brazil",
      providerIds: ["pp_system_default", ...MERCADO_PAGO_PROVIDER_IDS],
    })
    expect(harness.updateRegionProviders).toHaveBeenCalledWith(
      "reg_brazil",
      ["pp_system_default", ...MERCADO_PAGO_PROVIDER_IDS]
    )
  })

  test("is a no-op on a second execution", async () => {
    const harness = createHarness([brazilRegion()])

    await backfillMercadoPagoRegionProviders(harness)
    const second = await backfillMercadoPagoRegionProviders(harness)

    expect(second.changed).toBe(false)
    expect(harness.updateRegionProviders).toHaveBeenCalledTimes(1)
  })

  test("preserves unrelated providers already linked to the region", async () => {
    const harness = createHarness([
      brazilRegion([systemProvider, { id: "pp_existing_existing" }]),
    ])

    const result = await backfillMercadoPagoRegionProviders(harness)

    expect(result.providerIds).toEqual([
      "pp_system_default",
      "pp_existing_existing",
      ...MERCADO_PAGO_PROVIDER_IDS,
    ])
  })

  test.each([
    ["absent", []],
    ["ambiguous", [brazilRegion(), brazilRegion([], "reg_brazil_2")]],
  ])("fails safely when the target region is %s", async (_label, regions) => {
    const harness = createHarness(regions as RegionSnapshot[])

    await expect(
      backfillMercadoPagoRegionProviders(harness)
    ).rejects.toThrow("requires exactly one existing BRL region")
    expect(harness.updateRegionProviders).not.toHaveBeenCalled()
  })

  test("does not select a BRL region that is not assigned to Brazil", async () => {
    const harness = createHarness([
      {
        ...brazilRegion(),
        countries: [{ iso_2: "ar" }],
      },
    ])

    await expect(
      backfillMercadoPagoRegionProviders(harness)
    ).rejects.toThrow("found 0")
    expect(harness.updateRegionProviders).not.toHaveBeenCalled()
  })
})
