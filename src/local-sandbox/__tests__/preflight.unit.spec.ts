import {
  assertCard140SandboxEnv,
  isLoopbackHost,
} from "../preflight"

const validEnv = (): NodeJS.ProcessEnv => ({
  CARD140_LOCAL_SANDBOX: "true",
  CARD140_POSTGRES_PORT: "5540",
  CARD140_REDIS_PORT: "6440",
  NODE_ENV: "development",
  DATABASE_URL: "postgres://medusa_card140:medusa_card140@127.0.0.1:5540/medusa_card140",
  REDIS_URL: "redis://127.0.0.1:6440",
  MEDUSA_BACKEND_URL: "http://127.0.0.1:9000",
  MEDUSA_ADMIN_BACKEND_URL: "http://localhost:9000",
  STORE_CORS: "http://127.0.0.1:8000",
  ADMIN_CORS: "http://127.0.0.1:5173,http://localhost:9000",
  AUTH_CORS: "http://127.0.0.1:5173,http://localhost:9000",
  FILE_PROVIDER: "local",
  LOCAL_FILE_UPLOAD_DIR: "static/card140",
  LOCAL_FILE_BACKEND_URL: "http://127.0.0.1:9000/static/card140",
  MERCADO_PAGO_LIVE_MODE: "false",
  MERCADO_PAGO_WEBHOOK_BASE_URL: "http://127.0.0.1:9000",
})

describe("Card 140 local sandbox preflight", () => {
  test.each(["localhost", "127.0.0.1", "127.8.9.10", "::1"])(
    "accepts explicit loopback host %s",
    (host) => expect(isLoopbackHost(host)).toBe(true)
  )

  test.each(["db", "0.0.0.0", "192.168.1.10", "example.com", ""])(
    "rejects non-loopback or unknown host %s",
    (host) => expect(isLoopbackHost(host)).toBe(false)
  )

  it("accepts the exact local disposable topology", () => {
    expect(assertCard140SandboxEnv(validEnv()).databaseUrl.pathname).toBe("/medusa_card140")
  })

  it.each([
    ["missing sandbox marker", { CARD140_LOCAL_SANDBOX: undefined }],
    ["production NODE_ENV", { NODE_ENV: "production" }],
    ["unknown NODE_ENV", { NODE_ENV: undefined }],
    ["remote database", { DATABASE_URL: "postgres://medusa_card140:medusa_card140@db.example.com:5540/medusa_card140" }],
    ["wrong database", { DATABASE_URL: "postgres://medusa_card140:medusa_card140@127.0.0.1:5540/production" }],
    ["remote Redis", { REDIS_URL: "redis://redis.example.com:6440" }],
    ["live Mercado Pago", { MERCADO_PAGO_LIVE_MODE: "true" }],
    ["unknown live mode", { MERCADO_PAGO_LIVE_MODE: undefined }],
    ["Mercado Pago token", { MERCADO_PAGO_ACCESS_TOKEN: "TEST-should-not-exist" }],
    ["S3 target", { S3_ENDPOINT: "http://127.0.0.1:9001" }],
    ["remote backend", { MEDUSA_BACKEND_URL: "https://backend.example.com" }],
    ["enabled Melhor Envio", { MELHOR_ENVIO_ENV: "sandbox" }],
  ])("fails closed for %s", (_name, override) => {
    expect(() => assertCard140SandboxEnv({ ...validEnv(), ...override })).toThrow(/preflight failed/)
  })

  it("allows only an exact explicitly listed HTTPS webhook tunnel", () => {
    const env = validEnv()
    env.MERCADO_PAGO_WEBHOOK_BASE_URL = "https://card140-tunnel.example.test"
    env.CARD140_ALLOWED_WEBHOOK_HOSTS = "card140-tunnel.example.test"
    expect(assertCard140SandboxEnv(env).webhookUrl.hostname).toBe("card140-tunnel.example.test")

    env.CARD140_ALLOWED_WEBHOOK_HOSTS = "other.example.test"
    expect(() => assertCard140SandboxEnv(env)).toThrow(/explicitly allowed HTTPS tunnel/)
  })
})
