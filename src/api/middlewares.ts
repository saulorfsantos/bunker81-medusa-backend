import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { defineMiddlewares } from "@medusajs/framework/http"

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {}

const firstQueryValue = (value: unknown): string | undefined => {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === "string" && first.trim() ? first.trim() : undefined
}

export const addPaymentCollectionReference = (
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
) => {
  const body = toRecord(req.body)
  const data = toRecord(body.data)

  req.body = {
    ...body,
    data: {
      ...data,
      payment_collection_id: req.params.id,
    },
  }
  next()
}

export const normalizeMercadoPagoWebhookQuery = (
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
) => {
  if (!String(req.params.provider || "").startsWith("mercadopago-")) {
    next()
    return
  }

  const query = toRecord(req.query)
  const nestedData = toRecord(query.data)
  const dataId = firstQueryValue(
    query["data.id"] || query.data_id || nestedData.id
  )
  const topic = firstQueryValue(query.type || query.topic)
  const body = toRecord(req.body)

  req.body = {
    ...body,
    ...(dataId ? { data_id: dataId.toLowerCase() } : {}),
    ...(topic ? { type: topic.toLowerCase() } : {}),
  }
  next()
}

export default defineMiddlewares({
  routes: [
    {
      matcher: "/store/payment-collections/:id/payment-sessions",
      methods: ["POST"],
      middlewares: [addPaymentCollectionReference],
    },
    {
      matcher: "/admin/payment-collections/:id/payment-sessions",
      methods: ["POST"],
      middlewares: [addPaymentCollectionReference],
    },
    {
      matcher: "/hooks/payment/:provider",
      methods: ["POST"],
      middlewares: [normalizeMercadoPagoWebhookQuery],
    },
  ],
})
