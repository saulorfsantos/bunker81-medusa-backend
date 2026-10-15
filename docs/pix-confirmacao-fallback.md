# Confirmação de Pix quando a notificação falha

A consulta direta de pagamentos Pix ao Mercado Pago passa de cinco minutos para um minuto. A tela da loja consulta o estado no Medusa por até 90 segundos; o intervalo anterior podia ultrapassar essa janela mesmo com o pagamento aprovado.

A mudança reduz a espera pela rotina de recuperação. Não garante confirmação em até um minuto: aprovação no provedor, duração da execução, fila, indisponibilidade e pagamento realizado depois da janela do navegador ainda podem aumentar esse tempo. Não aumenta o prazo de consulta da tela.

O estado continua vindo da API autenticada do Mercado Pago e passa pelas validações existentes de identidade, valor e vínculo com a sessão. A assinatura dos webhooks continua obrigatória. Esta mudança não corrige nem contorna a rejeição de uma assinatura e não altera a chave configurada.

O mesmo job também confere Pix capturados sem pedido. Essa conferência passa a rodar uma vez por minuto, mantendo o período mínimo existente de dez minutos e os critérios existentes de compensação. A consulta percorre as sessões existentes; o trabalho por minuto aumenta em até cinco vezes em comparação com o agendamento anterior. Se o volume crescer, separar a recuperação rápida dos pendentes da varredura histórica é uma evolução necessária.

## Publicação e teste

Após revisão e merge manual, publicar o backend pelo processo habitual. Não há nova variável, migração ou alteração na loja. Confirmar nos logs que `Mercado Pago Pix reconciliation` roda uma vez por minuto.

Em um teste controlado, efetuar um único Pix com carrinho novo, conferir o estado no provedor, o mesmo pedido na loja e no PDV e medir o tempo de confirmação. Não repetir o pagamento de uma transação pendente. O teste de pagamento deve ser feito pelo responsável.

## Diagnóstico de 15/10/2026

Mantida a chave existente conforme orientação do usuário. No servidor, não foram encontrados espaços extras, aspas ou quebras de linha na chave. As notificações retidas têm assinatura com formato válido e identificadores coincidentes na URL e no corpo. Não foi encontrada regra do proxy que reescreva os cabeçalhos da assinatura. A comparação criptográfica continua falhando; a causa dessa divergência permanece não determinada. Nenhuma notificação retida foi reenviada e nenhum pagamento foi movimentado nesta investigação.
