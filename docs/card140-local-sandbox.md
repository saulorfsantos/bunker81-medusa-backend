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

`local:up` valida primeiro a configuração, sobe PostgreSQL e Redis vinculados apenas a `127.0.0.1` e então confirma a identidade do banco e executa `PING` no Redis. `local:prepare` aplica somente migrations locais e cria uma fixture com:

- store, região e moeda BRL/Brasil;
- localização em São Paulo e estoque 25;
- zona de fulfillment brasileira;
- frete manual fixo de teste;
- um produto local sem imagens remotas;
- provider de pagamento de sistema, sem Mercado Pago.

Para iniciar o backend depois da preparação:

```bash
npm run local:dev
```

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
