import { MedusaError } from "@medusajs/framework/utils"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { ensureOrderOwner } from "../middlewares/ensure-order-owner"

const requestFor = (orderCustomerId: string | null, actorId: string) => ({
  params: { id: "order_123" },
  auth_context: { actor_id: actorId },
  scope: {
    resolve: () => ({
      graph: async () => ({
        data: orderCustomerId
          ? [{ id: "order_123", customer_id: orderCustomerId }]
          : [],
      }),
    }),
  },
})

describe("customer order authorization", () => {
  test("requires customer authentication before ownership validation", () => {
    const middlewareSource = readFileSync(
      resolve(process.cwd(), "src/api/middlewares.ts"),
      "utf8"
    )
    expect(middlewareSource).toMatch(
      /matcher: "\/store\/orders\/:id"[\s\S]*authenticate\("customer", \["session", "bearer"\]\)[\s\S]*ensureOrderOwner/
    )
  })

  test("allows the authenticated owner", async () => {
    const next = jest.fn()
    await ensureOrderOwner(
      requestFor("cus_a", "cus_a") as never,
      {} as never,
      next
    )
    expect(next).toHaveBeenCalledWith()
  })

  test("rejects another customer", async () => {
    const next = jest.fn()
    await ensureOrderOwner(
      requestFor("cus_a", "cus_b") as never,
      {} as never,
      next
    )
    const error = next.mock.calls[0][0]
    expect(error).toBeInstanceOf(MedusaError)
    expect(error.message).toBe("You are not allowed to retrieve this order.")
  })

  test("does not disclose whether an unknown order exists", async () => {
    const next = jest.fn()
    await ensureOrderOwner(
      requestFor(null, "cus_a") as never,
      {} as never,
      next
    )
    expect(next.mock.calls[0][0]).toBeInstanceOf(MedusaError)
  })
})
