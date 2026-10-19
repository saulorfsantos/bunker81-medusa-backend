# Colete Modular PCR Rossi em 4 cores (19/10/2026)

Produto `prod_01M3Z407FZ3TB8M68M9A5TG32P` passou de 1 variante para 4, com os códigos
oficiais da Rossi (rossi.com.br/pt-br/produtos/43497..43500):

| Cor | SKU | Variante |
|---|---|---|
| Multicam | 26201022 | `variant_01M3Z407HT178T24J0F6EEMGX8` (a original, mesmo id) |
| Verde Militar | 26201021 | `variant_01M5AF4K22Q05BVJ06B5QZG6HR` |
| Preto | 26201023 | `variant_01M5AF4K9X8JP48358JE5CBT9Q` |
| Cáqui (Tan na Rossi) | 26201024 | `variant_01M5AF4KKMTWPMDK3RDN1JR25Y` |

- A opção "Default option" foi renomeada para "Cor" e o valor original para "Multicam"
  (nada apagado). Nenhum dos 9 pedidos existentes usava o produto.
- Preço R$ 614 em todas; peso/medidas copiados da original.
- Estoque: cada cor tem item de estoque com 0 na "Loja Bunker - Matriz". Lançar a
  quantidade em Admin → Inventário (ou no PDV) libera a cor para venda.
- Fotos: cada cor tem a sua (e é a miniatura da variante, que aparece no carrinho e no
  pedido); a foto lado a lado Multicam + Preto ficou nessas duas. Fotos de costas entram
  quando o cliente enviar: basta associá-las à variante no Admin (Mídia da variante).

Reverter: `node vest-variants.mjs <env com MEDUSA_BACKEND_URL e MEDUSA_ADMIN_API_KEY> rollback`
(usa `apply-log.json`; apaga só o que foi criado). Estado anterior em `before-snapshot.json`.
