# Captura automática de cartão

A autorização do cartão continua ocorrendo antes da criação do pedido, com `capture: false`. Após `order.placed`, o backend consulta o pedido persistido e captura exclusivamente pagamentos `pp_mercadopago-card_mercadopago` pelo `capturePaymentWorkflow` nativo. Isso atualiza provedor, pagamento, transação do pedido e evento de captura.

## Ativação depois de revisar e fazer merge

No serviço Medusa do EasyPanel, definir `MERCADO_PAGO_AUTO_CAPTURE_FROM` com o instante de ativação em UTC, no formato `AAAA-MM-DDTHH:mm:ssZ`. Usar o horário atual no momento da implantação, não copiar uma data antiga. `REDIS_URL` deve estar configurado; o bloqueio distribuído usa o Redis existente.

Sem essa variável a automação fica desligada. A data é um limite inferior para a criação do pedido: pedidos históricos, incluindo testes anteriores, não são capturados por essa rotina. Não retroagir a data para cobrar pedidos antigos; revisar esses pedidos individualmente no painel.

Depois, publicar o backend. Não há migração de banco. Remover a variável e reiniciar desliga novas tentativas automáticas; uma captura já enviada ao provedor pode concluir e não é desfeita pela desativação.

## Comportamento e recuperação

- Pedidos cancelados, rascunhos e anteriores à ativação são ignorados.
- Pix, pagamentos manuais, pagamentos cancelados, capturas anteriores (inclusive parciais) e estornos são ignorados.
- Evento e recuperação usam o mesmo bloqueio Redis por pedido e consultam o estado novamente dentro dele.
- Erros do assinante voltam para as tentativas da fila. Um job a cada dois minutos procura cartões ainda não capturados criados nas últimas 24 horas e depois da ativação, sempre com vínculo único a um pedido existente.
- Não captura pagamentos órfãos. Falhas persistentes e autorizações com mais de 24 horas precisam de conferência no painel; permanecem sem valor recebido no PDV.
- Mensagens de log incluem IDs internos, nunca dados do cartão, token ou resposta bruta do provedor.

## Validação após publicar

1. Entrar na conta do cliente antes de criar um novo carrinho e realizar uma compra de baixo valor em cartão, uma vez.
2. Confirmar que o pedido passa de autorizado para pago sem clicar em Capturar no Medusa. Conferir uma única cobrança no Mercado Pago/cartão.
3. Confirmar o mesmo número do pedido em Minha conta, Vendas e Entregas; abrir detalhes e conferir itens, valor e estoque.
4. Se a primeira captura falhar por indisponibilidade transitória, conferir a recuperação em até dois minutos. Não repetir a compra enquanto a primeira transação estiver pendente.
5. Validar cancelamento e estorno em teste controlado operado pelo responsável e conferir os totais do PDV.

Não executar o subscriber/job manualmente em produção como teste. Testes unitários usam mocks, e a compilação local não movimenta dinheiro. Esta mudança não corrige a assinatura dos webhooks: essa configuração deve ser validada separadamente.
