# Barbershop Backend API

## Descrição

Backend do sistema de gerenciamento de barbearias, construído com o framework [NestJS](https://nestjs.com/), usando Prisma como ORM. Oferece autenticação, gestão de barbearias, agendamentos, clientes, pagamentos via Stripe e outras funcionalidades.

## Instalação

```bash
$ npm install
```

## Configuração do Banco de Dados

O projeto usa Prisma para interagir com o banco de dados. Primeiro, configure seu banco de dados no arquivo `.env`:

```env
DATABASE_URL="file:./dev.db"
```

## Documentação da API

Após iniciar a aplicação, acesse `http://localhost:3000/swagger` para visualizar a documentação gerada pelo Swagger.

Em seguida, execute as migrações do Prisma para criar as tabelas no banco de dados:

```bash
$ npx prisma migrate dev
```

Visualizar os dados do banco de dados:

```bash
$ npx prisma studio
```

## Rodando a Aplicação

```bash
# Desenvolvimento
$ pnpm run start:dev

# Produção
$ npm run build
$ npm run start:prod
```

## Rodando os Testes

```bash
# Testes unitários
$ npm run test

# Testes com cobertura
$ npm run test:cov

# Testes end-to-end
$ npm run test:e2e
```

### Versão

##### Node.js: 22.1.0

##### NPM: 10.7.0

## Exemplo de .env

```
PORT=3020
SESSION_SECRET=

DB_DIALECT=mysql
DB_HOST=
DB_PORT=
DB_USER=
DB_PASSWORD=
DB_NAME=

EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your-email@example.com
EMAIL_PASS=your-password
EMAIL_FROM=postmaster@sandbox.mailgun.org
MAILGUN_API_KEY=
MAILGUN_DOMAIN=
ENABLE_GOOGLE_AUTH=true
ENABLE_FACEBOOK_AUTH=true
ENABLE_APPLE_AUTH=true
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=
GOOGLE_CLIENT_CALLBACK_URL=
FACEBOOK_CLIENT_ID=
FACEBOOK_CLIENT_SECRET=
FACEBOOK_CALLBACK_URL=
FACEBOOK_CLIENT_CALLBACK_URL=
APPLE_CLIENT_ID=
APPLE_TEAM_ID=
APPLE_KEY_ID=
APPLE_PRIVATE_KEY=
APPLE_CALLBACK_URL=
APPLE_CLIENT_CALLBACK_URL=
```

## Login Social

Google, Facebook e Apple são ligados/desligados individualmente por `ENABLE_GOOGLE_AUTH` / `ENABLE_FACEBOOK_AUTH` / `ENABLE_APPLE_AUTH` — desligar uma plataforma não afeta as outras. Com a plataforma habilitada e as credenciais configuradas, acesse `/auth/google`, `/auth/facebook` ou `/auth/apple` (staff) — ou os equivalentes em `/client-auth/*` para contas de cliente do marketplace — para iniciar o fluxo de autenticação. Após a autorização, o backend criará ou localizará a conta pelo e-mail fornecido, ligando o novo método de login à conta existente quando o e-mail já é conhecido, e gerará o cookie de sessão (`Authentication` para staff, `ClientAuthentication` para cliente). Uma plataforma desligada (ou sem credenciais, no caso da Apple) devolve 404 nas rotas de OAuth em vez de tentar redirecionar.

## Histórico de Login e Sessões Ativas

A cada autenticação bem-sucedida o sistema registra o IP, localização e detalhes do dispositivo do usuário. Essas informações ficam disponíveis por meio de duas rotas protegidas:

- `/user/login-history` retorna o histórico de logins ordenado pela data com os campos IP, localização, tipo de dispositivo, sistema operacional, navegador e data de criação.
- `/user/active-sessions` lista as sessões ativas no momento.

O logout remove a sessão correspondente do registro de sessões ativas.

## Estrutura do Projeto

- **src**: Contém o código fonte da aplicação
  - **auth**: Módulo de autenticação
  - **user**: Módulo de usuários
  - **prisma**: Módulo Prisma para interação com o banco de dados
- **test**: Contém os testes da aplicação

## Scripts Disponíveis

- `prebuild`: Limpa a pasta `dist`
- `build`: Compila a aplicação
- `format`: Formata o código usando Prettier
- `start`: Inicia a aplicação em modo de produção
- `start:dev`: Inicia a aplicação em modo de desenvolvimento
- `start:debug`: Inicia a aplicação em modo de depuração
- `start:prod`: Inicia a aplicação em modo de produção
- `lint`: Executa o linting no código
- `test`: Executa os testes unitários
- `test:watch`: Executa os testes unitários em modo de observação
- `test:cov`: Executa os testes unitários e gera um relatório de cobertura
- `test:debug`: Executa os testes unitários em modo de depuração
- `test:e2e`: Executa os testes end-to-end

## Atualizando o Prisma

Caso haja uma atualização no esquema Prisma, siga os passos abaixo para aplicar as mudanças:

1. Gere uma nova migração e aplique as mudanças no banco de dados:

   ```bash
   $ npx prisma migrate dev --name <nome_da_migracao>
   ```

2. Gere o cliente Prisma atualizado:
   ```bash
   $ npx prisma generate
   ```

Substitua `<nome_da_migracao>` pelo nome adequado que descreva a migração.

## Dependências

- `@nestjs/common`: Módulo comum do NestJS
- `@nestjs/core`: Núcleo do NestJS
- `@nestjs/jwt`: Módulo JWT para autenticação
- `@nestjs/passport`: Módulo Passport para autenticação
- `@nestjs/platform-express`: Plataforma Express para NestJS
- `@prisma/client`: Cliente Prisma
- `bcryptjs`: Biblioteca para hashing de senhas
- `class-transformer`: Biblioteca para transformação de classes
- `class-validator`: Biblioteca para validação de classes
- `dotenv`: Biblioteca para gerenciamento de variáveis de ambiente
- `express-session`: Middleware para sessões no Express
- `nest-access-control`: Controle de acesso para NestJS
- `passport`: Middleware de autenticação
- `passport-local`: Estratégia local para Passport
- `prisma`: ORM Prisma
- `reflect-metadata`: Biblioteca de metadados
- `rimraf`: Biblioteca para remoção de arquivos e diretórios
- `rxjs`: Biblioteca reativa

## Dependências de Desenvolvimento

- `@faker-js/faker`: Gerador de dados falsos para testes
- `@nestjs/cli`: CLI do NestJS
- `@nestjs/schematics`: Schematics do NestJS
- `@nestjs/testing`: Módulo de testes do NestJS
- `@types/express`: Tipos para Express
- `@types/express-session`: Tipos para express-session
- `@types/jest`: Tipos para Jest
- `@types/node`: Tipos para Node.js
- `@types/passport-local`: Tipos para passport-local
- `@types/supertest`: Tipos para supertest
- `@typescript-eslint/eslint-plugin`: Plugin ESLint para TypeScript
- `@typescript-eslint/parser`: Parser ESLint para TypeScript
- `eslint`: Linter para JavaScript
- `eslint-config-prettier`: Configuração ESLint para Prettier
- `eslint-plugin-prettier`: Plugin ESLint para Prettier
- `jest`: Framework de testes
- `prettier`: Ferramenta de formatação de código
- `source-map-support`: Suporte a source maps
- `supertest`: Biblioteca para testes de integração
- `ts-jest`: Transformador Jest para TypeScript
- `ts-loader`: Loader TypeScript para Webpack
- `ts-node`: Executa TypeScript diretamente no Node.js
- `ts-node-dev`: Reinicia automaticamente o Node.js ao alterar arquivos TypeScript
- `tsconfig-paths`: Suporte a paths no TypeScript
- `typescript`: Linguagem TypeScript

## Emails Multilíngues

Os modelos de email agora suportam português, inglês e espanhol. O idioma é
definido na propriedade `language` de `userSystemConfig`. O serviço de email
busca automaticamente o template correspondente em `src/email/templates/<lang>`
(por exemplo, `en` ou `es`). Caso não exista um template para o idioma
especificado, o padrão em português é utilizado.

## Assinaturas

Após criar uma conta você pode escolher um plano pago para habilitar módulos extras.

1. Crie a conta usando `POST /user/create`.
2. Liste os planos disponíveis com `GET /plans/all` ou consulte um plano específico com `GET /plans/{id}`.
3. Inicie a assinatura enviando `POST /payments` com o `planId` escolhido`.

As rotas de pagamento exigem autenticação e verificam se o usuário possui uma assinatura ativa.
 

## Licença

Barbershop © 2024. Todos os direitos reservados.
