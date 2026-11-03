import { Module } from "@medusajs/framework/utils"
import OrcamentoModuleService from "./service"

export const ORCAMENTO_MODULE = "orcamento"

export default Module(ORCAMENTO_MODULE, {
  service: OrcamentoModuleService,
})
