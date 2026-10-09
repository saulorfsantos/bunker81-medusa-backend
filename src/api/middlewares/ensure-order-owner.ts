import type {
  AuthenticatedMedusaRequest,
  MedusaNextFunction,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"

export async function ensureOrderOwner(
  req: AuthenticatedMedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const {
    data: [order],
  } = await query.graph({
    entity: "order",
    fields: ["id", "customer_id"],
    filters: { id: req.params.id },
  })

  if (!order || order.customer_id !== req.auth_context.actor_id) {
    return next(
      new MedusaError(
        MedusaError.Types.UNAUTHORIZED,
        "You are not allowed to retrieve this order."
      )
    )
  }

  next()
}
