import { MedusaService } from "@medusajs/framework/utils"
import Orcamento from "./models/orcamento"

class OrcamentoModuleService extends MedusaService({
  Orcamento,
}) {}

// Os tipos da Medusa pluralizam "Orcamento" como "Orcamentoes", mas em execução os
// métodos gerados são "...Orcamentos": declara os nomes reais para o TypeScript.
interface OrcamentoModuleService {
  listAndCountOrcamentos: OrcamentoModuleService["listAndCountOrcamentoes"]
  createOrcamentos: OrcamentoModuleService["createOrcamentoes"]
  deleteOrcamentos: OrcamentoModuleService["deleteOrcamentoes"]
}

export default OrcamentoModuleService
