# Sistema de Cobrança Recorrente - Relable

## Visão Geral

O sistema de cobrança recorrente do Relable foi implementado para processar automaticamente pagamentos mensais e anuais dos usuários, garantindo a continuidade dos serviços sem intervenção manual.

## Como Funciona

### 1. Cron Jobs Automáticos

O sistema utiliza cron jobs do NestJS para executar tarefas programadas:

- **Diário às 9h (America/Sao_Paulo)**: Processa cobranças recorrentes
- **A cada 6 horas**: Verifica pagamentos vencidos
- **Semanal**: Executa manutenção e limpeza

### 2. Processo de Cobrança

1. **Identificação**: O sistema busca pagamentos com `nextPaymentDate` vencida
2. **Validação**: Verifica se o usuário tem `stripeCustomerId` configurado
3. **Cobrança**: Tenta cobrar automaticamente via Stripe
4. **Processamento**: Atualiza status e envia notificações por email

### 3. Ciclos de Cobrança

- **MONTHLY**: Cobrança a cada 30 dias
- **YEARLY**: Cobrança a cada 365 dias

## Estrutura do Código

### Serviços Principais

#### `PaymentsService`

- `processRecurringPayments()`: Método principal para processar cobranças
- `processRecurringPayment()`: Processa uma cobrança específica
- `handleSuccessfulRecurringPayment()`: Gerencia pagamentos bem-sucedidos
- `handlePaymentFailure()`: Gerencia falhas de pagamento
- `getOverduePayments()`: Lista pagamentos vencidos
- `forceRecurringPayment()`: Força processamento manual

#### `RecurringPaymentsService`

- Gerencia cron jobs automáticos
- Fornece métodos para execução manual
- Coleta estatísticas do sistema

### Endpoints da API

#### Processamento

- `POST /payments/recurring/process`: Executa processamento manual
- `POST /payments/recurring/force/:paymentId`: Força processamento específico

#### Consultas

- `GET /payments/recurring/overdue`: Lista pagamentos vencidos
- `GET /payments/recurring/stats`: Estatísticas do sistema

## Templates de Email

### Sucesso (`recurring_payment_success.hbs`)

- Confirmação de pagamento processado
- Detalhes da transação
- Data do próximo pagamento

### Falha (`recurring_payment_failed.hbs`)

- Notificação de falha
- Instruções para resolver
- Link para atualizar método de pagamento

## Configuração

### Variáveis de Ambiente

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### Timezone

O sistema está configurado para usar `America/Sao_Paulo` para todos os cron jobs.

## Monitoramento

### Logs

O sistema gera logs detalhados para:

- Início e fim de processamento
- Pagamentos processados com sucesso
- Falhas e erros
- Estatísticas de execução

### Métricas

- Número de pagamentos vencidos
- Taxa de sucesso
- Usuários sem método de pagamento
- Próximos pagamentos programados

## Testes

### Script de Teste

Execute o script para verificar o estado do sistema:

```bash
node scripts/test-recurring-payments.js
```

### Teste Manual

```bash
# Processar cobranças manualmente
curl -X POST http://localhost:3000/payments/recurring/process

# Ver estatísticas
curl http://localhost:3000/payments/recurring/stats
```

## Fluxo de Pagamento

### Pagamento Bem-sucedido

1. ✅ Cobrança processada via Stripe
2. ✅ Novo registro de pagamento criado
3. ✅ Status do usuário atualizado para `PAID`
4. ✅ Email de confirmação enviado
5. ✅ Próxima data de pagamento calculada

### Pagamento Falhado

1. ❌ Falha na cobrança via Stripe
2. ❌ Status do usuário atualizado para `PAST_DUE`
3. ❌ Assinatura marcada como `INACTIVE`
4. ❌ Email de notificação enviado
5. ❌ Usuário precisa atualizar método de pagamento

## Manutenção

### Limpeza Semanal

- Remove logs antigos
- Backup de dados importantes
- Verificação de integridade

### Monitoramento Contínuo

- Verificação de pagamentos vencidos a cada 6h
- Alertas para falhas críticas
- Relatórios de performance

## Troubleshooting

### Problemas Comuns

#### Usuário sem Stripe Customer ID

- **Sintoma**: Log "Usuário não possui stripeCustomerId"
- **Solução**: Usuário precisa configurar método de pagamento

#### Falha na Cobrança

- **Sintoma**: Log "Pagamento falhou com status: [status]"
- **Solução**: Verificar cartão, saldo, ou dados de pagamento

#### Cron Job não Executa

- **Sintoma**: Nenhum log de processamento
- **Solução**: Verificar configuração do ScheduleModule

### Logs Importantes

```
🔄 Iniciando cron job de cobranças recorrentes...
📊 Encontrados X pagamentos vencidos para processar
✅ Pagamento recorrente processado com sucesso para usuário X
❌ Erro ao processar cobrança para usuário X
```

## Segurança

### Validações

- Verificação de assinatura ativa
- Validação de dados do usuário
- Proteção contra cobranças duplicadas

### Auditoria

- Logs detalhados de todas as operações
- Rastreamento de transações
- Histórico de tentativas de cobrança

## Próximos Passos

### Melhorias Planejadas

- [ ] Retry automático para falhas temporárias
- [ ] Notificações push para falhas críticas
- [ ] Dashboard de monitoramento em tempo real
- [ ] Integração com sistemas de alerta
- [ ] Relatórios avançados de receita

### Configurações Avançadas

- [ ] Configuração de horários de cobrança
- [ ] Diferentes estratégias de retry
- [ ] Integração com múltiplos gateways
- [ ] Suporte a diferentes moedas
