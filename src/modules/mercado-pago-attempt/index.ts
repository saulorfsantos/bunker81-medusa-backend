import { Module } from "@medusajs/framework/utils"
import MercadoPagoAttemptModuleService from "./service"

export const MERCADO_PAGO_ATTEMPT_MODULE = "mercadoPagoAttempt"

export default Module(MERCADO_PAGO_ATTEMPT_MODULE, {
  service: MercadoPagoAttemptModuleService,
})
