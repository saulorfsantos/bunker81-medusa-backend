import { MedusaService } from "@medusajs/framework/utils"
import MercadoPagoAttempt from "./models/mercado-pago-attempt"

class MercadoPagoAttemptModuleService extends MedusaService({
  MercadoPagoAttempt,
}) {}

export default MercadoPagoAttemptModuleService
