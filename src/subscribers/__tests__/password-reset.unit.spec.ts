import passwordResetHandler, { buildCustomerResetUrl } from "../password-reset"

describe("customer password reset notification", () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      STOREFRONT_URL: "https://loja.example.com",
      SENDGRID_PASSWORD_RESET_TEMPLATE: "d-template",
    }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  test("encodes the token and email in the storefront URL", () => {
    expect(
      buildCustomerResetUrl(
        "https://loja.example.com",
        "token+with/special=chars",
        "cliente+teste@example.com"
      )
    ).toBe(
      "https://loja.example.com/reset-password?token=token%2Bwith%2Fspecial%3Dchars&email=cliente%2Bteste%40example.com"
    )
  })

  test("sends the customer reset through the configured email provider", async () => {
    const createNotifications = jest.fn().mockResolvedValue(undefined)
    await passwordResetHandler({
      event: {
        name: "auth.password_reset",
        data: {
          entity_id: "cliente@example.com",
          token: "reset-token",
          actor_type: "customer",
        },
      },
      container: { resolve: () => ({ createNotifications }) },
    } as never)

    expect(createNotifications).toHaveBeenCalledWith({
      to: "cliente@example.com",
      channel: "email",
      template: "d-template",
      data: {
        email: "cliente@example.com",
        reset_url:
          "https://loja.example.com/reset-password?token=reset-token&email=cliente%40example.com",
      },
    })
  })

  test("fails closed when real email configuration is absent", async () => {
    delete process.env.SENDGRID_PASSWORD_RESET_TEMPLATE
    await expect(
      passwordResetHandler({
        event: {
          name: "auth.password_reset",
          data: {
            entity_id: "cliente@example.com",
            token: "reset-token",
            actor_type: "customer",
          },
        },
        container: { resolve: jest.fn() },
      } as never)
    ).rejects.toThrow("SENDGRID_PASSWORD_RESET_TEMPLATE")
  })
})
