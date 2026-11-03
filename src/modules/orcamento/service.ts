import { MedusaService } from "@medusajs/framework/utils"
import Orcamento from "./models/orcamento"

// O pluralizador do Medusa gera os métodos como "...Orcamentoes" (createOrcamentoes etc.).
class OrcamentoModuleService extends MedusaService({
  Orcamento,
}) {}

export default OrcamentoModuleService
