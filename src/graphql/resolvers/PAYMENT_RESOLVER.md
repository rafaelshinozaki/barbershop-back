# PaymentResolver Documentation

## Overview
O `PaymentResolver` gerencia todo o sistema de pagamentos, incluindo consulta de pagamentos, métodos de pagamento, assinaturas, integrações com Stripe, processamento de pagamentos recorrentes e gestão de pagamentos em atraso.

## Localização
- **Arquivo**: `/back/src/graphql/resolvers/payment.resolver.ts`
- **Módulo**: GraphQLAppModule
- **Guards**: GraphQLJwtAuthGuard (aplicado globalmente na classe)

## Endpoints

### Queries

#### 1. `myPayments`
**Descrição**: Lista todos os pagamentos do usuário autenticado
```graphql
query MyPayments {
  myPayments {
    id
    subscriptionId
    amount
    paymentDate
    nextPaymentDate
    paymentMethod
    transactionId
    status
    createdAt
    updatedAt
  }
}
```

**Autenticação**: Requer `@UseGuards(GraphQLJwtAuthGuard)`

**Retorno**: `[Payment]` - Lista de pagamentos ordenada por data decrescente

**Campos Retornados**:
- `id`: ID do pagamento
- `subscriptionId`: ID da assinatura relacionada
- `amount`: Valor do pagamento (convertido para Number)
- `paymentDate`: Data do pagamento (ISO string)
- `nextPaymentDate`: Data do próximo pagamento (ISO string)
- `paymentMethod`: Método de pagamento usado
- `transactionId`: ID da transação
- `status`: Status do pagamento
- `createdAt/updatedAt`: Timestamps

**Fluxo de Negócio**:
1. Busca pagamentos pela assinatura do usuário
2. Inclui informações do plano relacionado
3. Ordena por data de pagamento decrescente
4. Converte tipos de dados (Decimal para Number, Date para ISO string)

---

#### 2. `mySubscriptions`
**Descrição**: Lista todas as assinaturas do usuário com pagamentos relacionados
```graphql
query MySubscriptions {
  mySubscriptions {
    id
    userId
    planId
    status
    startSubDate
    cancelationDate
    createdAt
    updatedAt
    plan {
      id
      name
      description
      price
      billingCycle
    }
    payments {
      id
      amount
      paymentDate
      status
    }
  }
}
```

**Autenticação**: Requer `@UseGuards(GraphQLJwtAuthGuard)`

**Retorno**: `[Subscription]` - Lista de assinaturas com planos e pagamentos

**Relações Incluídas**:
- `plan`: Informações completas do plano
- `payments`: Lista de pagamentos da assinatura

**Transformações**:
- Datas convertidas para ISO string
- Preços convertidos para Number
- Tratamento de campos nulos

---

#### 3. `myPaymentMethods`
**Descrição**: Lista métodos de pagamento salvos no Stripe
```graphql
query MyPaymentMethods {
  myPaymentMethods {
    id
    type
    card {
      brand
      last4
      expMonth
      expYear
    }
  }
}
```

**Autenticação**: Requer `@UseGuards(GraphQLJwtAuthGuard)`

**Retorno**: `[PaymentMethod]` - Métodos de pagamento do Stripe

**Fluxo de Negócio**:
1. Busca stripeCustomerId do usuário
2. Consulta métodos de pagamento no Stripe
3. Formata dados do cartão (se aplicável)
4. Retorna lista vazia se usuário não tem stripeCustomerId

**Integração**: Stripe API via `StripeService.listPaymentMethods()`

---

#### 4. `latestPendingPayment`
**Descrição**: Retorna o pagamento pendente mais recente
```graphql
query LatestPendingPayment {
  latestPendingPayment {
    id
    amount
    paymentDate
    status
    # ... outros campos
  }
}
```

**Autenticação**: Requer `@UseGuards(GraphQLJwtAuthGuard)`

**Retorno**: `Payment?` - Pagamento pendente mais recente ou null

**Critérios de Busca**:
- Status: 'PENDING' ou 'OPEN'
- Ordenação: Por data de pagamento decrescente
- Resultado: Primeiro resultado ou null

**Uso Comum**: Verificar se há pagamentos pendentes para retry

---

#### 5. `createSetupIntent`
**Descrição**: Cria Setup Intent para adicionar método de pagamento
```graphql
query CreateSetupIntent {
  createSetupIntent {
    clientSecret
    id
    status
  }
}
```

**Autenticação**: Requer `@UseGuards(GraphQLJwtAuthGuard)`

**Retorno**: `SetupIntent` - Setup Intent do Stripe

**Pré-requisitos**:
- Usuário deve ter `stripeCustomerId`
- Caso contrário: erro "User has no Stripe customer ID"

**Fluxo de Negócio**:
1. Valida se usuário tem stripeCustomerId
2. Cria Setup Intent no Stripe
3. Retorna client_secret para frontend

**Integração**: Stripe API via `StripeService.createSetupIntent()`

---

#### 6. `overduePayments`
**Descrição**: Lista pagamentos em atraso do usuário
```graphql
query OverduePayments {
  overduePayments {
    id
    amount
    nextPaymentDate
    daysOverdue
    # ... outros campos
  }
}
```

**Autenticação**: Requer `@UseGuards(GraphQLJwtAuthGuard)`

**Retorno**: `[Payment]` - Pagamentos em atraso com dias de atraso

**Critérios**:
- `nextPaymentDate <= hoje`
- `status = 'COMPLETED'`
- Ordenação: Por data de próximo pagamento crescente

**Campo Calculado**:
- `daysOverdue`: Dias desde a data de vencimento

**Uso**: Dashboard de pagamentos em atraso

---

#### 7. `recurringPaymentsStats`
**Descrição**: Estatísticas de pagamentos recorrentes do usuário
```graphql
query RecurringPaymentsStats {
  recurringPaymentsStats {
    overdueCount
    upcomingCount
    lastCheck
    timezone
    nextScheduledRun
    overduePayments {
      id
      planName
      amount
      daysOverdue
    }
    upcomingPayments {
      id
      planName
      amount
      daysUntilPayment
    }
  }
}
```

**Autenticação**: Requer `@UseGuards(GraphQLJwtAuthGuard)`

**Retorno**: `UserRecurringPaymentsStats` - Estatísticas completas

**Métricas Incluídas**:
- Contagem de pagamentos em atraso
- Contagem de pagamentos próximos (7 dias)
- Detalhes de cada pagamento
- Informações do sistema (timezone, próxima execução)

**Campos Calculados**:
- `daysOverdue`: Para pagamentos em atraso
- `daysUntilPayment`: Para pagamentos próximos

---

### Mutations

#### 1. `createPaymentIntent`
**Descrição**: Cria Payment Intent para checkout
```graphql
mutation CreatePaymentIntent($planId: Int!) {
  createPaymentIntent(planId: $planId) {
    clientSecret
    paymentIntentId
  }
}
```

**Autenticação**: Requer `@UseGuards(GraphQLJwtAuthGuard)`

**Parâmetros**:
- `planId: Int!` - ID do plano para pagamento

**Retorno**: `PaymentIntentResponse`

**Fluxo de Negócio**:
1. Valida plano existe
2. Cria Payment Intent via `PaymentsService`
3. Retorna client_secret para pagamento

**Integração**: `PaymentsService.createPaymentIntentForCheckout()`

**Erros Comuns**:
- Plano não encontrado
- Usuário sem Stripe customer ID
- Erro na criação do Payment Intent

---

#### 2. `confirmPaymentIntent`
**Descrição**: Confirma pagamento e cria assinatura
```graphql
mutation ConfirmPaymentIntent($paymentIntentId: String!) {
  confirmPaymentIntent(paymentIntentId: $paymentIntentId) {
    success
    subscription {
      id
      status
      plan {
        id
        name
        price
      }
    }
  }
}
```

**Autenticação**: Requer `@UseGuards(GraphQLJwtAuthGuard)`

**Parâmetros**:
- `paymentIntentId: String!` - ID do Payment Intent

**Retorno**: `ConfirmPaymentIntentResponse`

**Fluxo de Negócio**:
1. Confirma pagamento no Stripe
2. Cria/atualiza assinatura
3. Busca informações do plano
4. Retorna resultado com assinatura

**Integração**: `PaymentsService.confirmPaymentIntent()`

---

#### 3. `deletePaymentMethod`
**Descrição**: Remove método de pagamento
```graphql
mutation DeletePaymentMethod($paymentMethodId: String!) {
  deletePaymentMethod(paymentMethodId: $paymentMethodId) {
    success
    message
  }
}
```

**Autenticação**: Requer `@UseGuards(GraphQLJwtAuthGuard)`

**Parâmetros**:
- `paymentMethodId: String!` - ID do método no Stripe

**Retorno**: `DeletePaymentMethodResponse`

**Validações**:
- Método deve pertencer ao usuário
- Método deve existir no Stripe

**Integração**: `PaymentsService.deletePaymentMethod()`

---

#### 4. `processRecurringPayment`
**Descrição**: Força processamento de pagamento recorrente
```graphql
mutation ProcessRecurringPayment($paymentId: Int!) {
  processRecurringPayment(paymentId: $paymentId) {
    success
    message
    processedAt
  }
}
```

**Autenticação**: Requer `@UseGuards(GraphQLJwtAuthGuard)`

**Parâmetros**:
- `paymentId: Int!` - ID do pagamento

**Retorno**: `ProcessRecurringPaymentResponse`

**Fluxo de Negócio**:
1. Valida se pagamento pertence ao usuário
2. Força processamento via PaymentsService
3. Retorna resultado com timestamp

**Integração**: `PaymentsService.forceRecurringPayment()`

**Casos de Uso**:
- Retry manual de pagamento falhou
- Processamento sob demanda

---

#### 5. `processAllRecurringPayments`
**Descrição**: Processa todos os pagamentos recorrentes pendentes
```graphql
mutation ProcessAllRecurringPayments {
  processAllRecurringPayments {
    success
    message
    processedAt
    processedCount
  }
}
```

**Autenticação**: Requer `@UseGuards(GraphQLJwtAuthGuard)`

**Retorno**: `ProcessAllRecurringPaymentsResponse`

**Fluxo de Negócio**:
1. Executa job de processamento recorrente
2. Processa todos os pagamentos elegíveis
3. Retorna estatísticas

**Integração**: `PaymentsService.processRecurringPayments()`

**⚠️ Nota**: Processa para todos os usuários, não apenas o autenticado

---

## Integração com Serviços

### Serviços Utilizados
- **PrismaService**: Acesso direto ao banco de dados
- **StripeService**: Integração com Stripe API
- **PaymentsService**: Lógica de negócio de pagamentos

### Integrações Stripe
- **Setup Intents**: Para adicionar métodos de pagamento
- **Payment Intents**: Para processar pagamentos únicos
- **Payment Methods**: Gerenciamento de cartões salvos
- **Customers**: Associação de usuários com customers

### Banco de Dados
- **Tabelas principais**: Payment, Subscription, Plan, User
- **Relacionamentos**: Payment -> Subscription -> User/Plan
- **Queries otimizadas**: Uso de include para relações

---

## Transformação de Dados

### Conversões Aplicadas
```typescript
// Decimais para Numbers
amount: Number(payment.amount)

// Dates para ISO strings  
paymentDate: payment.paymentDate.toISOString()

// Campos calculados
daysOverdue: Math.floor((now - paymentDate) / (1000 * 60 * 60 * 24))
```

### Tratamento de Nulls
- Dados opcionais tratados com `?.`
- Fallbacks para campos obrigatórios
- Valores padrão para timestamps

---

## Fluxos de Pagamento

### Checkout de Plano
1. `createPaymentIntent(planId)` - Criar intenção
2. Frontend processa pagamento com Stripe
3. `confirmPaymentIntent(paymentIntentId)` - Confirmar
4. Sistema cria assinatura ativa

### Adicionar Método de Pagamento
1. `createSetupIntent()` - Criar setup
2. Frontend coleta dados do cartão
3. Stripe confirma e salva método
4. `myPaymentMethods` - Listar métodos atualizados

### Pagamento Recorrente
1. Job automático identifica pagamentos devidos
2. `processAllRecurringPayments()` ou manual por ID
3. Sistema cobra via Stripe
4. Atualiza status e próxima data

---

## Segurança

### Autenticação e Autorização
- **GraphQLJwtAuthGuard**: Todas as operações requerem autenticação
- **Isolamento de dados**: Usuários acessam apenas seus próprios pagamentos
- **Validação de propriedade**: Verificações de userId em queries

### Validações de Negócio
- Existência de stripeCustomerId antes de operações
- Validação de planos válidos
- Verificação de métodos de pagamento pertencentes ao usuário

### Integração Segura com Stripe
- Uso de client_secret para operações frontend
- Validação de payment intents no backend
- Gerenciamento seguro de customer IDs

---

## Tratamento de Erros

### Erros Comuns
| Cenário | Erro | Tratamento |
|---------|------|------------|
| Usuário sem Stripe ID | "User has no Stripe customer ID" | Criar customer primeiro |
| Payment Intent inválido | "Invalid payment intent" | Validar ID e status |
| Método não encontrado | "Payment method not found" | Verificar existência |
| Falha na cobrança | "Payment failed" | Log e retry automático |

### Logging
- Todas as operações são logadas com userId
- Erros incluem stack trace e contexto
- Métricas de performance para operações Stripe

---

## Casos de Uso Comuns

### Dashboard de Pagamentos
```typescript
// Buscar dados para dashboard
const payments = await myPayments();
const stats = await recurringPaymentsStats();
const overdue = await overduePayments();
```

### Checkout de Assinatura
```typescript
// Fluxo completo de checkout
const { clientSecret } = await createPaymentIntent({ planId });
// ... processamento frontend
const { success, subscription } = await confirmPaymentIntent({ paymentIntentId });
```

### Gerenciar Métodos de Pagamento
```typescript
// Listar e gerenciar métodos
const methods = await myPaymentMethods();
await deletePaymentMethod({ paymentMethodId });
```

### Processar Pagamentos Manuais
```typescript
// Para pagamentos em atraso
const overdue = await overduePayments();
await processRecurringPayment({ paymentId: overdue[0].id });
```

---

## Problemas Conhecidos

### 🟡 Melhorias Sugeridas
- Implementar cache para métodos de pagamento
- Adicionar retry automático para falhas temporárias
- Melhorar tratamento de webhooks Stripe
- Implementar notificações de pagamento
- Adicionar métricas de performance

### 📊 Monitoramento Recomendado
- Taxa de sucesso de pagamentos
- Tempo de resposta das operações Stripe
- Pagamentos em atraso por usuário
- Volume de transações processadas
- Falhas de integração com Stripe

---

## Performance

### Otimizações Implementadas
- Uso de `include` para buscar relações em uma query
- Índices no banco para queries frequentes
- Transformação de dados no resolver

### Recomendações
- Cache para dados de planos (raramente mudam)
- Paginação para listas grandes de pagamentos
- Batch processing para operações em massa