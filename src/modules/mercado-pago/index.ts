import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import {
  MercadoPagoCardProviderService,
  MercadoPagoPixProviderService,
} from "./service"

export default ModuleProvider(Modules.PAYMENT, {
  services: [
    MercadoPagoPixProviderService,
    MercadoPagoCardProviderService,
  ],
})
