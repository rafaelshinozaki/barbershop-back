# Exemplos GraphQL

Este arquivo contém exemplos de queries e mutations para testar o GraphQL.

## 🔐 Autenticação

### Login

```graphql
mutation Login($input: LoginInput!) {
  login(input: $input) {
    id
    email
    fullName
    role
    membership
    isActive
    twoFactorEnabled
    photoKey
    twoFactorRequired
    loginId
  }
}
```

Variáveis:

```json
{
  "input": {
    "email": "user@example.com",
    "password": "password123"
  }
}
```

### Verificar 2FA

```graphql
mutation Verify2FA($input: Verify2FAInput!) {
  verify2FA(input: $input) {
    id
    email
    fullName
    role
    membership
    isActive
    twoFactorEnabled
    photoKey
  }
}
```

Variáveis:

```json
{
  "input": {
    "loginId": "uuid-do-login",
    "code": "123456"
  }
}
```

### Criar Usuário

```graphql
mutation CreateUser($input: CreateUserInput!) {
  createUser(input: $input) {
    id
    email
    fullName
    role
    membership
    isActive
    twoFactorEnabled
    createdAt
    updatedAt
  }
}
```

Variáveis:

```json
{
  "input": {
    "email": "newuser@example.com",
    "password": "password123",
    "fullName": "New User",
    "idDocNumber": "12345678901",
    "phone": "+5511999999999",
    "gender": "M",
    "birthdate": "1990-01-01T00:00:00.000Z",
    "company": "Example Corp",
    "professionalSegment": "Technology",
    "knowledgeApp": "Yes",
    "readTerms": true
  }
}
```

### Logout

```graphql
mutation Logout {
  logout
}
```

### Esqueci a Senha

```graphql
mutation ForgotPassword($input: ForgotPasswordInput!) {
  forgotPassword(input: $input)
}
```

Variáveis:

```json
{
  "input": {
    "email": "user@example.com"
  }
}
```

### Alterar Senha

```graphql
mutation ChangePassword($input: ChangePasswordInput!) {
  changePassword(input: $input)
}
```

Variáveis:

```json
{
  "input": {
    "currentPassword": "oldpassword",
    "newPassword": "newpassword123"
  }
}
```

### Configurar 2FA

```graphql
mutation SetTwoFactor($input: TwoFactorInput!) {
  setTwoFactor(input: $input)
}
```

Variáveis:

```json
{
  "input": {
    "enabled": true
  }
}
```

## 👤 Usuário

### Obter Dados do Usuário Atual

```graphql
query Me {
  me {
    id
    email
    fullName
    role
    membership
    isActive
    twoFactorEnabled
    photoKey
    createdAt
    updatedAt
  }
}
```

### Histórico de Login

```graphql
query LoginHistory($page: Int, $limit: Int) {
  loginHistory(page: $page, limit: $limit) {
    id
    userId
    deviceType
    browser
    os
    ip
    location
    createdAt
  }
}
```

Variáveis:

```json
{
  "page": 1,
  "limit": 10
}
```

### Sessões Ativas

```graphql
query ActiveSessions($page: Int, $limit: Int) {
  activeSessions(page: $page, limit: $limit) {
    id
    userId
    deviceType
    browser
    os
    ip
    location
    createdAt
    updatedAt
  }
}
```

Variáveis:

```json
{
  "page": 1,
  "limit": 10
}
```

### Todas as Sessões

```graphql
query Sessions {
  sessions {
    id
    userId
    deviceType
    browser
    os
    ip
    location
    createdAt
    updatedAt
  }
}
```

### Obter Usuário por ID

```graphql
query User($id: Int!) {
  user(id: $id) {
    id
    email
    fullName
    role
    membership
    isActive
    twoFactorEnabled
    photoKey
    createdAt
    updatedAt
  }
}
```

Variáveis:

```json
{
  "id": 1
}
```

### Listar Usuários (Admin)

```graphql
query Users(
  $plan: String
  $status: String
  $subscriptionStatus: String
  $role: String
  $name: String
  $email: String
  $page: Int
  $limit: Int
) {
  users(
    plan: $plan
    status: $status
    subscriptionStatus: $subscriptionStatus
    role: $role
    name: $name
    email: $email
    page: $page
    limit: $limit
  ) {
    id
    email
    fullName
    role
    membership
    isActive
    twoFactorEnabled
    createdAt
    updatedAt
  }
}
```

Variáveis:

```json
{
  "page": 1,
  "limit": 10,
  "role": "USER"
}
```

### URL de Upload de Foto

```graphql
mutation GetPhotoUploadUrl($fileExtension: String, $contentType: String) {
  getPhotoUploadUrl(fileExtension: $fileExtension, contentType: $contentType)
}
```

Variáveis:

```json
{
  "fileExtension": "jpg",
  "contentType": "image/jpeg"
}
```

### URL de Download de Foto

```graphql
query GetPhotoUrl {
  getPhotoUrl
}
```

## 📋 Planos

### Listar Planos

```graphql
query Plans {
  plans {
    id
    name
    description
    price
    billingCycle
    features
    stripePriceId
    createdAt
    updatedAt
  }
}
```

### Obter Plano por ID

```graphql
query Plan($id: Int!) {
  plan(id: $id) {
    id
    name
    description
    price
    billingCycle
    features
    stripePriceId
    createdAt
    updatedAt
  }
}
```

Variáveis:

```json
{
  "id": 1
}
```

### Minhas Assinaturas

```graphql
query MySubscriptions {
  mySubscriptions {
    id
    userId
    planId
    startSubDate
    cancelationDate
    status
    stripeCustomerId
    stripeSubscriptionId
    createdAt
    updatedAt
    plan {
      id
      name
      description
      price
      billingCycle
      features
    }
  }
}
```

### Meus Pagamentos

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
    payerId
    paymentId
  }
}
```

## 🔧 Queries Compostas

### Dashboard Completo

```graphql
query Dashboard {
  me {
    id
    email
    fullName
    role
    membership
    isActive
    twoFactorEnabled
    photoKey
  }

  plans {
    id
    name
    description
    price
    billingCycle
  }

  mySubscriptions {
    id
    status
    plan {
      name
      price
    }
  }

  myPayments {
    id
    amount
    status
    paymentDate
  }
}
```

### Perfil do Usuário com Histórico

```graphql
query UserProfile {
  me {
    id
    email
    fullName
    role
    membership
    isActive
    twoFactorEnabled
    photoKey
    createdAt
    updatedAt
  }

  loginHistory(page: 1, limit: 5) {
    id
    deviceType
    browser
    os
    ip
    location
    createdAt
  }

  activeSessions(page: 1, limit: 5) {
    id
    deviceType
    browser
    os
    ip
    location
    createdAt
  }
}
```

## 🚨 Mutations de Administração

### Remover Usuário

```graphql
mutation RemoveUser($userId: Int!) {
  removeUser(userId: $userId)
}
```

Variáveis:

```json
{
  "userId": 1
}
```

### Ativar/Desativar Usuário

```graphql
mutation SetUserActive($userId: Int!, $active: Boolean!) {
  setUserActive(userId: $userId, active: $active)
}
```

Variáveis:

```json
{
  "userId": 1,
  "active": true
}
```

### Ativar/Desativar Múltiplos Usuários

```graphql
mutation SetMultipleUsersActive($userIds: [Int!]!, $active: Boolean!) {
  setMultipleUsersActive(userIds: $userIds, active: $active)
}
```

Variáveis:

```json
{
  "userIds": [1, 2, 3],
  "active": true
}
```

### Alterar Plano de Múltiplos Usuários

```graphql
mutation ChangeMultiplePlans($userIds: [Int!]!, $plan: String!) {
  changeMultiplePlans(userIds: $userIds, plan: $plan)
}
```

Variáveis:

```json
{
  "userIds": [1, 2, 3],
  "plan": "PREMIUM"
}
```

### Alterar Plano de Usuário

```graphql
mutation ChangeUserPlan($userId: Int!, $plan: String!) {
  changeUserPlan(userId: $userId, plan: $plan)
}
```

Variáveis:

```json
{
  "userId": 1,
  "plan": "PREMIUM"
}
```

### Encerrar Sessão

```graphql
mutation TerminateSession($sessionId: Int!) {
  terminateSession(sessionId: $sessionId)
}
```

Variáveis:

```json
{
  "sessionId": 1
}
```

## 🧪 Como Testar

1. **Acesse o GraphQL Playground**: `http://localhost:3020/graphql`

2. **Cole uma query ou mutation** no painel esquerdo

3. **Configure as variáveis** no painel inferior direito (se necessário)

4. **Clique em "Play"** para executar

5. **Verifique o resultado** no painel direito

## 📝 Dicas

- Use o **Documentation Explorer** (ícone de livro) para navegar pelo schema
- Use **Query History** para ver queries anteriores
- Use **Settings** para configurar headers de autenticação
- Use **Prettify** para formatar queries longas

## 🔍 Debugging

Para debugar problemas:

1. Verifique os logs do servidor
2. Use o **Network** tab do navegador
3. Verifique se o token JWT está sendo enviado
4. Teste queries simples primeiro
5. Use o **GraphQL Playground** para isolar problemas
