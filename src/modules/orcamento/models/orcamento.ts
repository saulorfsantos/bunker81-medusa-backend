import { model } from "@medusajs/framework/utils"

/**
 * Orçamento comercial gerado no PDV. Não é pedido: não reserva estoque nem
 * gera cobrança. Os itens ficam como foram mostrados no PDF (texto livre),
 * com valores em centavos para a soma não sofrer com ponto flutuante.
 */
const Orcamento = model.define("orcamento", {
  id: model.id({ prefix: "orc" }).primaryKey(),
  numero: model.autoincrement(),
  cliente_nome: model.text().nullable(),
  cliente_documento: model.text().nullable(),
  cliente_email: model.text().nullable(),
  cliente_telefone: model.text().nullable(),
  observacoes: model.text().nullable(),
  itens: model.json(),
  total_centavos: model.number(),
  operador: model.text().nullable(),
  criado_por: model.text().nullable(),
})

export default Orcamento
