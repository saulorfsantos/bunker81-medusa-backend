import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ORCAMENTO_MODULE } from "../../modules/orcamento"
import type OrcamentoModuleService from "../../modules/orcamento/service"

export type OrcamentoItem = {
  codigo: string
  descricao: string
  quantidade: number
  unidade: string
  preco_centavos: number
}

export type CreateOrcamentoStepInput = {
  itens: OrcamentoItem[]
  total_centavos: number
  cliente_nome?: string | null
  cliente_documento?: string | null
  cliente_email?: string | null
  cliente_telefone?: string | null
  observacoes?: string | null
  operador?: string | null
  criado_por?: string | null
}

export const createOrcamentoStep = createStep(
  "create-orcamento",
  async (input: CreateOrcamentoStepInput, { container }) => {
    const service: OrcamentoModuleService = container.resolve(ORCAMENTO_MODULE)
    const orcamento = await service.createOrcamentoes({
      ...input,
      // model.json() é tipado como objeto, mas o jsonb guarda a lista sem problema
      itens: input.itens as unknown as Record<string, unknown>,
    })
    return new StepResponse(orcamento, orcamento.id)
  },
  async (id, { container }) => {
    if (!id) return
    const service: OrcamentoModuleService = container.resolve(ORCAMENTO_MODULE)
    await service.deleteOrcamentoes(id)
  }
)
