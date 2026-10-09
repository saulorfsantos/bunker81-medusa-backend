import type { ProviderSendNotificationDTO } from "@medusajs/framework/types"
import ResendNotificationProviderService from "../service"
import { readResendConfig } from "../config"

const env = {
  NODE_ENV: "production",
  RESEND_API_KEY: "test-secret",
  RESEND_FROM: "Bunker 81 <loja@bunker81.com.br>",
  STOREFRONT_URL: "https://bunker81.com.br",
}
const options = readResendConfig(env)!
const notification = {
  to: "buyer@example.com",
  channel: "email",
  template: "customer-password-reset",
  data: { reset_url: "https://bunker81.com.br/reset-password?token=secret-token&email=buyer%40example.com" },
} as ProviderSendNotificationDTO

describe("Resend configuration", () => {
  test("does not activate an email provider just because a storefront URL exists", () => {
    expect(readResendConfig({ STOREFRONT_URL: env.STOREFRONT_URL })).toBeNull()
  })
  test.each(["RESEND_API_KEY", "RESEND_FROM", "STOREFRONT_URL"])("rejects partial configuration without %s", (key) => {
    expect(() => readResendConfig({ ...env, [key]: "" })).toThrow("requires")
  })
  test.each(["not-a-url", "http://bunker81.com.br", "https://user:pass@bunker81.com.br", "https://bunker81.com.br/path", "https://bunker81.com.br?redirect=evil", "https://bunker81.com.br/#fragment"])("rejects invalid production origins: %s", (url) => {
    expect(() => readResendConfig({ ...env, STOREFRONT_URL: url })).toThrow("STOREFRONT_URL")
  })
  test("uses the real mailbox for replies and supports a separate reply address", () => {
    expect(options.reply_to).toBe("loja@bunker81.com.br")
    expect(readResendConfig({ ...env, RESEND_REPLY_TO: "support@example.com" })?.reply_to).toBe("support@example.com")
  })
})

describe("Resend reset delivery", () => {
  const originalFetch = global.fetch
  const fetchMock = jest.fn()
  const service = new ResendNotificationProviderService({}, options)

  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ id: "email-id" }) })
    global.fetch = fetchMock
  })
  afterAll(() => { global.fetch = originalFetch })

  test("sends the reset to its owner, directs replies to Lark, and preserves the link", async () => {
    await expect(service.send(notification)).resolves.toEqual({ id: "email-id" })
    const [endpoint, request] = fetchMock.mock.calls[0]
    const body = JSON.parse(request.body)
    expect(endpoint).toBe("https://api.resend.com/emails")
    expect(body).toMatchObject({ from: env.RESEND_FROM, to: [notification.to], reply_to: "loja@bunker81.com.br" })
    expect(body.html).toContain("&amp;email=buyer%40example.com")
    expect(body.text).toContain(notification.data!.reset_url)
    expect(body).not.toHaveProperty("cc")
    expect(body).not.toHaveProperty("bcc")
    expect(request.redirect).toBe("error")
    expect(request.signal).toBeInstanceOf(AbortSignal)
  })

  test("deduplicates a retry while allowing a newly issued reset", async () => {
    await service.send(notification)
    await service.send(notification)
    await service.send({ ...notification, data: { reset_url: String(notification.data!.reset_url).replace("secret-token", "new-token") } })
    const keys = fetchMock.mock.calls.map(([, request]) => request.headers["Idempotency-Key"])
    expect(keys[0]).toBe(keys[1])
    expect(keys[2]).not.toBe(keys[0])
    expect(keys[0]).not.toContain("secret-token")
  })

  test.each([
    "https://attacker.example/reset-password?token=secret-token&email=buyer%40example.com",
    "https://bunker81.com.br/reset-password?token=secret-token&email=other%40example.com",
    "https://bunker81.com.br/reset-password?email=buyer%40example.com",
    "https://bunker81.com.br/other?token=secret-token&email=buyer%40example.com",
  ])("never sends a reset with an untrusted destination or mismatched recipient", async (reset_url) => {
    await expect(service.send({ ...notification, data: { reset_url } })).rejects.toThrow("Invalid customer reset URL")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("rejects an unsupported template without sending", async () => {
    await expect(service.send({ ...notification, template: "other" })).rejects.toThrow("Unsupported")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("does not claim success or expose the provider response when delivery fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ message: "test-secret secret-token" }) })
    await expect(service.send(notification)).rejects.toThrow("Resend password reset delivery failed (HTTP 403)")
  })
  test("sanitizes transport errors", async () => {
    fetchMock.mockRejectedValue(new Error("test-secret secret-token"))
    await expect(service.send(notification)).rejects.toThrow("Resend password reset delivery failed: network error or timeout")
  })
  test("rejects success responses without a message ID", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
    await expect(service.send(notification)).rejects.toThrow("no message ID")
  })
})
