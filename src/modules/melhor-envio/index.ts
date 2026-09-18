import type { ModuleProviderExports } from "@medusajs/framework/types"
import MelhorEnvioFulfillmentService from "./service"

const provider: ModuleProviderExports = { services: [MelhorEnvioFulfillmentService] }
export default provider
