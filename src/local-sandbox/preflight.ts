import { createConnection, isIP } from "node:net"
import path from "node:path"
import { Client } from "pg"

const EXPECTED_DATABASE = "medusa_card140"
const EXPECTED_DATABASE_USER = "medusa_card140"
const EXPECTED_UPLOAD_DIR = path.join("static", "card140")
const LOOPBACK_IPV4 = /^127(?:\.\d{1,3}){3}$/

export class Card140PreflightError extends Error {
  constructor(message: string) {
    super(`Card 140 local sandbox preflight failed: ${message}`)
    this.name = "Card140PreflightError"
  }
}

export type Card140SandboxConfig = {
  databaseUrl: URL
  redisUrl: URL
  webhookUrl: URL
  postgresPort: number
  redisPort: number
}

const required = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = env[name]?.trim()
  if (!value) throw new Card140PreflightError(`${name} is UNKNOWN`)
  return value
}

const parseUrl = (
  env: NodeJS.ProcessEnv,
  name: string,
  protocols: string[]
): URL => {
  const raw = required(env, name)
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Card140PreflightError(`${name} is not an unambiguous URL`)
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new Card140PreflightError(`${name} uses forbidden protocol ${parsed.protocol}`)
  }
  return parsed
}

const normalizedHost = (hostname: string): string =>
  hostname.toLowerCase().replace(/^\[|\]$/g, "")

export const isLoopbackHost = (hostname: string): boolean => {
  const host = normalizedHost(hostname)
  if (host === "localhost" || host === "::1") return true
  if (isIP(host) === 4) return LOOPBACK_IPV4.test(host)
  return false
}

const assertLoopback = (name: string, url: URL): void => {
  if (!url.hostname || !isLoopbackHost(url.hostname)) {
    throw new Card140PreflightError(`${name} must target loopback; got remote or UNKNOWN host`)
  }
}

const parsePort = (env: NodeJS.ProcessEnv, name: string): number => {
  const value = Number(required(env, name))
  if (!Number.isSafeInteger(value) || value < 1024 || value > 65535) {
    throw new Card140PreflightError(`${name} must be an explicit unprivileged TCP port`)
  }
  return value
}

const assertPort = (name: string, url: URL, expected: number): void => {
  if (!url.port || Number(url.port) !== expected) {
    throw new Card140PreflightError(`${name} must use the assigned local port ${expected}`)
  }
}

const assertEmpty = (env: NodeJS.ProcessEnv, names: string[]): void => {
  for (const name of names) {
    if (env[name]?.trim()) {
      throw new Card140PreflightError(`${name} must be unset in the local sandbox`)
    }
  }
}

const assertLocalHttpUrl = (env: NodeJS.ProcessEnv, name: string): void => {
  const url = parseUrl(env, name, ["http:", "https:"])
  assertLoopback(name, url)
}

const assertLocalCors = (env: NodeJS.ProcessEnv, name: string): void => {
  const values = required(env, name).split(",").map((value) => value.trim())
  if (!values.length || values.some((value) => !value)) {
    throw new Card140PreflightError(`${name} contains an UNKNOWN origin`)
  }
  for (const value of values) {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new Card140PreflightError(`${name} contains an invalid origin`)
    }
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Card140PreflightError(`${name} contains a forbidden protocol`)
    }
    assertLoopback(name, url)
  }
}

const assertWebhookTarget = (env: NodeJS.ProcessEnv): URL => {
  const url = parseUrl(env, "MERCADO_PAGO_WEBHOOK_BASE_URL", ["http:", "https:"])
  if (isLoopbackHost(url.hostname)) return url

  const allowed = (env.CARD140_ALLOWED_WEBHOOK_HOSTS || "")
    .split(",")
    .map((host) => normalizedHost(host.trim()))
    .filter(Boolean)
  if (url.protocol !== "https:" || !allowed.includes(normalizedHost(url.hostname))) {
    throw new Card140PreflightError(
      "MERCADO_PAGO_WEBHOOK_BASE_URL is remote and not an explicitly allowed HTTPS tunnel"
    )
  }
  return url
}

export const assertCard140SandboxEnv = (
  env: NodeJS.ProcessEnv
): Card140SandboxConfig => {
  if (required(env, "CARD140_LOCAL_SANDBOX") !== "true") {
    throw new Card140PreflightError("CARD140_LOCAL_SANDBOX must be exactly true")
  }
  if (!new Set(["development", "test"]).has(required(env, "NODE_ENV"))) {
    throw new Card140PreflightError("NODE_ENV must be development or test")
  }

  const postgresPort = parsePort(env, "CARD140_POSTGRES_PORT")
  const redisPort = parsePort(env, "CARD140_REDIS_PORT")
  const databaseUrl = parseUrl(env, "DATABASE_URL", ["postgres:", "postgresql:"])
  assertLoopback("DATABASE_URL", databaseUrl)
  assertPort("DATABASE_URL", databaseUrl, postgresPort)
  if (
    databaseUrl.pathname !== `/${EXPECTED_DATABASE}` ||
    decodeURIComponent(databaseUrl.username) !== EXPECTED_DATABASE_USER ||
    decodeURIComponent(databaseUrl.password) !== EXPECTED_DATABASE_USER ||
    databaseUrl.search ||
    databaseUrl.hash
  ) {
    throw new Card140PreflightError(
      `DATABASE_URL must identify only the disposable ${EXPECTED_DATABASE} database`
    )
  }

  const redisUrl = parseUrl(env, "REDIS_URL", ["redis:"])
  assertLoopback("REDIS_URL", redisUrl)
  assertPort("REDIS_URL", redisUrl, redisPort)
  if (redisUrl.username || redisUrl.password || !["", "/"].includes(redisUrl.pathname)) {
    throw new Card140PreflightError("REDIS_URL must identify the disposable unauthenticated local Redis")
  }

  assertLocalHttpUrl(env, "MEDUSA_BACKEND_URL")
  if (env.MEDUSA_ADMIN_BACKEND_URL?.trim()) {
    assertLocalHttpUrl(env, "MEDUSA_ADMIN_BACKEND_URL")
  }
  for (const name of ["STORE_CORS", "ADMIN_CORS", "AUTH_CORS"]) {
    assertLocalCors(env, name)
  }

  if (required(env, "FILE_PROVIDER") !== "local") {
    throw new Card140PreflightError("FILE_PROVIDER must be exactly local")
  }
  if (path.normalize(required(env, "LOCAL_FILE_UPLOAD_DIR")) !== EXPECTED_UPLOAD_DIR) {
    throw new Card140PreflightError(`LOCAL_FILE_UPLOAD_DIR must be ${EXPECTED_UPLOAD_DIR}`)
  }
  const localFileUrl = parseUrl(env, "LOCAL_FILE_BACKEND_URL", ["http:", "https:"])
  assertLoopback("LOCAL_FILE_BACKEND_URL", localFileUrl)
  if (localFileUrl.pathname.replace(/\/$/, "") !== "/static/card140") {
    throw new Card140PreflightError("LOCAL_FILE_BACKEND_URL must use /static/card140")
  }
  assertEmpty(env, [
    "S3_FILE_URL",
    "S3_ENDPOINT",
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
  ])

  if (required(env, "MERCADO_PAGO_LIVE_MODE") !== "false") {
    throw new Card140PreflightError("MERCADO_PAGO_LIVE_MODE must be exactly false")
  }
  assertEmpty(env, ["MERCADO_PAGO_ACCESS_TOKEN", "MERCADO_PAGO_WEBHOOK_SECRET"])
  const webhookUrl = assertWebhookTarget(env)

  const melhorEnvioTargets = Object.keys(env).filter(
    (name) => name.startsWith("MELHOR_ENVIO_") && env[name]?.trim()
  )
  if (melhorEnvioTargets.length) {
    throw new Card140PreflightError("Melhor Envio must be disabled in the Card 140 sandbox")
  }

  return { databaseUrl, redisUrl, webhookUrl, postgresPort, redisPort }
}

export const verifyCard140Runtime = async (
  env: NodeJS.ProcessEnv
): Promise<void> => {
  const config = assertCard140SandboxEnv(env)
  const client = new Client({
    connectionString: config.databaseUrl.toString(),
    connectionTimeoutMillis: 5000,
  })
  try {
    await client.connect()
    const result = await client.query<{
      current_database: string
      current_user: string
    }>(
      "select current_database() as current_database, current_user as current_user"
    )
    if (
      result.rows[0]?.current_database !== EXPECTED_DATABASE ||
      result.rows[0]?.current_user !== EXPECTED_DATABASE_USER
    ) {
      throw new Card140PreflightError("connected PostgreSQL database or role has an unexpected identity")
    }
  } catch (error) {
    if (error instanceof Card140PreflightError) throw error
    throw new Card140PreflightError("disposable PostgreSQL is unavailable or rejected the identity check")
  } finally {
    await client.end().catch(() => undefined)
  }

  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({
      host: normalizedHost(config.redisUrl.hostname),
      port: config.redisPort,
    })
    const timeout = setTimeout(() => {
      socket.destroy()
      reject(new Card140PreflightError("disposable Redis is unavailable or failed PING"))
    }, 5000)
    let response = ""

    socket.setEncoding("utf8")
    socket.once("connect", () => socket.write("*1\r\n$4\r\nPING\r\n"))
    socket.on("data", (chunk) => {
      response += chunk
      if (response.startsWith("+PONG\r\n")) {
        clearTimeout(timeout)
        socket.end()
        resolve()
      }
    })
    socket.once("error", () => {
      clearTimeout(timeout)
      reject(new Card140PreflightError("disposable Redis is unavailable or failed PING"))
    })
  })
}
