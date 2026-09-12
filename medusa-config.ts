import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

const mercadoPagoAccessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN
const mercadoPagoWebhookSecret = process.env.MERCADO_PAGO_WEBHOOK_SECRET
const mercadoPagoWebhookBaseUrl =
  process.env.MERCADO_PAGO_WEBHOOK_BASE_URL || process.env.MEDUSA_BACKEND_URL
const mercadoPagoLiveMode =
  process.env.MERCADO_PAGO_LIVE_MODE === "true"
    ? true
    : process.env.MERCADO_PAGO_LIVE_MODE === "false"
      ? false
      : undefined
const mercadoPagoRequested = Boolean(
  mercadoPagoAccessToken || mercadoPagoWebhookSecret
)
const mercadoPagoConfigured = Boolean(
  mercadoPagoAccessToken &&
    mercadoPagoWebhookSecret &&
    mercadoPagoWebhookBaseUrl &&
    mercadoPagoLiveMode !== undefined
)

if (mercadoPagoRequested && !mercadoPagoConfigured) {
  throw new Error(
    "Mercado Pago requires MERCADO_PAGO_ACCESS_TOKEN, " +
      "MERCADO_PAGO_WEBHOOK_SECRET, and MERCADO_PAGO_WEBHOOK_BASE_URL " +
      "(or MEDUSA_BACKEND_URL), plus an explicit " +
      "MERCADO_PAGO_LIVE_MODE=true|false"
  )
}

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    databaseDriverOptions: {
      ssl: false,
    },
    redisUrl: process.env.REDIS_URL,
    http: {
      storeCors: process.env.STORE_CORS || "*",
      adminCors: process.env.ADMIN_CORS || "*",
      authCors: process.env.AUTH_CORS || "*",
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    },
  },
  admin: {
    backendUrl: process.env.MEDUSA_ADMIN_BACKEND_URL || process.env.MEDUSA_BACKEND_URL,
  },
  modules: [
    {
      resolve: "@medusajs/medusa/file",
      options: {
        providers: [
          {
            resolve: "@medusajs/file-s3",
            id: "s3",
            options: {
              file_url: process.env.S3_FILE_URL,
              endpoint: process.env.S3_ENDPOINT,
              bucket: process.env.S3_BUCKET,
              access_key_id: process.env.S3_ACCESS_KEY_ID,
              secret_access_key: process.env.S3_SECRET_ACCESS_KEY,
              region: "auto",
              additional_client_config: {
                forcePathStyle: true,
              },
            },
          },
        ],
      },
    },
    {
      resolve: "@medusajs/medusa/cache-redis",
      options: {
        redisUrl: process.env.REDIS_URL,
      },
    },
    {
      resolve: "@medusajs/medusa/event-bus-redis",
      options: {
        redisUrl: process.env.REDIS_URL,
      },
    },
    {
      resolve: "@medusajs/medusa/workflow-engine-redis",
      options: {
        redis: {
          url: process.env.REDIS_URL,
        },
      },
    },
    ...(mercadoPagoConfigured
      ? [
          {
            resolve: "@medusajs/medusa/payment",
            options: {
              providers: [
                {
                  resolve: "./src/modules/mercado-pago",
                  id: "mercadopago",
                  options: {
                    accessToken: mercadoPagoAccessToken,
                    webhookSecret: mercadoPagoWebhookSecret,
                    webhookBaseUrl: mercadoPagoWebhookBaseUrl,
                    liveMode: mercadoPagoLiveMode,
                  },
                },
              ],
            },
          },
        ]
      : []),
  ],
})
