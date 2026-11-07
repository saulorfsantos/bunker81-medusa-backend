import orderPlacedEmail from "../order-placed-email"

const order = {
  id: "order_1", display_id: 42, email: "cliente@example.com", total: 150, metadata: null,
  items: [{ title: "Pistola <BB>", quantity: 2, unit_price: 75, total: 150 }],
  shipping_address: { first_name: "Ana", last_name: "Silva" },
}

function run(o: Record<string, unknown>) {
  const createNotifications = jest.fn().mockResolvedValue(undefined)
  const container = {
    resolve: (key: string) => key === "query"
      ? { graph: async () => ({ data: [o] }) }
      : key === "logger" ? { warn: jest.fn() } : { createNotifications },
  }
  return orderPlacedEmail({ event: { name: "order.placed", data: { id: o.id } }, container } as never)
    .then(() => createNotifications)
}

describe("order placed email", () => {
  const originalEnv = process.env
  beforeEach(() => {
    process.env = { ...originalEnv, STOREFRONT_URL: "https://bunker81.com.br", RESEND_API_KEY: "k",
      RESEND_FROM: "Bunker 81 <loja@bunker81.com.br>", ORDER_NOTIFY_EMAIL: "dono@example.com" }
  })
  afterAll(() => { process.env = originalEnv })

  test("online order emails the buyer and the shop", async () => {
    const send = await run(order)
    const sent = send.mock.calls[0][0]
    expect(sent.map((n: { to: string; template: string }) => [n.to, n.template])).toEqual([
      ["cliente@example.com", "order-placed-customer"],
      ["dono@example.com", "order-placed-admin"],
    ])
    expect(sent[0].data).toMatchObject({ display_id: 42, customer_name: "Ana Silva", total: 150 })
  })

  test("PDV sale with placeholder email sends nothing", async () => {
    const send = await run({ ...order, email: "pdv-123@bunker81.com.br", metadata: { origem: "PDV" } })
    expect(send).not.toHaveBeenCalled()
  })

  test("PDV sale with real email only confirms to the buyer", async () => {
    const send = await run({ ...order, metadata: { origem: "PDV" } })
    expect(send.mock.calls[0][0].map((n: { template: string }) => n.template)).toEqual(["order-placed-customer"])
  })

  test("skips quietly when Resend is not configured", async () => {
    delete process.env.RESEND_API_KEY; delete process.env.RESEND_FROM
    expect(await run(order)).not.toHaveBeenCalled()
  })
})
