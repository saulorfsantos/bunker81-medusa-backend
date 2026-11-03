import { validateAndTransformBody } from "@medusajs/framework/http"
import type { MiddlewareRoute } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => v || null)

export const OrcamentoItemSchema = z.object({
  codigo: z.string().trim().max(40).default(""),
  descricao: z.string().trim().max(300).default(""),
  quantidade: z.number().int().min(1).max(100000),
  unidade: z.string().trim().max(20).default(""),
  preco_centavos: z.number().int().min(0).max(100_000_000),
})

export const CreateOrcamentoSchema = z.object({
  itens: z.array(OrcamentoItemSchema).min(1).max(200),
  cliente_nome: textoOpcional(200),
  cliente_documento: textoOpcional(30),
  cliente_email: textoOpcional(200),
  cliente_telefone: textoOpcional(40),
  observacoes: textoOpcional(1000),
  operador: textoOpcional(120),
})

export type CreateOrcamentoSchema = z.infer<typeof CreateOrcamentoSchema>

export const ListOrcamentosQuery = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export const orcamentoMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/admin/orcamentos",
    methods: ["POST"],
    middlewares: [validateAndTransformBody(CreateOrcamentoSchema)],
  },
]
