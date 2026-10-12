# Frete provisório da Bunker — card #93, 12/10/2026

Saulo autorizou começar pela pesquisa e liberar a loja com dados logísticos provisórios, enquanto Adriano pede o cadastro aos fornecedores. Prazo vigente informado: quarta-feira **14/10/2026**. Os dados não são apresentados como medições feitas na loja.

## Critério

- Peso líquido do modelo ou peso calculado das BBs: **+10%, arredondado para cima em gramas**. Exemplo: 0,20 g × 2.800 = 560 g → **616 g**.
- Fonte com peso bruto/embalagem: usar esse peso sem aplicar novamente os 10%.
- Sem peso compatível encontrado: estimativa operacional por família, com +10%, explicitamente identificada.
- Dimensões de embalagem publicadas: usar a fonte; cm fracionados são arredondados para cima. Demais dimensões são **estimativas de embalagem por família**, não dados extraídos do fabricante. Não existe garantia de que a margem cobrirá o frete real.
- Os valores são por **uma unidade comercial**. A cotação existente envia os itens e suas quantidades ao Melhor Envio; não usa uma caixa única fixa para qualquer carrinho.
- Os perfis não alteram preço de produto, estoque, pagamento, credenciais ou dados de compradores. Nenhuma taxa adicional foi criada e não há rotina automática de desconto/reembolso de frete.

Cobertura: 72 produtos/variantes (72 IDs explícitos). Peso: 20 calculados pelo rótulo das BBs, 19 de fichas de modelo, 7 de peso bruto de fornecedor/revendedor/família, 26 estimados. Dimensões: 1 perfil usa embalagem publicada; **71 perfis são estimados**. Referências de família/modelo interno podem precisar de confirmação de cor, conector ou apresentação. A lista inteira continua provisória.

## Aplicação no EasyPanel

Antes de rodar, confirmar um backup recuperável do banco pelo painel já existente. Não adicionar este comando ao startup: é uma operação única, executada pelo operador. O merge/deploy apenas disponibiliza o script.

No serviço `bunker81-backend / medusa-api`, configurar:

```text
MELHOR_ENVIO_CATALOG_WEIGHT_UNIT=g
MELHOR_ENVIO_CATALOG_DIMENSION_UNIT=cm
```

Manter os quatro parâmetros válidos da integração: ambiente, token, User-Agent com e-mail e IDs dos serviços. O CEP de origem deve continuar o da loja. Esses perfis não substituem a configuração do provedor. Não compartilhar tokens.

O script deve ser executado no diretório raiz do projeto que contém `package.json` e `src/scripts/shipping-profiles.ts` (confirmar `pwd` e os arquivos no terminal do serviço; não assumir diretório). A execução padrão é somente leitura:

```bash
npm run shipping:profiles
```

Ela confere IDs do produto/variante e SKU dos 72 registros antes de qualquer gravação e mostra o plano sem segredos. Confirmado o resumo, aplicar:

```bash
BUNKER_SHIPPING_MODE=apply npm run shipping:profiles
```

Resultado esperado na primeira execução com catálogo vazio de medidas: `SHIPPING_APPLIED {"applied":72,"preserved":0}`. Registros com dados existentes/estimativa já aplicada são preservados; rerun não soma margem de novo. O script preenche apenas campos nulos/zero/inválidos. Não cria produtos nem altera a associação de estoque.

As alterações ficam marcadas nos metadados da variante em `bunker_shipping_estimate`, incluindo fonte, estimativa, valores anteriores e campos escritos. Isso permanece no banco após restart/deploy. Falha parcial tenta desfazer somente o lote recém-aplicado, incluindo escrita cuja resposta se perdeu. Falha de conexão durante a recuperação exige repetir o rollback/usar o backup conforme o estado real; não há garantia transacional entre todas as variantes.

## Recuperação

```bash
BUNKER_SHIPPING_MODE=rollback npm run shipping:profiles
```

Restaura os campos preenchidos por esta versão do script e preserva demais metadados. Se algum desses campos mudou depois (por exemplo, Adriano mediu o produto), ele é preservado e reportado como conflito. Nunca desfazer correção manual posterior silenciosamente. Não muda units/flags/configuração do provedor: configurações alteradas pelo operador precisam de recuperação própria.

## Verificação depois de aplicar

Atualização 12/10: importação reportada concluída com 72 aplicados; Store API confirmou 72 variantes com medidas completas. O log identificou o erro posterior como `Melhor Envio quotes require BRL`: a projeção do carrinho no workflow de cálculo do Medusa 2.17 omite a moeda. O provider passa a consultar apenas `id,currency_code` no módulo Cart quando a moeda está ausente, com dependência declarada no módulo de fulfillment. Continua recusando moeda diferente de BRL e ignora moeda/preço fornecidos pelo browser. Publicar a correção e repetir a cotação; não é necessário repetir a importação dos produtos.

1. Editar/salvar novamente o endereço no checkout e confirmar PAC/SEDEX/Jadlog conforme serviços realmente disponíveis.
2. Conferir cotação com uma unidade, múltiplas unidades e carrinho misto; selecionar frete e conferir totais. Preservar retirada R$0.
3. Se continuar indisponível, obter erro sanitizado do cálculo. Em 12/10, antes de aplicar perfis, um carrinho técnico sem e-mail/pagamento/pedido retornou HTTP 500 no calculate. Medidas ausentes são comprovadas; configuração das unidades/token, contexto de cotação e erro específico ainda não foram verificados no runtime.
4. Não declarar pedido/pagamento/estoque validados apenas por cotação. Esses testes continuam em #93; conta/reset já foram testados pelo usuário, autorização dos pedidos/checkout ainda depende do fluxo integrado.
5. Gás, CO2 e aerossol: peso/volume não prova que cada serviço aceita transportar o item. Conferir aceitação; se houver restrição concreta, restringir o serviço/item ou oferecer retirada. Não tratar a pressão `12kg` de Green Gas como peso de produto. Baterias devem usar o acondicionamento aceito pelo serviço.

## Substituição posterior pelo fornecedor

Quando chegarem os dados, substituir pelo peso bruto/embalagem real, sem adicionar os 10% novamente sobre o perfil antigo. Atualizar/remover a marca provisória apenas depois de salvar a referência correta. Preço aceito em pedidos existentes não deve ser recalculado retroativamente. Cotação diferente não cria desconto automático: eventual devolução ao comprador precisa de ação operacional.

## Dados preparados

As fontes abaixo justificam o peso/modelo ou a pesquisa de família; **não justificam as dimensões estimadas**.

| SKU | Produto | Peso base g | Critério | Peso cotação g | A×L×C cm | Fonte |
|---|---|---:|---|---:|---|---|
| TD20-2.800 | BB's Tango Down 0.20g 2.800un | 560 | calculated_net +10% | 616 | 8×15×20 | [referência](https://bunker81.com.br/product/prod_01KS8A4RFZ05B8E10CYSQWZG3B) |
| TD30-2.800 | BB's Tango Down 0.30g 2.800un | 840 | calculated_net +10% | 924 | 8×15×20 | [referência](https://bunker81.com.br/product/prod_01KS8A4RFZ1CDZ7H9CX2QKMHT6) |
| TD28-5000 | BB's Tango Down 0.28g 5000un | 1400 | calculated_net +10% | 1540 | 10×18×25 | [referência](https://bunker81.com.br/product/prod_01KS8A4RFZ4G5H2X1KN8JFTK6W) |
| TD25-2.800 | BB's Tango Down 0.25g 2.800un | 700 | calculated_net +10% | 770 | 8×15×20 | [referência](https://bunker81.com.br/product/prod_01KS8A4RFZ8B9MNSHY2EREX3G4) |
| BNK-0010 | BB's Tracer Tango Down 0.25g 2.800un | 700 | calculated_net +10% | 770 | 8×15×20 | [referência](https://bunker81.com.br/product/prod_01KS8A4RFZBKNFWK3B58S2EBAF) |
| BNK-0012 | BB's Sniper Tango Down 0.36g 1.000un | 360 | calculated_net +10% | 396 | 6×12×15 | [referência](https://bunker81.com.br/product/prod_01KS8A4RFZFN7AS639JS8S275F) |
| TD30-5000 | BB's Tango Down 0.30g 5000un | 1500 | calculated_net +10% | 1650 | 10×18×25 | [referência](https://bunker81.com.br/product/prod_01KS8A4RFZH69JRSE59X8Y343K) |
| TD28-2.800 | BB's Tango Down 0.28g 2.800un | 784 | calculated_net +10% | 863 | 8×15×20 | [referência](https://bunker81.com.br/product/prod_01KS8A4RFZVFDGV8JE9585Q0Y9) |
| BNK-0011 | BB's Sniper Tango Down 0.32g 2.000un | 640 | calculated_net +10% | 704 | 8×14×18 | [referência](https://bunker81.com.br/product/prod_01KS8A4RFZW1JBK2GSTM1855CP) |
| BNK-0001 | BB's Tango Down 0.20g 5000un | 1000 | calculated_net +10% | 1100 | 10×18×25 | [referência](https://bunker81.com.br/product/prod_01KS8A4RFZYASNRKKKB5HXSZM5) |
| TD25-5000 | BB's Tango Down 0.25g 5000un | 1250 | calculated_net +10% | 1375 | 10×18×25 | [referência](https://bunker81.com.br/product/prod_01KS8A4RFZZTQ5KE4W7EEFVZBG) |
| BNK-0013 | BB's Sniper Tango Down 0.36g 500un | 180 | calculated_net +10% | 198 | 5×10×12 | [referência](https://bunker81.com.br/product/prod_01KS8A4RFZZXX8KBPBJP3QA9G1) |
| BNK-0009 | BB's Tracer Tango Down 0.25g 5000un | 1250 | calculated_net +10% | 1375 | 10×18×25 | [referência](https://bunker81.com.br/product/prod_01KS8A4RFZZZVQE7Y4XJS5T19V) |
| BNK-0027 | Magazine M4 Mid-Cap HP Polímero 130 BB's Rossi | 175 | estimate +10% | 193 | 6×12×20 | [referência](https://www.rossi.com.br/pt-br/produtos/39256/) |
| BNK-0015 | BB's Sniper Tango Down 0.40g 500un | 200 | calculated_net +10% | 220 | 5×10×12 | [referência](https://bunker81.com.br/product/prod_01KS8A4RG04XRKBE416PB3NWY8) |
| BNK-0022 | Colete Tático Modular SP-033 Woodland Rossi | 1389 | estimate +10% | 1528 | 18×35×45 | [referência](https://www.rossi.com.br/pt-br/produtos/42397/) |
| BNK-0017 | BB's Sniper Tango Down 0.45g 1.000un | 450 | calculated_net +10% | 495 | 6×12×15 | [referência](https://bunker81.com.br/product/prod_01KS8A4RG06GKC1GS79XKAE7WK) |
| BNK-0018 | BB's Sniper Tango Down 0.48g 1.000un | 480 | calculated_net +10% | 528 | 6×12×15 | [referência](https://bunker81.com.br/product/prod_01KS8A4RG095XS8R1Z4EC0N0RK) |
| BNK-0014 | BB's Sniper Tango Down 0.40g 1.000un | 400 | calculated_net +10% | 440 | 6×12×15 | [referência](https://bunker81.com.br/product/prod_01KS8A4RG09X2AM91B1AQ8P42W) |
| BNK-0020 | BB's Sniper Tango Down 0.50g 500un | 250 | calculated_net +10% | 275 | 5×10×12 | [referência](https://bunker81.com.br/product/prod_01KS8A4RG0A30ZZJ4ZEM4E9GCJ) |
| BNK-0019 | BB's Sniper Tango Down 0.48g 500un | 240 | calculated_net +10% | 264 | 5×10×12 | [referência](https://bunker81.com.br/product/prod_01KS8A4RG0HZHZ43BQJSM1EA6C) |
| BNK-0016 | BB's Sniper Tango Down 0.45g 500un | 225 | calculated_net +10% | 248 | 5×10×12 | [referência](https://bunker81.com.br/product/prod_01KS8A4RG0JXKGW4165K63Y8XN) |
| BNK-0026 | Magazine M4 Mid-Cap Polímero 100 BB's Rossi | 170 | net +10% | 187 | 6×12×20 | [referência](https://www.rossi.com.br/pt-br/produtos/40617/) |
| BNK-0021 | Colete Tático Modular SP-033 Verde Militar Rossi | 1323 | estimate +10% | 1456 | 18×35×45 | [referência](https://www.rossi.com.br/pt-br/produtos/42394/) |
| BNK-0025 | Magazine AK Mid-Cap Polímero 130 BB's Rossi | 200 | estimate +10% | 220 | 6×12×20 | [referência](https://www.rossi.com.br/pt-br/produtos/39408/) |
| 25207747 | Magazine Green Gás Pistola 1911 Redwings Rossi | 180 | net +10% | 198 | 6×12×20 | [referência](https://www.rossi.com.br/pt-br/produtos/38383/) |
| BNK-0023 | Magazine Green Gás Pistola Glock R17/R18 Rossi | 270 | net +10% | 297 | 6×12×20 | [referência](https://www.rossi.com.br/pt-br/produtos/38686/) |
| BNK-0040 | Suporte Bandoleira Engate Rápido Metal | 150 | estimate +10% | 165 | 5×10×15 | [referência](https://bunker81.com.br/product/prod_01KS8A4RG10B2S20MT023JHK59) |
| BNK-0034 | Luneta Rossi 4.5x20 WA Mount 3/8 11mm | 320 | net +10% | 352 | 12×15×45 | [referência](https://www.rossi.com.br/pt-br/produtos/40747/) |
| BNK-0039 | Elevador de Mount para Trilho 22mm | 150 | estimate +10% | 165 | 5×10×15 | [referência](https://bunker81.com.br/product/prod_01KS8A4RG123Y37NJZKH3V8KJG) |
| BNK-0038 | Bipé Rossi 6-9 Fixo Estilo Harris | 500 | estimate +10% | 550 | 8×12×25 | [referência](https://bunker81.com.br/product/prod_01KS8A4RG13AH95FDADMTJXSS2) |
| BNK-0035 | Luneta Rossi Gold Crown 4x32 PCP | 340 | net +10% | 374 | 12×15×45 | [referência](https://www.rossi.com.br/pt-br/produtos/41391/) |
| BNK-0029 | Magazine M4 Mid-Cap Full Metal 110 BB's Rossi | 228 | net +10% | 251 | 6×12×20 | [referência](https://www.rossi.com.br/pt-br/produtos/39257/) |
| BNK-0032 | Mira Red Dot Mini 1x18 Rossi | 60 | net +10% | 66 | 10×15×20 | [referência](https://www.rossi.com.br/pt-br/produtos/40746/) |
| BNK-0041 | Canivete Jiboia Karambit F386 Rossi | 127 | net +10% | 140 | 5×10×16 | [referência](https://www.rossi.com.br/pt-br/produtos/40430/) |
| BNK-0037 | Coldre Tan Porta Magazine Pistola Rossi | 300 | estimate +10% | 330 | 6×12×20 | [referência](https://bunker81.com.br/product/prod_01KS8A4RG1AQ57ZVVZRZTPTG7S) |
| BNK-0028 | Magazine M4 Hi-Cap HP Polímero 350 BB's Rossi | 150 | net +10% | 165 | 6×12×20 | [referência](https://www.rossi.com.br/pt-br/produtos/40618/) |
| BNK-0030 | Magazine M4 Hi-Cap Full Metal 300 BB's Rossi | 220 | net +10% | 242 | 6×12×20 | [referência](https://www.rossi.com.br/pt-br/produtos/38359/) |
| BNK-0031 | Mira Holográfica Dot 551 Red/Green Rossi | 214 | net +10% | 236 | 10×15×20 | [referência](https://www.rossi.com.br/pt-br/produtos/38801/) |
| BNK-0036 | Coldre Tan Porta Magazine M4/AK Rossi | 300 | estimate +10% | 330 | 6×12×20 | [referência](https://bunker81.com.br/product/prod_01KS8A4RG1KN27YVKQNPYVD1MG) |
| BNK-0033 | Luneta Discovery HT-NV 3x24IR Retículo Iluminado | 265 | net +10% | 292 | 12×15×45 | [referência](https://www.rossi.com.br/pt-br/produtos/42246/) |
| BNK-0045 | Combo Specna Arms 5 Mid-Cap 125 BB's | 900 | estimate +10% | 990 | 12×20×25 | [referência](https://bunker81.com.br/product/prod_01KS8A4RG219AC4XEXGHBJP6GS) |
| BNK-0049 | Cilindro CO2 12g Leão | 60 | estimate +10% | 66 | 4×6×12 | [referência](https://bunker81.com.br/product/prod_01KS8A4RG22ZTEP12Y4FMJVRA3) |
| BNK-0047 | Lipo Bag Lipo-Safe Leão | 150 | estimate +10% | 165 | 4×15×25 | [referência](https://bunker81.com.br/product/prod_01KS8A4RG26EG1RQJCN2PS4726) |
| BNK-0048 | GREEN GAS 12kg COM SILICONE LEÃO | 520 | estimate +10% | 572 | 12×12×32 | [referência](https://armyairsoft.com.br/produto/green-gas-12-kg-com-silicone-leao/) |
| BNK-0044 | Maleta Pistola Desert Premium Tan | 450 | estimate +10% | 495 | 9×22×35 | [referência](https://www.bravusairsoft.com.br/maleta-leao-premium-desert) |
| BNK-0050 | Bateria LiPo Ultra Leão 7.4V/2S 250mAh 20C AEP | 60 | estimate +10% | 66 | 5×8×14 | [referência](https://www.leaob2b.com.br/catalog/product/view/id/2548/s/bateria-lipo-7-4v-2s-250mah-20c-pistola-airsoft-aep/category/95/) |
| BNK-0054 | Bateria LiPo Ultra Leão 11.1V/3S 900mAh 20C/40C XT60 | 90 | gross +0% | 90 | 6×10×25 | [referência](https://beartac.com.br/bateria-airsoft-lipo-ultra-11-1v-3s-900mah-20c-40c/) |
| BNK-0052 | Bateria LiPo Ultra Leão 11.1V/3S 1100mAh 20C/40C XT60 | 106 | gross +0% | 106 | 4×6×16 | [referência](https://www.leaob2b.com.br/bateria-lipo-ultra-11-1v-3s-1-pack-1100mah-20c-40c-xt60-airsoft.html) |
| BNK-0043 | Canivete Jararaca F067 LRW Rossi | 130 | net +10% | 143 | 5×10×16 | [referência](https://www.rossi.com.br/pt-br/produtos/40426/) |
| BNK-0051 | Bateria LiPo Ultra Leão 11.1V/3S 1100mAh 20C/40C Deans | 96 | gross +0% | 96 | 6×8×16 | [referência](https://www.leaob2b.com.br/catalog/product/view/id/2550/s/bateria-lipo-11-1v-3s-1-pack-1100mah-20c-40c-airsoft/category/95/airsoft-e-tiro-esportivo/airsoft-e-tiro-esportivo.html) |
| BNK-0046 | Óculos Tático Warmmo 3 Lentes | 200 | estimate +10% | 220 | 10×12×20 | [referência](https://bunker81.com.br/product/prod_01KS8A4RG2QD7HE4VXC31XEF6W) |
| BNK-0042 | Canivete Sucuri F121-2 Rossi | 160 | net +10% | 176 | 5×10×16 | [referência](https://www.rossi.com.br/pt-br/produtos/40427/) |
| BNK-0053 | Bateria LiPo Ultra Leão 11.1V/3S 1100mAh 20C/40C Tamiya | 96 | gross +0% | 96 | 6×8×16 | [referência](https://www.leaob2b.com.br/catalog/product/view/id/2550/s/bateria-lipo-11-1v-3s-1-pack-1100mah-20c-40c-airsoft/category/95/airsoft-e-tiro-esportivo/airsoft-e-tiro-esportivo.html) |
| BNK-0057 | Bateria LiPo Ultra Leão 11.1V/3S AK Series 1400mAh 25C/50C Mini Tamiya | 106 | gross +0% | 106 | 6×10×25 | [referência](https://www.leaob2b.com.br/airsoft-e-tiro-esportivo/baterias-carregadores/bateria-e-carregador/aeg/bateria-lipo-ultra-11-1v-3s-ak-series-1400mah-25c-50c-airsoft.html) |
| BNK-0055 | Bateria LiPo Ultra Leão 11.1V/3S 3-Pack 1100mAh 20C/40C Deans | 93 | gross +0% | 93 | 6×10×25 | [referência](https://www.leaob2b.com.br/bateria-lipo-11-1v-3s-3-pack-1100mah-20c-40c-airsoft.html) |
| BNK-0056 | Bateria LiPo Ultra Leão 11.1V/3S 3-Pack 1100mAh 20C/40C Tamiya | 93 | gross +0% | 93 | 6×10×25 | [referência](https://www.leaob2b.com.br/bateria-lipo-11-1v-3s-3-pack-1100mah-20c-40c-airsoft.html) |
| BNK-0059 | Luneta Rossi 1.2-6x24 LPVO | 335 | net +10% | 369 | 12×15×45 | [referência](https://www.rossi.com.br/pt-br/produtos/43201/) |
| BNK-0058 | Luneta Rossi Gold Crown 3-9x40EG | 850 | estimate +10% | 935 | 12×15×45 | [referência](https://bunker81.com.br/product/prod_01KW4KQ8MF35H5BYJ9X48AZE1M) |
| BNK-0062 | Red Dot Rossi 553 Black | 205 | net +10% | 226 | 10×15×20 | [referência](https://www.rossi.com.br/pt-br/produtos/43242/) |
| BNK-0060 | Red Dot Rossi 558 | 255 | net +10% | 281 | 10×15×20 | [referência](https://www.rossi.com.br/pt-br/produtos/43244/) |
| BNK-0064 | Red Dot Rossi ROMEO TAN | 150 | net +10% | 165 | 10×15×20 | [referência](https://www.rossi.com.br/pt-br/produtos/43211/) |
| BNK-0067 | Red Dot Rossi M1 | 400 | estimate +10% | 440 | 10×15×20 | [referência](https://bunker81.com.br/product/prod_01KW4KQ8MG4AB3ZFXKNGSXAR6M) |
| BNK-0065 | Red Dot Rossi ROMEO BK | 140 | net +10% | 154 | 10×15×20 | [referência](https://www.rossi.com.br/pt-br/produtos/43210/) |
| BNK-0066 | Red Dot Rossi 1x32C ACOG | 400 | estimate +10% | 440 | 10×15×20 | [referência](https://bunker81.com.br/product/prod_01KW4KQ8MG881PDNYP0MF4WKE2) |
| BNK-0071 | Luneta Rossi 4-16x42AO | 850 | estimate +10% | 935 | 12×15×45 | [referência](https://bunker81.com.br/product/prod_01KW4KQ8MGJEV63XMPJK080S59) |
| BNK-0070 | Luneta Rossi 6-24x42AO | 850 | estimate +10% | 935 | 12×15×45 | [referência](https://bunker81.com.br/product/prod_01KW4KQ8MGXREG0D3QMXAR3J73) |
| LEAO1535 | Bolsa anti-chama de carregar Bateria LiPo 20x10cm | 150 | estimate +10% | 165 | 4×15×25 | [referência](https://bunker81.com.br/product/prod_01KYYM3JWY1F5AAHKC27PZT636) |
| 25209420 | OLEO LUBRIFICANTE SHIELD 300ML ROSSI | 450 | estimate +10% | 495 | 10×10×25 | [referência](https://bunker81.com.br/product/prod_01M3WFB296PY97KYF7902P2R7W) |
| 25207900 | GREEN GAS PUFF DINO | 750 | estimate +10% | 825 | 12×12×32 | [referência](https://bunker81.com.br/product/prod_01M3WJHS2HYW2MEZ1KCMC529PX) |
| 25207902 | GREEN GAS PUFF DINO SEM SILICONE | 750 | estimate +10% | 825 | 12×12×32 | [referência](https://bunker81.com.br/product/prod_01M3YQ1S0J9EV40KFDDFWW6KD3) |
| 26201022 | COLETE MUDULAR PCR ROSSI | 1350 | estimate +10% | 1485 | 18×35×45 | [referência](https://www.rossi.com.br/pt-br/produtos/43497/) |
