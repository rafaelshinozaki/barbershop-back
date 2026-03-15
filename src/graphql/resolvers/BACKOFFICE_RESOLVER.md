# BackofficeResolver Documentation

## Overview
O `BackofficeResolver` oferece funcionalidades administrativas completas, incluindo dashboards executivos, análises estatísticas, gerenciamento de usuários em massa, relatórios de pagamentos, processamento de pagamentos recorrentes e ferramentas de comunicação administrativa.

## Localização
- **Arquivo**: `/back/src/graphql/resolvers/backoffice.resolver.ts`
- **Módulo**: GraphQLAppModule
- **Guards**: GraphQLJwtAuthGuard, GraphQLRolesGuard (todas operações requerem admin)

## ⚠️ PROBLEMAS DE SEGURANÇA IDENTIFICADOS

### 🔴 CRÍTICO: Endpoints sem Autenticação
- **`allRecurringPaymentsStats`** (linha 287): Query sem guards de autenticação
- **`allOverduePayments`** (linha 410): Query sem guards de autenticação  
- **`processAllRecurringPaymentsAdmin`** (linha 524): Mutation sem guards de autenticação
- **`processRecurringPaymentAdmin`** (linha 547): Mutation sem guards de autenticação
- **`allCompletedPayments`** (linha 570): Query sem guards de autenticação

**Risco**: Qualquer usuário pode acessar dados sensíveis de pagamentos e executar operações críticas.

## Endpoints

### Queries de Dashboard

#### 1. `backofficeStats`
**Descrição**: Estatísticas gerais do sistema
```graphql
query BackofficeStats {
  backofficeStats {
    totalUsers
    activeUsers
    inactiveUsers
    newUsersThisMonth
    newUsersThisWeek
    totalRevenue
    monthlyRevenue
    activeSubscriptions
  }
}
```

**Autenticação**: `@UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)`
**Roles**: `@Roles(Role.ADMIN, Role.SYSTEM_ADMIN, Role.MANAGER)`

**Retorno**: `BackofficeStats` - Métricas principais do sistema

**Métricas Incluídas**:
- Contadores de usuários (total, ativo, inativo)
- Crescimento (novos usuários mensal/semanal)
- Revenue total e mensal
- Assinaturas ativas

---

#### 2. `userGrowthData`
**Descrição**: Dados de crescimento de usuários para gráficos
```graphql
query UserGrowthData {
  userGrowthData {
    labels
    data
    datasets {
      label
      data
      backgroundColor
      borderColor
    }
  }
}
```

**Autenticação**: Requer roles admin
**Retorno**: `UserGrowthData` - Dados formatados para gráficos

**Uso**: Gráficos de linha temporal de crescimento

---

#### 3. `roleDistribution`
**Descrição**: Distribuição de usuários por role
```graphql
query RoleDistribution {
  roleDistribution {
    labels
    data
    total
  }
}
```

**Autenticação**: Requer roles admin
**Retorno**: `RoleDistribution` - Contagem por papel de usuário

---

#### 4. `statusDistribution`
**Descrição**: Distribuição de usuários por status (ativo/inativo)
```graphql
query StatusDistribution {
  statusDistribution {
    labels
    data
    total
  }
}
```

**Autenticação**: Requer roles admin
**Retorno**: `StatusDistribution` - Contagem por status

---

#### 5. `planDistribution`
**Descrição**: Distribuição de usuários por plano
```graphql
query PlanDistribution {
  planDistribution {
    labels
    data
    total
    revenue
  }
}
```

**Autenticação**: Requer roles admin
**Retorno**: `PlanDistribution` - Contagem e revenue por plano

---

#### 6. `geographicAnalysis`
**Descrição**: Análise geográfica de usuários
```graphql
query GeographicAnalysis {
  geographicAnalysis {
    byState {
      state
      count
      percentage
    }
    byCity {
      city
      state
      count
    }
    total
  }
}
```

**Autenticação**: Requer roles admin
**Retorno**: `GeographicAnalysis` - Distribuição geográfica

---

#### 7. `demographicAnalysis`
**Descrição**: Análise demográfica (idade, gênero)
```graphql
query DemographicAnalysis {
  demographicAnalysis {
    byAge {
      ageRange
      count
      percentage
    }
    byGender {
      gender
      count
      percentage
    }
    averageAge
    totalAnalyzed
  }
}
```

**Autenticação**: Requer roles admin
**Retorno**: `DemographicAnalysis` - Dados demográficos

---

#### 8. `professionalSegmentAnalysis`
**Descrição**: Análise por segmento profissional
```graphql
query ProfessionalSegmentAnalysis {
  professionalSegmentAnalysis {
    bySegment {
      segment
      count
      percentage
    }
    total
  }
}
```

**Autenticação**: Requer roles admin
**Retorno**: `ProfessionalSegmentAnalysis`

**Logging**: Inclui logging detalhado para debug

---

#### 9. `companyAnalysis`
**Descrição**: Análise por empresas e tamanhos
```graphql
query CompanyAnalysis {
  companyAnalysis {
    byCompanySize {
      size
      count
      percentage
    }
    topCompanies {
      company
      count
    }
    total
  }
}
```

**Autenticação**: Requer roles admin
**Retorno**: `CompanyAnalysis` - Distribuição por empresa

---

#### 10. `usersDetailed`
**Descrição**: Lista detalhada de usuários com filtros e paginação
```graphql
query UsersDetailed($filters: UsersDetailedFilters!) {
  usersDetailed(filters: $filters) {
    data {
      id
      email
      firstName
      lastName
      role
      isActive
      createdAt
      lastLoginAt
      # ... mais campos
    }
    total
    page
    limit
    totalPages
  }
}
```

**Autenticação**: Requer roles admin

**Parâmetros** (`UsersDetailedFilters`):
- `page: Int` (padrão: 1) - Página atual
- `limit: Int` (padrão: 20) - Itens por página
- `search: String` - Busca por nome/email
- `role: String` - Filtro por papel
- `isActive: Boolean` - Filtro por status
- `createdAfter: Date` - Usuários criados após data
- `createdBefore: Date` - Usuários criados antes da data

**Retorno**: `DetailedUsersResponse` - Lista paginada

---

#### 11. `backofficeDashboard`
**Descrição**: Dashboard consolidado com todas as métricas principais
```graphql
query BackofficeDashboard {
  backofficeDashboard {
    stats { ... }
    userGrowth { ... }
    roleDistribution { ... }
    statusDistribution { ... }
    planDistribution { ... }
  }
}
```

**Autenticação**: Requer roles admin

**Otimização**: Executa todas as queries em paralelo com `Promise.all`

**Logging**: Inclui logging estruturado das métricas

---

### Queries de Pagamentos (⚠️ SEM GUARDS)

#### 12. `allRecurringPaymentsStats`
**Descrição**: Estatísticas globais de pagamentos recorrentes
```graphql
query AllRecurringPaymentsStats {
  allRecurringPaymentsStats {
    overdueCount
    upcomingCount
    lastCheck
    overduePayments {
      id
      userId
      userEmail
      planName
      amount
      daysOverdue
    }
    upcomingPayments {
      id
      userId
      userEmail
      planName
      amount
      daysUntilPayment
    }
  }
}
```

**⚠️ PROBLEMA**: **SEM GUARDS DE AUTENTICAÇÃO**

**Retorno**: `[AdminRecurringPaymentsStats]` - Dados sensíveis de todos os usuários

---

#### 13. `allOverduePayments`
**Descrição**: Lista todos os pagamentos em atraso com filtros
```graphql
query AllOverduePayments($filters: OverduePaymentsFilters) {
  allOverduePayments(filters: $filters) {
    id
    userId
    userEmail
    userName
    planName
    amount
    daysOverdue
    hasStripeCustomer
  }
}
```

**⚠️ PROBLEMA**: **SEM GUARDS DE AUTENTICAÇÃO**

**Parâmetros** (`OverduePaymentsFilters`):
- `user: String` - Filtro por nome/email do usuário
- `plan: String` - Filtro por nome do plano
- `nextPaymentDateMonth: String` - Filtro por mês (YYYY-MM)
- `paymentMethod: String` - Filtro por método de pagamento

**Retorno**: `[OverduePaymentDetail]` - Informações sensíveis

---

#### 14. `allCompletedPayments`
**Descrição**: Lista paginada de pagamentos completados com filtros
```graphql
query AllCompletedPayments($filters: CompletedPaymentsFilters!) {
  allCompletedPayments(filters: $filters) {
    data {
      id
      userId
      userEmail
      userName
      planName
      amount
      paymentDate
      paymentMethod
      transactionId
    }
    total
    page
    totalPages
  }
}
```

**⚠️ PROBLEMA**: **SEM GUARDS DE AUTENTICAÇÃO**

**Debugging Extensivo**: Inclui logging detalhado para troubleshooting

---

### Mutations Administrativas

#### 1. `bulkUserAction`
**Descrição**: Executa ações em lote em usuários
```graphql
mutation BulkUserAction($input: BulkUserAction!) {
  bulkUserAction(input: $input)
}
```

**Autenticação**: Requer roles admin

**Parâmetros** (`BulkUserAction`):
- `action: String!` - Ação: "activate", "deactivate", "changePlan"
- `userIds: [Int!]!` - Lista de IDs dos usuários
- `plan: String` - Nome do plano (para changePlan)

**Ações Disponíveis**:
- `activate`: Ativar usuários
- `deactivate`: Desativar usuários
- `changePlan`: Alterar plano de usuários

**Retorno**: `Boolean` - Status da operação

---

#### 2. `setUserActive`
**Descrição**: Ativa/desativa usuário individual
```graphql
mutation SetUserActive($userId: Int!, $active: Boolean!) {
  setUserActive(userId: $userId, active: $active)
}
```

**Autenticação**: Requer roles admin

**Delegação**: Chama `UserService.setUserActive()`

---

#### 3. `changeUserPlan`
**Descrição**: Altera plano de usuário específico
```graphql
mutation ChangeUserPlan($userId: Int!, $plan: String!) {
  changeUserPlan(userId: $userId, plan: $plan)
}
```

**Autenticação**: Requer roles admin

**Delegação**: Chama `UserService.changeUserPlan()`

---

#### 4. `updateUser`
**Descrição**: Atualiza dados completos de usuário
```graphql
mutation UpdateUser($input: UpdateUserByAdminInput!) {
  updateUser(input: $input)
}
```

**Autenticação**: Requer roles admin

**Parâmetros** (`UpdateUserByAdminInput`):
- `userId: Int!` - ID do usuário
- `email: String` - Novo email
- `fullName: String` - Nome completo
- `phone: String` - Telefone
- `birthdate: String` - Data de nascimento
- `company: String` - Empresa
- `professionalSegment: String` - Segmento profissional
- `gender: String` - Gênero
- `isActive: Boolean` - Status ativo
- `twoFactorEnabled: Boolean` - 2FA habilitado

**Transformação**: Converte input GraphQL para UserDTO

---

#### 5. `removeUser`
**Descrição**: Remove usuário do sistema
```graphql
mutation RemoveUser($userId: Int!) {
  removeUser(userId: $userId)
}
```

**Autenticação**: Requer roles admin

**Comportamento**: Soft delete via `UserService.removeUser()`

---

#### 6. `sendEmailNotification`
**Descrição**: Envia notificação por email
```graphql
mutation SendEmailNotification($input: SendEmailNotificationInput!) {
  sendEmailNotification(input: $input)
}
```

**Autenticação**: Requer roles admin

**Integração**: `BackofficeService.sendEmailNotification()`

---

### Mutations de Pagamentos (⚠️ SEM GUARDS)

#### 7. `processAllRecurringPaymentsAdmin`
**Descrição**: Processa todos os pagamentos recorrentes pendentes
```graphql
mutation ProcessAllRecurringPaymentsAdmin {
  processAllRecurringPaymentsAdmin {
    success
    message
    processedAt
    processedCount
  }
}
```

**⚠️ PROBLEMA**: **SEM GUARDS DE AUTENTICAÇÃO**

**Risco**: Qualquer usuário pode disparar processamento global de pagamentos

---

#### 8. `processRecurringPaymentAdmin`
**Descrição**: Força processamento de pagamento específico
```graphql
mutation ProcessRecurringPaymentAdmin($paymentId: Int!) {
  processRecurringPaymentAdmin(paymentId: $paymentId) {
    success
    message
    processedAt
  }
}
```

**⚠️ PROBLEMA**: **SEM GUARDS DE AUTENTICAÇÃO**

**Risco**: Qualquer usuário pode forçar processamento de qualquer pagamento

---

### Queries de Auditoria

#### `emailHistory`
**Descrição**: Histórico de emails enviados
```graphql
query EmailHistory($filters: EmailHistoryFilters!) {
  emailHistory(filters: $filters) {
    data {
      id
      to
      subject
      sentAt
      status
    }
    total
    page
    totalPages
  }
}
```

**Autenticação**: Requer roles admin

---

## Integração com Serviços

### Serviços Utilizados
- **BackofficeService**: Análises e estatísticas
- **UserService**: Gerenciamento de usuários
- **PrismaService**: Acesso direto ao banco (para pagamentos)
- **PaymentsService**: Processamento de pagamentos
- **SmartLogger**: Logging estruturado

### Padrões de Implementação
- **Service delegation**: Maioria das operações delegadas para serviços
- **Batch operations**: Operações em lote otimizadas
- **Parallel execution**: Dashboard usa Promise.all
- **Structured logging**: Logging detalhado para operações críticas

---

## Análises Estatísticas

### Cálculo de Idade
```typescript
private calculateAge(birthdate: Date): number {
  const today = new Date();
  let age = today.getFullYear() - birthdate.getFullYear();
  const monthDiff = today.getMonth() - birthdate.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthdate.getDate())) {
    age--;
  }
  
  return age;
}
```

### Faixas Etárias
- 18-24: Jovens adultos
- 25-34: Adultos jovens
- 35-44: Adultos
- 45-54: Adultos maduros
- 55-64: Pré-seniores
- 65+: Seniores

### Métricas Calculadas
- Percentuais por categoria
- Totais e médias
- Dados agregados para gráficos
- Crescimento temporal

---

## Processamento de Pagamentos

### Queries Complexas
- Filtros dinâmicos aplicados no código
- Joins complexos com usuários e planos
- Cálculos de dias em atraso/até vencimento
- Ordenação e paginação

### Logging Detalhado
```typescript
// Exemplo do sistema de logging implementado
this.logger.log('Executing Prisma query with where clause:', JSON.stringify(where, null, 2));
this.logger.log(`Query executed successfully. Found ${payments.length} payments, total: ${total}`);
```

---

## Dashboard Otimizado

### Execução Paralela
```typescript
const [stats, userGrowth, roleDistribution, statusDistribution, planDistribution] =
  await Promise.all([
    this.backofficeService.getStats(),
    this.backofficeService.getUserGrowth(),
    this.backofficeService.getRoleDistribution(),
    this.backofficeService.getStatusDistribution(),
    this.backofficeService.getPlanDistribution(),
  ]);
```

### Logging Estruturado
- Métricas essenciais logadas
- Performance monitoring
- Error tracking
- Debug information

---

## Segurança e Validações

### Controle de Acesso Correto
- **Análises**: Roles admin, manager, system_admin
- **Gerenciamento usuários**: Roles admin, manager, system_admin
- **Dashboard**: Acesso restrito apropriado

### Problemas de Segurança
1. **Endpoints de pagamento sem autenticação**
2. **Acesso a dados sensíveis sem validação**
3. **Operações críticas sem autorização**

### Validações Implementadas
- Verificação de roles em operações admin
- Transformação segura de dados
- Logging de operações sensíveis

---

## Casos de Uso Principais

### Dashboard Executivo
```typescript
// Carregamento otimizado do dashboard
const dashboard = await backofficeDashboard();
```

### Gerenciamento em Massa
```typescript
// Ativar múltiplos usuários
await bulkUserAction({
  input: {
    action: "activate",
    userIds: [1, 2, 3, 4, 5]
  }
});

// Alterar plano em lote
await bulkUserAction({
  input: {
    action: "changePlan",
    userIds: inactiveUsers.map(u => u.id),
    plan: "free"
  }
});
```

### Análise de Usuários
```typescript
// Buscar usuários com filtros
const users = await usersDetailed({
  filters: {
    page: 1,
    limit: 50,
    search: "gmail.com",
    isActive: true,
    createdAfter: "2024-01-01"
  }
});
```

### Gerenciamento de Pagamentos (INSEGURO)
```typescript
// ⚠️ Sem autenticação - PROBLEMA
const overduePayments = await allOverduePayments();
await processAllRecurringPaymentsAdmin();
```

---

## Problemas Conhecidos

### 🔴 CRÍTICO - Falhas de Segurança
1. **`allRecurringPaymentsStats`**: Expõe dados financeiros sensíveis
2. **`allOverduePayments`**: Lista completa de inadimplentes
3. **`processAllRecurringPaymentsAdmin`**: Processamento sem autorização
4. **`processRecurringPaymentAdmin`**: Cobrança forçada sem validação
5. **`allCompletedPayments`**: Histórico financeiro completo exposto

### 🟡 Melhorias Sugeridas
- Implementar cache para dashboards
- Otimizar queries de análise demográfica
- Adicionar exportação de relatórios
- Implementar alertas automáticos
- Melhorar sistema de filtros

### ⚡ Correções Urgentes Necessárias
```typescript
// Adicionar aos endpoints de pagamento:
@UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
@Roles(Role.ADMIN, Role.SYSTEM_ADMIN, Role.MANAGER)
```

---

## Métricas e Monitoramento

### KPIs Disponíveis
- Crescimento de usuários (mensal/semanal)
- Revenue total e por período
- Distribuição por planos
- Taxa de conversão
- Análise geográfica e demográfica

### Alertas Recomendados
- Quedas abruptas em métricas
- Problemas de pagamento em massa
- Usuários inativos em excesso
- Falhas em processamento de pagamentos

---

## Recomendações de Correção

### Prioridade 1 - Segurança
1. Adicionar guards aos endpoints de pagamento
2. Implementar validação de acesso a dados financeiros
3. Auditar logs de acesso a informações sensíveis
4. Implementar rate limiting em operações críticas

### Prioridade 2 - Performance
1. Implementar cache para dados de dashboard
2. Otimizar queries complexas de análise
3. Adicionar índices no banco para queries frequentes
4. Implementar paginação em todas as listagens