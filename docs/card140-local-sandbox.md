# Card 140 — sandbox local descartável

Este ambiente existe apenas para validar infraestrutura e dados mínimos do fluxo BRL/Brasil. Ele não configura credenciais, não registra o provider Mercado Pago, não chama APIs externas e não cria pedido nem pagamento.

## Pré-requisitos

- Node.js 20 ou superior e `npm`;
- Docker com Compose para o smoke de runtime.

## Subir e preparar

```bash
cp .env.card140.example .env.card140.local
npm ci
npm run local:up
npm run local:prepare
```

`local:up` valida primeiro a configuração, sobe PostgreSQL e Redis vinculados apenas a `127.0.0.1` e então confirma a identidade do banco e executa `PING` no Redis. `local:prepare` aplica somente migrations locais, cria a fixture e roda `local:check-ids`. A fixture contém:

- store, região e moeda BRL/Brasil;
- as quatro categorias raiz consumidas pelo storefront;
- um produto sintético por categoria, sem imagens remotas;
- localização em São Paulo e estoque 25 por variante;
- zona de fulfillment brasileira;
- frete manual fixo de teste;
- provider de pagamento de sistema, sem Mercado Pago.

Para iniciar o backend depois da preparação:

```bash
npm run local:dev
```

## Paridade de IDs com o storefront

O storefront revisado fixa `BRAZIL_REGION_ID` e `MEDUSA_CATEGORY_IDS` em `src/lib/medusa.ts`. Se a fixture gerasse IDs próprios, storefront e backend funcionariam isoladamente mas a vitrine ficaria vazia e o carrinho impossível.

`src/local-sandbox/storefront-contract.ts` concentra esses identificadores públicos de catálogo — não são credenciais — e a fixture os fixa ao criar região e categorias. Isso é possível porque a propriedade `id` do DML é gerada por um hook `@BeforeCreate`/`@OnInit` que chama `generateEntityId(this.id, prefix)` e preserva qualquer valor já presente; nenhum SQL bruto ou reescrita de dados é usado.

Para conferir a paridade a qualquer momento:

```bash
npm run local:check-ids
```

O check falha fechado e verifica: região esperada com BRL/BR; as quatro categorias esperadas ativas, não internas e na raiz; ao menos um produto publicado com variante em cada categoria consumida; os SKUs sintéticos; níveis de estoque; criação de carrinho na região esperada com preço unitário em BRL; e opções de frete alcançáveis a partir da localização da fixture.

Se `src/lib/medusa.ts` mudar no storefront, atualize `storefront-contract.ts` — `npm run test:unit` compara os dois conjuntos de IDs e acusa a divergência antes de qualquer smoke com Docker.

## Fail-closed

O preflight aborta antes de o Medusa usar o banco quando encontrar valor ausente/`UNKNOWN`, `NODE_ENV=production`, banco/Redis/backend/CORS/storage remoto, database name diferente, porta divergente, Mercado Pago live, credencial Mercado Pago/S3/Melhor Envio, ou webhook remoto não autorizado.

Um túnel de webhook é aceito somente por HTTPS e somente quando seu hostname exato estiver listado em `CARD140_ALLOWED_WEBHOOK_HOSTS`. Isso não habilita Mercado Pago: token e webhook secret continuam obrigatoriamente vazios.

Execute apenas a classificação de configuração com:

```bash
npm run local:preflight:config
```

## Limpeza

```bash
npm run local:down
rm -rf static/card140
```

`local:down` remove containers, rede e volume PostgreSQL do projeto `bunker81-card140`; o Redis usa `tmpfs`. O segundo comando remove apenas uploads locais gerados nesse sandbox. Uma nova execução de `local:up` começa com banco vazio.
