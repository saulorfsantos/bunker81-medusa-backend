import orderStatusEmail from "../order-status-email"

const order = {
  id: "order_1", display_id: 42, email: "cliente@example.com", total: 150, metadata: null,
  items: [{ title: "BB", quantity: 1, unit_price: 150, total: 150 }],
  shipping_address: { first_name: "Ana", last_name: "Silva" },
}
const fulfillment = {
  id: "ful_1", order: { id: "order_1" },
  labels: [{ tracking_number: "AA123BR", tracking_url: "https://www.melhorrastreio.com.br/rastreio/AA123BR" }],
}

function run(name: string, data: Record<string, unknown>, o: Record<string, unknown> = order) {
  const createNotifications = jest.fn().mockResolvedValue(undefined)
  const graph = async ({ entity }: { entity: string }) => ({ data: [entity === "order" ? o : fulfillment] })
  const container = { resolve: (key: string) => (key === "query" ? { graph } : { createNotifications }) }
  return orderStatusEmail({ event: { name, data }, container } as never).then(() => createNotifications)
}

describe("order status email", () => {
  const originalEnv = process.env
  beforeEach(() => {
    process.env = { ...originalEnv, STOREFRONT_URL: "https://bunker81.com.br", RESEND_API_KEY: "k",
      RESEND_FROM: "Bunker 81 <loja@bunker81.com.br>" }
  })
  afterAll(() => { process.env = originalEnv })

  test("separar o pedido avisa o cliente", async () => {
    const send = await run("order.fulfillment_created", { order_id: "order_1", fulfillment_id: "ful_1" })
    expect(send.mock.calls[0][0]).toMatchObject({
      to: "cliente@example.com", template: "order-fulfilled-customer", data: { display_id: 42, ref: "ful_1" },
    })
  })

  test("postar o pedido manda o rastreio", async () => {
    const send = await run("shipment.created", { id: "ful_1" })
    expect(send.mock.calls[0][0]).toMatchObject({
      template: "order-shipped-customer",
      data: { tracking_number: "AA123BR", tracking_url: "https://www.melhorrastreio.com.br/rastreio/AA123BR" },
    })
  })

  test("venda de balcão e no_notification não mandam e-mail", async () => {
    expect(await run("shipment.created", { id: "ful_1" }, { ...order, metadata: { origem: "PDV" } })).not.toHaveBeenCalled()
    expect(await run("shipment.created", { id: "ful_1", no_notification: true })).not.toHaveBeenCalled()
  })
})
