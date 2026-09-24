# UserResolver Documentation

## Overview
O `UserResolver` gerencia o perfil do usuário, configurações do sistema, histórico de login, sessões ativas e operações administrativas de usuários.

## Localização
- **Arquivo**: `/back/src/graphql/resolvers/user.resolver.ts`
- **Módulo**: GraphQLAppModule
- **Guards**: GraphQLJwtAuthGuard, GraphQLRolesGuard

## Endpoints

### Queries

#### 1. `me`
**Descrição**: Retorna dados completos do usuário autenticado com todas as relações
```graphql
query Me {
  me {
    id
    email
    firstName
    lastName
    role
    address {
      street
      city
      state
      zipCode
    }
    emailNotification {
      newAnalysis
      sharedAnalysis
      systemUpdates
    }
    userSystemConfig {
      theme
      language
      notifications
    }
  }
}
```

**Autenticação**: `@UseGuards(GraphQLJwtAuthGuard)`

**Retorno**: `User` com relações:
- `role`: Papel do usuário
- `emailNotification`: Preferências de notificação
- `userSystemConfig`: Configurações de interface
- `address`: Endereço completo

**Fluxo de Negócio**:
1. Busca usuário por ID da sessão
2. Inclui todas as relações necessárias
3. Valida se usuário existe
4. Registra acesso em log

**Validações**:
- Verifica ID mismatch entre sessão e banco
- Valida existência do usuário

---

#### 2. `userSystemConfig`
**Descrição**: Retorna configurações de sistema do usuário
```graphql
query UserSystemConfig {
  userSystemConfig {
    theme
    language
    dateFormat
    timezone
    notifications
  }
}
```

**Autenticação**: `@UseGuards(GraphQLJwtAuthGuard)`

**Retorno**: `UserSystemConfig`

**Campos**:
- `theme`: Tema da interface (light/dark)
- `language`: Idioma preferido
- `dateFormat`: Formato de data
- `timezone`: Fuso horário
- `notifications`: Preferências de notificação

---

#### 3. `loginHistory`
**Descrição**: Histórico paginado de logins do usuário
```graphql
query LoginHistory($page: Int, $limit: Int) {
  loginHistory(page: $page, limit: $limit) {
    data {
      id
      timestamp
      ip
      browser
      os
      deviceType
      location
    }
    total
    page
    limit
    totalPages
  }
}
```

**Autenticação**: `@UseGuards(GraphQLJwtAuthGuard)`

**Parâmetros**:
- `page: Int` - Página (padrão: 1)
- `limit: Int` - Itens por página (padrão: 10)

**Retorno**: `PaginatedLoginHistory`

**Informações Rastreadas**:
- Data/hora do login
- Endereço IP
- Navegador e SO
- Tipo de dispositivo
- Localização geográfica

---

#### 4. `activeSessions`
**Descrição**: Sessões ativas paginadas do usuário
```graphql
query ActiveSessions($page: Int, $limit: Int) {
  activeSessions(page: $page, limit: $limit) {
    data {
      id
      createdAt
      lastActivity
      ip
      browser
      os
      deviceType
      isCurrent
    }
    total
    page
    limit
  }
}
```

**Autenticação**: `@UseGuards(GraphQLJwtAuthGuard)`

**Parâmetros**:
- `page: Int` - Página (padrão: 1)
- `limit: Int` - Itens por página (padrão: 10)

**Retorno**: `PaginatedActiveSessions`

**Recursos**:
- Identifica sessão atual com `isCurrent`
- Mostra última atividade
- Permite gerenciamento de sessões

---

#### 5. `sessions`
**Descrição**: Todas as sessões ativas sem paginação
```graphql
query Sessions {
  sessions {
    id
    createdAt
    lastActivity
    ip
    browser
    deviceType
  }
}
```

**Autenticação**: `@UseGuards(GraphQLJwtAuthGuard)`

**Retorno**: `[ActiveSession]`

---

#### 6. `user`
**Descrição**: Busca usuário específico por ID
```graphql
query User($id: Int!) {
  user(id: $id) {
    id
    email
    firstName
    lastName
    role
  }
}
```

**Autenticação**: `@UseGuards(GraphQLJwtAuthGuard)`

**Parâmetros**:
- `id: Int!` - ID do usuário

**Retorno**: `User`

---

#### 7. `getAllUsers`
**Descrição**: Lista todos os usuários (admin)
```graphql
query GetAllUsers {
  getAllUsers {
    id
    email
    firstName
    lastName
    role
    active
    createdAt
  }
}
```

**Autenticação**: `@UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)`
**Roles**: `@Roles(Role.ADMIN, Role.MANAGER)`

**Retorno**: `[User]`

**Uso**: Dashboard administrativo

---

#### 8. `getUserPhotoDownloadUrl`
**Descrição**: URL de download da foto do perfil
```graphql
query GetUserPhotoDownloadUrl {
  getUserPhotoDownloadUrl
}
```

**Autenticação**: `@UseGuards(GraphQLJwtAuthGuard)`

**Retorno**: `String?` - URL do S3 ou null

**Fluxo**:
1. Busca photoKey do usuário
2. Gera URL assinada do S3
3. URL expira em 1 hora

---

#### 9. `getUsers` 
**Descrição**: Duplicata de getAllUsers (deprecada)
```graphql
query GetUsers {
  getUsers {
    id
    email
    firstName
    lastName
  }
}
```

**Status**: 🟡 Duplicada - usar `getAllUsers`

---

#### 10. `getPhotoUrl`
**Descrição**: Duplicata de getUserPhotoDownloadUrl (deprecada)
```graphql
query GetPhotoUrl {
  getPhotoUrl
}
```

**Status**: 🟡 Duplicada - usar `getUserPhotoDownloadUrl`

---

### Mutations

#### 1. `updateUserProfile`
**Descrição**: Atualiza perfil completo do usuário
```graphql
mutation UpdateUserProfile($input: UpdateUserInput!) {
  updateUserProfile(input: $input) {
    id
    firstName
    lastName
    email
    address {
      street
      city
      state
    }
  }
}
```

**Autenticação**: `@UseGuards(GraphQLJwtAuthGuard)`

**Parâmetros** (`UpdateUserInput`):
- `firstName: String`
- `lastName: String`
- `birthDate: Date`
- `gender: String`
- `cpf: String`
- `phone: String`
- `profession: String`
- `company: String`
- `companySize: String`
- `segment: String`
- `address: AddressInput` - Endereço completo

**Retorno**: `User` atualizado

**Fluxo de Negócio**:
1. Valida dados de entrada
2. Formata birthDate se fornecida
3. Atualiza ou cria endereço (upsert)
4. Retorna usuário com relações atualizadas

**Validações**:
- Data de nascimento válida
- CPF válido (se fornecido)
- Campos obrigatórios

**Logging**: Registra todas as alterações

---

#### 2. `changePassword`
**Descrição**: Altera senha do usuário
```graphql
mutation ChangePassword($input: ChangePasswordInput!) {
  changePassword(input: $input)
}
```

**Autenticação**: `@UseGuards(GraphQLJwtAuthGuard)`

**Parâmetros** (`ChangePasswordInput`):
- `currentPassword: String!`
- `newPassword: String!`
- `code: String` - Código de verificação

**Retorno**: `Boolean`

**Fluxo**:
1. Valida senha atual
2. Verifica código (se necessário)
3. Atualiza senha
4. Invalida outras sessões (opcional)

---

#### 3. `updateUserSystemConfig`
**Descrição**: Atualiza configurações de interface
```graphql
mutation UpdateUserSystemConfig($input: UpdateUserSystemConfigInput!) {
  updateUserSystemConfig(input: $input)
}
```

**Autenticação**: `@UseGuards(GraphQLJwtAuthGuard)`

**Parâmetros** (`UpdateUserSystemConfigInput`):
- `theme: String` - light/dark
- `language: String` - pt-BR/en-US
- `dateFormat: String`
- `timezone: String`
- `notifications: Boolean`

**Retorno**: `Boolean`

**Persistência**: Salva preferências no banco

---

#### 4. `updateEmailNotification`
**Descrição**: Atualiza preferências de notificação por email
```graphql
mutation UpdateEmailNotification($input: UpdateEmailNotificationInput!) {
  updateEmailNotification(input: $input) {
    id
    emailNotification {
      newAnalysis
      sharedAnalysis
      systemUpdates
      marketing
    }
  }
}
```

**Autenticação**: `@UseGuards(GraphQLJwtAuthGuard)`

**Parâmetros** (`UpdateEmailNotificationInput`):
- `newAnalysis: Boolean`
- `sharedAnalysis: Boolean`
- `systemUpdates: Boolean`
- `marketing: Boolean`

**Retorno**: `User` com emailNotification atualizado

**Fluxo**:
1. Upsert na tabela EmailNotification
2. Retorna usuário com relação atualizada

---

#### 5. `getPhotoUploadUrl`
**Descrição**: Gera URL para upload de foto
```graphql
mutation GetPhotoUploadUrl($fileExtension: String, $contentType: String) {
  getPhotoUploadUrl(fileExtension: $fileExtension, contentType: $contentType)
}
```

**Autenticação**: `@UseGuards(GraphQLJwtAuthGuard)`

**Parâmetros**:
- `fileExtension: String` - Extensão do arquivo (jpg, png)
- `contentType: String` - MIME type

**Retorno**: `String` - URL assinada do S3

**Fluxo**:
1. Gera chave única para foto
2. Cria URL de upload do S3
3. Salva photoKey no perfil
4. URL expira em 15 minutos

**Validações**:
- Extensões permitidas: jpg, jpeg, png, gif
- Tamanho máximo: 5MB (validado no S3)

---

#### 6. `removeUser` (Admin)
**Descrição**: Remove usuário do sistema
```graphql
mutation RemoveUser($userId: Int!) {
  removeUser(userId: $userId)
}
```

**Autenticação**: `@UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)`
**Roles**: `@Roles(Role.ADMIN)`

**Parâmetros**:
- `userId: Int!` - ID do usuário

**Retorno**: `Boolean`

**Fluxo**:
1. Valida permissões
2. Soft delete do usuário
3. Invalida todas as sessões
4. Registra em log de auditoria

---

#### 7. `setUserActive` (Admin)
**Descrição**: Ativa/desativa usuário
```graphql
mutation SetUserActive($userId: Int!, $active: Boolean!) {
  setUserActive(userId: $userId, active: $active)
}
```

**Autenticação**: `@UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)`
**Roles**: `@Roles(Role.ADMIN)`

**Parâmetros**:
- `userId: Int!` - ID do usuário
- `active: Boolean!` - Status desejado

**Retorno**: `Boolean`

**Efeitos**:
- Usuário inativo não pode fazer login
- Sessões existentes são invalidadas

---

#### 8. `setMultipleUsersActive` (Admin)
**Descrição**: Ativa/desativa múltiplos usuários
```graphql
mutation SetMultipleUsersActive($userIds: [Int!]!, $active: Boolean!) {
  setMultipleUsersActive(userIds: $userIds, active: $active)
}
```

**Autenticação**: `@UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)`
**Roles**: `@Roles(Role.ADMIN)`

**Parâmetros**:
- `userIds: [Int!]!` - Lista de IDs
- `active: Boolean!` - Status desejado

**Retorno**: `Boolean`

**Performance**: Operação em batch

---

#### 9. `changeMultipleUsersPlan` (Admin)
**Descrição**: Altera plano de múltiplos usuários
```graphql
mutation ChangeMultipleUsersPlan($userIds: [Int!]!, $plan: String!) {
  changeMultipleUsersPlan(userIds: $userIds, plan: $plan)
}
```

**Autenticação**: `@UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)`
**Roles**: `@Roles(Role.ADMIN)`

**Parâmetros**:
- `userIds: [Int!]!` - Lista de IDs
- `plan: String!` - Nome do plano

**Retorno**: `Boolean`

**Validações**:
- Plano deve existir
- Usuários devem existir

---

#### 10. `changeUserPlan` (Admin)
**Descrição**: Altera plano de um usuário
```graphql
mutation ChangeUserPlan($userId: Int!, $plan: String!) {
  changeUserPlan(userId: $userId, plan: $plan)
}
```

**Autenticação**: `@UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)`
**Roles**: `@Roles(Role.ADMIN)`

**Parâmetros**:
- `userId: Int!` - ID do usuário
- `plan: String!` - Nome do plano

**Retorno**: `Boolean`

---

#### 11. `terminateSession`
**Descrição**: Encerra sessão específica
```graphql
mutation TerminateSession($sessionId: String!) {
  terminateSession(sessionId: $sessionId)
}
```

**Autenticação**: `@UseGuards(GraphQLJwtAuthGuard)`

**Parâmetros**:
- `sessionId: String!` - ID da sessão

**Retorno**: `Boolean`

**Validações**:
- Sessão deve pertencer ao usuário
- Não pode encerrar sessão atual

---

## Integração com Serviços

### Serviços Utilizados
- **UserService**: CRUD de usuários
- **S3Service**: Upload/download de fotos
- **PrismaService**: Acesso direto ao banco
- **SmartLogger**: Logging estruturado

### Banco de Dados
- **Tabelas principais**: User, Address, EmailNotification, UserSystemConfig
- **Relações**: One-to-one com Address e configs
- **Operações**: Upsert para endereço e notificações

---

## Padrões de Implementação

### Paginação
```typescript
interface PaginatedResponse {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}
```

### Transformação de Dados
- Decimals convertidos para Number
- Dates convertidas para ISO string
- Nulls tratados adequadamente

### Logging
```typescript
this.logger.log('Operation', {
  userId: user.id,
  action: 'updateProfile',
  changes: input
});
```

---

## Segurança

### Guards e Roles
- Operações de usuário: `GraphQLJwtAuthGuard`
- Operações admin: `GraphQLRolesGuard` + `@Roles()`
- Validação de propriedade de recursos

### Validações
- CPF válido
- Email único
- Senha forte
- Dados sanitizados

---

## S3 Integration

### Upload de Foto
1. Cliente solicita URL de upload
2. Backend gera URL assinada
3. Cliente faz upload direto ao S3
4. Backend salva referência

### Download de Foto
1. Cliente solicita URL de download
2. Backend valida permissão
3. Gera URL assinada (1h expiração)
4. Cliente baixa direto do S3

---

## Tratamento de Erros

### Erros Comuns
| Código | Mensagem | Causa |
|--------|----------|-------|
| NOT_FOUND | User not found | Usuário não existe |
| FORBIDDEN | Access denied | Sem permissão |
| BAD_REQUEST | Invalid input | Dados inválidos |
| CONFLICT | Email already exists | Email duplicado |

---

## Exemplos de Uso

### Atualizar Perfil Completo
```typescript
const { data } = await updateUserProfile({
  variables: {
    input: {
      firstName: 'João',
      lastName: 'Silva',
      birthDate: '1990-01-01',
      address: {
        street: 'Rua A, 123',
        city: 'São Paulo',
        state: 'SP',
        zipCode: '01234-567',
        country: 'Brasil'
      }
    }
  }
});
```

### Upload de Foto de Perfil
```typescript
// 1. Obter URL de upload
const { data } = await getPhotoUploadUrl({
  variables: {
    fileExtension: 'jpg',
    contentType: 'image/jpeg'
  }
});

// 2. Upload direto ao S3
await fetch(data.getPhotoUploadUrl, {
  method: 'PUT',
  body: file,
  headers: {
    'Content-Type': 'image/jpeg'
  }
});

// 3. Foto automaticamente associada ao usuário
```

### Gerenciar Sessões
```typescript
// Listar sessões ativas
const { data } = await activeSessions({
  variables: { page: 1, limit: 10 }
});

// Encerrar sessão específica
await terminateSession({
  variables: { sessionId: 'session-id-123' }
});
```

---

## Problemas Conhecidos

### 🟡 Melhorias Sugeridas
- Remover queries duplicadas (getUsers, getPhotoUrl)
- Adicionar cache para dados de usuário
- Implementar soft delete completo
- Melhorar validação de CPF
- Adicionar compressão de imagens

---

## Métricas e Monitoramento

### KPIs
- Taxa de atualização de perfil
- Upload de fotos por usuário
- Sessões ativas por usuário
- Tempo de resposta das queries

### Alertas Recomendados
- Múltiplas sessões simultâneas
- Uploads de foto grandes
- Falhas em atualização de perfil
- Acessos não autorizados