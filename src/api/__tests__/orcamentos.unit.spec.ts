import { CreateOrcamentoSchema } from "../admin/orcamentos/middlewares"
import { somarItens } from "../../workflows/create-orcamento"

const item = {
  codigo: "LEAO1114_50",
  descricao: "Combo com 20 unidades",
  quantidade: 1,
  unidade: "combo",
  preco_centavos: 6590,
}

describe("Orçamentos", () => {
  test("soma o total em centavos sem erro de ponto flutuante", () => {
    expect(
      somarItens([
        item,
        { ...item, quantidade: 3, preco_centavos: 10 },
        { ...item, quantidade: 2, preco_centavos: 20 },
      ])
    ).toBe(6660)
  })

  test("aceita orçamento só com itens e transforma campos vazios em null", () => {
    const parsed = CreateOrcamentoSchema.parse({ itens: [item], cliente_nome: "  " })
    expect(parsed.cliente_nome).toBeNull()
    expect(parsed.observacoes).toBeNull()
  })

  test("recusa orçamento vazio, quantidade zero e valor fracionado", () => {
    expect(CreateOrcamentoSchema.safeParse({ itens: [] }).success).toBe(false)
    expect(
      CreateOrcamentoSchema.safeParse({ itens: [{ ...item, quantidade: 0 }] }).success
    ).toBe(false)
    expect(
      CreateOrcamentoSchema.safeParse({ itens: [{ ...item, preco_centavos: 65.9 }] }).success
    ).toBe(false)
  })
})
