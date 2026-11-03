import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  createOrcamentoStep,
  type CreateOrcamentoStepInput,
} from "./steps/create-orcamento"

export type CreateOrcamentoWorkflowInput = Omit<
  CreateOrcamentoStepInput,
  "total_centavos"
>

export const somarItens = (itens: CreateOrcamentoStepInput["itens"]) =>
  itens.reduce((soma, item) => soma + item.preco_centavos * item.quantidade, 0)

/** O total é recalculado aqui: o PDV não decide o valor que fica gravado. */
export const createOrcamentoWorkflow = createWorkflow(
  "create-orcamento",
  function (input: CreateOrcamentoWorkflowInput) {
    const dados = transform({ input }, ({ input }) => ({
      ...input,
      total_centavos: somarItens(input.itens),
    }))
    const orcamento = createOrcamentoStep(dados)
    return new WorkflowResponse(orcamento)
  }
)
