# Melhor Envio sandbox: cotação no checkout

Esta fase chama somente `POST https://sandbox.melhorenvio.com.br/api/v2/me/shipment/calculate`. Nenhuma etiqueta é comprada ou criada. O provider recusa operações de fulfillment.

## Configuração server-side

Configure no secret store, sem enviar valores pelo chat ou ao storefront:

- `MELHOR_ENVIO_ENV=sandbox`
- `MELHOR_ENVIO_ACCESS_TOKEN`
- `MELHOR_ENVIO_USER_AGENT` com nome da aplicação e email técnico
- `MELHOR_ENVIO_ORIGIN_POSTAL_CODE=50610545`
- `MELHOR_ENVIO_SERVICE_IDS`: IDs numéricos de serviços obtidos de uma resposta de cotação sandbox, separados por vírgula. Confirme o par ID, transportadora e nome na resposta; não deduza o ID pelo nome.

O catálogo só é usado com peso, altura, largura e comprimento positivos em **todas** as variantes do carrinho, valor unitário positivo e unidades explícitas em `MELHOR_ENVIO_CATALOG_WEIGHT_UNIT=g|kg` e `MELHOR_ENVIO_CATALOG_DIMENSION_UNIT=mm|cm`. O código converte para kg e cm. A fonte versionada não comprova esses campos no catálogo online.

Se não houver medidas confiáveis para a demonstração, ative explicitamente `MELHOR_ENVIO_DEMO_FALLBACK_ENABLED=true` e informe `MELHOR_ENVIO_DEMO_WEIGHT_KG`, `MELHOR_ENVIO_DEMO_HEIGHT_CM`, `MELHOR_ENVIO_DEMO_WIDTH_CM`, `MELHOR_ENVIO_DEMO_LENGTH_CM`. Nesse caso a cotação usa um único volume fictício para o carrinho inteiro e marca `quote_metadata.source=demo_volume`. Nunca ative isso fora do sandbox. `MELHOR_ENVIO_ENV=production` é recusado neste release.

## Vincular opções no Medusa Admin

O código registra `melhor-envio_melhor-envio` junto do provider existente `manual_manual`. O registro do provider não cria shipping options automaticamente. Na mesma stock location, service zone brasileira e shipping profile da retirada existente, associe o novo provider e crie **uma shipping option calculada por serviço** configurado. Escolha no seletor a opção `service-<ID>` correspondente e dê a ela um nome confirmado pela resposta sandbox, por exemplo `Correios PAC`. Habilite na loja. Não altere nem remova a opção de retirada manual de R$ 0.

O storefront continua usando `listShippingOptions(cart.id)` e `selectShippingOption(cart.id, option.id)`. Opções calculadas aparecem como “Calculado ao aplicar” na UI atual; a seleção chama o provider, grava o método e atualiza os totais do carrinho. Medusa pode recalcular o preço após alterações do carrinho. O provider sempre consulta uma cotação nova e nunca aceita preço ou ID de serviço enviados pelo browser. Se a API estiver fora do ar, somente a opção calculada pode falhar; a opção manual segue independente.

Antes da demonstração, faça uma inspeção somente leitura no Admin ou via Query para confirmar o provider, o fulfillment set, a service zone, a retirada e as medidas reais do catálogo. Este repositório não contém os registros do banco online. Não execute o seed de exemplo: ele cria opções genéricas para uma zona europeia.

## E2E depois da configuração

Com um carrinho BRL válido, endereço brasileiro e CEP de destino `01001000`, confirme que a API retorna ao menos um serviço com preço positivo. Confira que a retirada permanece em R$ 0, selecione uma opção do Melhor Envio, recupere o carrinho e confira `shipping_methods`, `shipping_total` e `total`. Depois selecione retirada e confira `shipping_total=0`. Não complete pedido de teste que possa criar custo e não execute rotas de etiqueta.

Referências oficiais: [cotação por produtos e volumes](https://docs.melhorenvio.com.br/reference/calculo-de-fretes-por-produtos), [shipping options calculadas do Medusa](https://docs.medusajs.com/resources/commerce-modules/fulfillment/shipping-option), [fluxo de frete no checkout](https://docs.medusajs.com/resources/storefront-development/checkout/shipping).
