# AuthResolver Documentation

## Overview
O `AuthResolver` gerencia toda a autenticação e autorização do sistema, incluindo login, registro de usuários, autenticação de dois fatores (2FA), recuperação de senha e gerenciamento de sessões.

## Localização
- **Arquivo**: `/back/src/graphql/resolvers/auth.resolver.ts`
- **Módulo**: GraphQLAppModule
- **Guards**: GraphQLJwtAuthGuard, Throttling decorators

## Endpoints

### Mutations

#### 1. `login`
**Descrição**: Autentica um usuário no sistema
```graphql
mutation Login($input: LoginInput!) {
  login(input: $input) {
    id
    email
    firstName
    lastName
    role
  }
}
```

**Parâmetros de Entrada** (`LoginInput`):
- `email: String!` - Email do usuário
- `password: String!` - Senha do usuário
- `deviceType: String` - Tipo de dispositivo (mobile/desktop)
- `browser: String` - Navegador utilizado
- `os: String` - Sistema operacional
- `ip: String` - Endereço IP
- `location: String` - Localização geográfica

**Retorno**: `User` - Dados completos do usuário autenticado

**Fluxo de Negócio**:
1. Valida credenciais via `UserService.verifyUser()`
2. Se 2FA habilitado, retorna loginId para segunda etapa
3. Cria sessão JWT via `AuthService.login()`
4. Registra histórico de login com informações do dispositivo

**Throttling**: `@ThrottleLogin()` - Proteção contra força bruta

**Erros Comuns**:
- `Invalid credentials` - Email ou senha incorretos
- `User not found` - Usuário não existe
- `2FA required` - Necessário código 2FA

---

#### 2. `verify2FA`
**Descrição**: Verifica código 2FA para completar login
```graphql
mutation Verify2FA($input: Verify2FAInput!) {
  verify2FA(input: $input) {
    id
    email
    firstName
    lastName
  }
}
```

**Parâmetros de Entrada** (`Verify2FAInput`):
- `loginId: String!` - ID temporário do login
- `code: String!` - Código 2FA de 6 dígitos

**Retorno**: `User` - Dados do usuário após validação

**Fluxo de Negócio**:
1. Valida código 2FA via `UserService.verifyLoginCode()`
2. Completa processo de login
3. Cria sessão JWT

**Throttling**: `@ThrottleAuth()` - Limita tentativas

---

#### 3. `createUser`
**Descrição**: Registra novo usuário no sistema
```graphql
mutation CreateUser($input: CreateUserInput!) {
  createUser(input: $input) {
    id
    email
    firstName
    lastName
  }
}
```

**Parâmetros de Entrada** (`CreateUserInput`):
- `email: String!` - Email único
- `password: String!` - Senha (mínimo 8 caracteres)
- `firstName: String!` - Nome
- `lastName: String!` - Sobrenome
- `birthDate: Date` - Data de nascimento
- `gender: String` - Gênero
- `cpf: String` - CPF
- `phone: String` - Telefone
- `profession: String` - Profissão
- `company: String` - Empresa
- `segment: String` - Segmento profissional
- `address: AddressInput` - Endereço completo

**Retorno**: `User` - Usuário criado

**Fluxo de Negócio**:
1. Valida unicidade do email
2. Cria usuário com endereço padrão
3. Configura sistema de configurações padrão
4. Envia email de boas-vindas
5. Auto-login após criação

**Validações**:
- Email único
- Senha forte
- CPF válido (se fornecido)

---

#### 4. `logout`
**Descrição**: Encerra sessão atual
```graphql
mutation Logout {
  logout
}
```

**Autenticação**: Requer `@UseGuards(GraphQLJwtAuthGuard)`

**Retorno**: `Boolean` - true se sucesso

**Fluxo de Negócio**:
1. Invalida token JWT atual
2. Remove sessão do banco
3. Limpa cookies de sessão

---

#### 5. `logoutOtherSessions`
**Descrição**: Encerra todas as outras sessões do usuário
```graphql
mutation LogoutOtherSessions {
  logoutOtherSessions
}
```

**Autenticação**: Requer `@UseGuards(GraphQLJwtAuthGuard)`

**Retorno**: `Boolean` - true se sucesso

**Fluxo de Negócio**:
1. Identifica sessão atual
2. Invalida todas as outras sessões
3. Mantém apenas sessão atual ativa

---

#### 6. `forgotPassword`
**Descrição**: Inicia processo de recuperação de senha
```graphql
mutation ForgotPassword($input: ForgotPasswordInput!) {
  forgotPassword(input: $input)
}
```

**Parâmetros de Entrada** (`ForgotPasswordInput`):
- `email: String!` - Email do usuário

**Retorno**: `Boolean` - true se email enviado

**Fluxo de Negócio**:
1. Valida se usuário existe
2. Gera token único de recuperação
3. Envia email com link de recuperação
4. Token expira em 24 horas

**Throttling**: `@ThrottlePasswordReset()` - Limita requisições

---

#### 7. `forgotPasswordCheck`
**Descrição**: Valida token de recuperação de senha
```graphql
mutation ForgotPasswordCheck($input: ForgotPasswordCheckInput!) {
  forgotPasswordCheck(input: $input)
}
```

**Parâmetros de Entrada** (`ForgotPasswordCheckInput`):
- `email: String!` - Email do usuário
- `token: String!` - Token de recuperação

**Retorno**: `Boolean` - true se token válido

**Validações**:
- Token não expirado
- Token corresponde ao email
- Token não foi usado

---

#### 8. `resetPassword`
**Descrição**: Redefine senha usando token
```graphql
mutation ResetPassword($input: ResetPasswordInput!) {
  resetPassword(input: $input)
}
```

**Parâmetros de Entrada** (`ResetPasswordInput`):
- `email: String!` - Email do usuário
- `token: String!` - Token de recuperação
- `newPassword: String!` - Nova senha

**Retorno**: `Boolean` - true se senha alterada

**Fluxo de Negócio**:
1. Valida token e email
2. Atualiza senha no banco
3. Invalida token usado
4. Envia email de confirmação

---

#### 9. `changePassword`
**Descrição**: Altera senha do usuário autenticado
```graphql
mutation ChangePassword($input: ChangePasswordInput!) {
  changePassword(input: $input)
}
```

**Autenticação**: Requer `@UseGuards(GraphQLJwtAuthGuard)`

**Parâmetros de Entrada** (`ChangePasswordInput`):
- `currentPassword: String!` - Senha atual
- `newPassword: String!` - Nova senha
- `verificationCode: String` - Código de verificação

**Retorno**: `Boolean` - true se alterada

**Fluxo de Negócio**:
1. Valida senha atual
2. Verifica código de verificação (se habilitado)
3. Atualiza senha
4. Invalida outras sessões (opcional)

**⚠️ ALERTA DE SEGURANÇA**: Código de verificação hardcoded '123456' na linha 210

---

#### 10. `setTwoFactor`
**Descrição**: Habilita/desabilita autenticação de dois fatores
```graphql
mutation SetTwoFactor($input: TwoFactorInput!) {
  setTwoFactor(input: $input)
}
```

**Autenticação**: Requer `@UseGuards(GraphQLJwtAuthGuard)`

**Parâmetros de Entrada** (`TwoFactorInput`):
- `enabled: Boolean!` - true para habilitar, false para desabilitar

**Retorno**: `Boolean` - Status da operação

**Fluxo de Negócio**:
1. Atualiza configuração 2FA do usuário
2. Se habilitando, gera secret para authenticator
3. Envia email de confirmação

---

#### 11. `requestChangePasswordCode`
**Descrição**: Solicita código para alteração de senha
```graphql
mutation RequestChangePasswordCode {
  requestChangePasswordCode
}
```

**Autenticação**: Requer `@UseGuards(GraphQLJwtAuthGuard)`

**Retorno**: `Boolean` - true se código enviado

**Fluxo de Negócio**:
1. Gera código de 6 dígitos
2. Envia por email
3. Código expira em 15 minutos

**Throttling**: `@ThrottleEmail()` - Limita envios

---

#### 12. `verifyChangePasswordCode`
**Descrição**: Verifica código de alteração de senha
```graphql
mutation VerifyChangePasswordCode($input: VerifyChangePasswordCodeInput!) {
  verifyChangePasswordCode(input: $input)
}
```

**Autenticação**: Requer `@UseGuards(GraphQLJwtAuthGuard)`

**Parâmetros de Entrada** (`VerifyChangePasswordCodeInput`):
- `code: String!` - Código de 6 dígitos

**Retorno**: `Boolean` - true se código válido

---

#### 13. `resetPasswordWithCode`
**Descrição**: Redefine senha usando código de verificação
```graphql
mutation ResetPasswordWithCode($input: ResetPasswordWithCodeInput!) {
  resetPasswordWithCode(input: $input)
}
```

**Autenticação**: Requer `@UseGuards(GraphQLJwtAuthGuard)`

**Parâmetros de Entrada** (`ResetPasswordWithCodeInput`):
- `code: String!` - Código de verificação
- `newPassword: String!` - Nova senha

**Retorno**: `Boolean` - true se senha alterada

---

#### 14. `checkPassword`
**Descrição**: Valida se senha fornecida está correta
```graphql
mutation CheckPassword($input: CheckPasswordInput!) {
  checkPassword(input: $input)
}
```

**Autenticação**: Requer `@UseGuards(GraphQLJwtAuthGuard)`

**Parâmetros de Entrada** (`CheckPasswordInput`):
- `password: String!` - Senha a verificar

**Retorno**: `Boolean` - true se senha correta

**Uso Comum**: Validação antes de operações sensíveis

---

#### 15. `startSocialSignup`
**Descrição**: Inicia processo de registro via rede social
```graphql
mutation StartSocialSignup($provider: String!, $email: String!, $fullName: String!) {
  startSocialSignup(provider: $provider, email: $email, fullName: $fullName)
}
```

**Parâmetros de Entrada**:
- `provider: String!` - Provedor (google, facebook, etc)
- `email: String!` - Email da conta social
- `fullName: String!` - Nome completo

**Retorno**: `String` - Token temporário para completar registro

**Fluxo de Negócio**:
1. Valida dados do provedor
2. Gera token temporário
3. Armazena dados em memória
4. Retorna token para segunda etapa

---

#### 16. `completeSocialSignup`
**Descrição**: Completa registro via rede social
```graphql
mutation CompleteSocialSignup($input: SocialSignupInput!, $token: String!) {
  completeSocialSignup(input: $input, token: $token) {
    id
    email
    firstName
    lastName
  }
}
```

**Parâmetros de Entrada**:
- `input: SocialSignupInput!` - Dados complementares do usuário
- `token: String!` - Token da primeira etapa

**Retorno**: `User` - Usuário criado e autenticado

**Fluxo de Negócio**:
1. Valida token temporário
2. Recupera dados da primeira etapa
3. Cria usuário completo
4. Auto-login após criação

---

### Queries

#### 1. `me`
**Descrição**: Retorna dados do usuário autenticado
```graphql
query Me {
  me {
    id
    email
    firstName
    lastName
    role
    twoFactorEnabled
  }
}
```

**Autenticação**: Requer `@UseGuards(GraphQLJwtAuthGuard)`

**Retorno**: `User` - Dados completos do usuário atual

**Campos Retornados**:
- Informações pessoais
- Configurações de segurança
- Papel e permissões
- Status da conta

---

## Integração com Serviços

### Serviços Utilizados
- **UserService**: Gerenciamento de usuários e validações
- **AuthService**: Autenticação e sessões JWT
- **EmailService**: Envio de emails transacionais
- **CryptoService**: Criptografia e hashing

### Banco de Dados
- **Prisma ORM**: Todas as operações de banco
- **Tabelas principais**: User, Session, LoginHistory
- **Transações**: Usadas em operações críticas

---

## Segurança

### Throttling (Rate Limiting)
- `@ThrottleLogin()`: 5 tentativas por minuto
- `@ThrottleAuth()`: 10 requisições por minuto
- `@ThrottlePasswordReset()`: 3 requisições por hora
- `@ThrottleEmail()`: 5 emails por hora

### Guards
- `GraphQLJwtAuthGuard`: Validação de JWT
- `GraphQLRolesGuard`: Verificação de papéis

### Boas Práticas
- Senhas hasheadas com bcrypt
- Tokens JWT com expiração
- Validação de entrada em todos os endpoints
- Logs de auditoria para ações sensíveis

---

## Tratamento de Erros

### Erros Comuns
| Código | Mensagem | Causa |
|--------|----------|-------|
| UNAUTHORIZED | Invalid credentials | Email ou senha incorretos |
| NOT_FOUND | User not found | Usuário não existe |
| FORBIDDEN | 2FA required | Necessário código 2FA |
| BAD_REQUEST | Invalid token | Token expirado ou inválido |
| TOO_MANY_REQUESTS | Rate limit exceeded | Muitas tentativas |

### Logging
- Todas as operações são logadas
- Falhas de autenticação são rastreadas
- IPs suspeitos são monitorados

---

## Exemplos de Uso

### Login Completo com 2FA
```typescript
// Passo 1: Login inicial
const { data: loginData } = await login({
  variables: {
    input: {
      email: 'user@example.com',
      password: 'senha123',
      deviceType: 'desktop',
      browser: 'Chrome',
      os: 'Windows'
    }
  }
});

// Passo 2: Se 2FA habilitado
if (loginData.login.requiresTwoFactor) {
  const { data: userData } = await verify2FA({
    variables: {
      input: {
        loginId: loginData.login.loginId,
        code: '123456'
      }
    }
  });
}
```

### Recuperação de Senha
```typescript
// Passo 1: Solicitar recuperação
await forgotPassword({
  variables: {
    input: { email: 'user@example.com' }
  }
});

// Passo 2: Validar token (do email)
await forgotPasswordCheck({
  variables: {
    input: {
      email: 'user@example.com',
      token: 'token-do-email'
    }
  }
});

// Passo 3: Redefinir senha
await resetPassword({
  variables: {
    input: {
      email: 'user@example.com',
      token: 'token-do-email',
      newPassword: 'novaSenha123'
    }
  }
});
```

---

## Problemas Conhecidos

### 🔴 Crítico
- **Código de verificação hardcoded**: Linha 210 tem código '123456' fixo

### 🟡 Melhorias Sugeridas
- Implementar refresh tokens
- Adicionar captcha em endpoints públicos
- Melhorar validação de força de senha
- Implementar bloqueio de conta após múltiplas falhas

---

## Métricas e Monitoramento

### KPIs
- Taxa de sucesso de login
- Tempo médio de autenticação
- Número de recuperações de senha
- Taxa de adoção de 2FA

### Alertas Recomendados
- Múltiplas falhas de login do mesmo IP
- Picos em recuperação de senha
- Tentativas de força bruta
- Uso de tokens expirados