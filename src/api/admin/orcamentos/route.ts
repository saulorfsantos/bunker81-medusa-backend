import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { ORCAMENTO_MODULE } from "../../../modules/orcamento"
import type OrcamentoModuleService from "../../../modules/orcamento/service"
import { createOrcamentoWorkflow } from "../../../workflows/create-orcamento"
import {
  type CreateOrcamentoSchema,
  ListOrcamentosQuery,
} from "./middlewares"

/** Lista os orçamentos salvos, do mais novo para o mais antigo. */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const parsed = ListOrcamentosQuery.safeParse(req.query)
  if (!parsed.success) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Parâmetros de busca inválidos.")
  }
  const { q, limit, offset } = parsed.data

  // Busca por número exato ("12" ou "ORC-0012") ou por parte do nome do cliente.
  const numero = q?.replace(/^orc-?/i, "")
  const filtros = !q
    ? {}
    : /^\d+$/.test(numero ?? "")
      ? { numero: Number(numero) }
      : { cliente_nome: { $ilike: `%${q}%` } }

  const service: OrcamentoModuleService = req.scope.resolve(ORCAMENTO_MODULE)
  const [orcamentos, count] = await service.listAndCountOrcamentoes(filtros, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC" },
  })

  res.json({ orcamentos, count, limit, offset })
}

export async function POST(
  req: AuthenticatedMedusaRequest<CreateOrcamentoSchema>,
  res: MedusaResponse
) {
  const { result } = await createOrcamentoWorkflow(req.scope).run({
    input: { ...req.validatedBody, criado_por: req.auth_context.actor_id },
  })
  res.status(201).json({ orcamento: result })
}
