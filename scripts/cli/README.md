# Relable CLI

Interface de linha de comando para gerenciamento do backend Relable.

## Instalação

O CLI já está configurado no projeto. Para usar, execute:

```bash
npm run cli
# ou
pnpm run cli
```

## Comandos Disponíveis

### Usuários (`user`)

Gerenciamento de usuários do sistema.

#### Criar usuário

```bash
npm run cli user create --email admin@example.com --password 123456 --name "Admin User" --role ADMIN --verified
```

#### Listar usuários

```bash
npm run cli user list
npm run cli user list --limit 20 --role ADMIN --verified
```

#### Atualizar usuário

```bash
npm run cli user update --id 1 --name "Novo Nome" --role MANAGER --verify
```

#### Deletar usuário

```bash
npm run cli user delete --id 1 --force
```

#### Estatísticas de usuários

```bash
npm run cli user stats
```

### Banco de Dados (`db`)

Gerenciamento do banco de dados.

#### Status do banco

```bash
npm run cli db status
```

#### Executar migrações

```bash
npm run cli db migrate
npm run cli db migrate --reset
npm run cli db migrate --deploy
```

#### Executar seed

```bash
npm run cli db seed
npm run cli db seed --force
```

#### Backup do banco

```bash
npm run cli db backup
npm run cli db backup --output ./my-backup.db
```

#### Restaurar backup

```bash
npm run cli db restore --file ./backup.db --force
```

#### Limpeza do banco

```bash
npm run cli db cleanup --days 30 --users --sessions --logs
```

#### Estatísticas do banco

```bash
npm run cli db stats
```

### Stripe (`stripe`)

Gerenciamento da integração com Stripe.

#### Status do Stripe

```bash
npm run cli stripe status
```

#### Sincronizar planos

```bash
npm run cli stripe sync-plans
npm run cli stripe sync-plans --force
```

#### Sincronizar clientes

```bash
npm run cli stripe sync-customers
npm run cli stripe sync-customers --force
```

#### Verificar pagamentos

```bash
npm run cli stripe check-payments --days 7 --sync
```

#### Criar webhook

```bash
npm run cli stripe create-webhook --url https://api.example.com/webhooks/stripe
```

#### Listar webhooks

```bash
npm run cli stripe list-webhooks
```

### Análises (`analysis`)

Gerenciamento de análises.

#### Listar análises

```bash
npm run cli analysis list
npm run cli analysis list --type LDA --status COMPLETED --limit 50
```

#### Estatísticas de análises

```bash
npm run cli analysis stats --days 30
```

#### Limpar análises antigas

```bash
npm run cli analysis cleanup --days 30 --failed --force
```

#### Exportar análises

```bash
npm run cli analysis export --output analyses.csv --days 90
```

#### Reparar análises

```bash
npm run cli analysis repair --failed
npm run cli analysis repair --stuck
```

#### Detalhes de uma análise

```bash
npm run cli analysis show --id 123
```

### Sistema (`system`)

Gerenciamento geral do sistema.

#### Saúde do sistema

```bash
npm run cli system health
```

#### Limpeza do sistema

```bash
npm run cli system cleanup --logs --temp --cache
npm run cli system cleanup --all
```

#### Backup do sistema

```bash
npm run cli system backup --include-config --include-logs
```

#### Restaurar backup

```bash
npm run cli system restore --path ./backup-2024-01-01 --force
```

#### Informações do sistema

```bash
npm run cli system info
```

## Exemplos de Uso

### Setup Inicial

```bash
# Verificar saúde do sistema
npm run cli system health

# Executar migrações
npm run cli db migrate

# Executar seed
npm run cli db seed

# Criar usuário admin
npm run cli user create --email admin@relable.com --password admin123 --role ADMIN --verified

# Sincronizar planos com Stripe
npm run cli stripe sync-plans
```

### Manutenção Diária

```bash
# Verificar status geral
npm run cli system health

# Limpar dados antigos
npm run cli db cleanup --days 30 --sessions --logs

# Verificar pagamentos do Stripe
npm run cli stripe check-payments --days 1 --sync

# Reparar análises com problemas
npm run cli analysis repair --failed
```

### Backup e Restauração

```bash
# Criar backup completo
npm run cli system backup --include-config

# Criar backup apenas do banco
npm run cli db backup --output backup-$(date +%Y%m%d).db

# Restaurar backup
npm run cli system restore --path ./backup-2024-01-01 --force
```

## Opções Globais

- `--help, -h`: Mostrar ajuda
- `--version, -V`: Mostrar versão

## Configuração

O CLI usa as mesmas variáveis de ambiente do backend:

- `DATABASE_URL`: URL do banco de dados
- `STRIPE_SECRET_KEY`: Chave secreta do Stripe
- `JWT_SECRET`: Chave secreta do JWT
- `AWS_ACCESS_KEY_ID`: Chave de acesso AWS
- `AWS_SECRET_ACCESS_KEY`: Chave secreta AWS

## Estrutura de Arquivos

```
scripts/cli/
├── index.js              # Arquivo principal do CLI
├── commands/
│   ├── user.js          # Comandos de usuário
│   ├── database.js      # Comandos de banco de dados
│   ├── stripe.js        # Comandos do Stripe
│   ├── analysis.js      # Comandos de análise
│   └── system.js        # Comandos do sistema
└── README.md            # Esta documentação
```

## Desenvolvimento

Para adicionar novos comandos:

1. Crie um novo arquivo em `commands/`
2. Exporte uma função que recebe o programa como parâmetro
3. Importe e registre o comando no `index.js`

Exemplo:

```javascript
// commands/example.js
function exampleCommands(program) {
  const example = program.command('example').description('Comandos de exemplo');

  example
    .command('test')
    .description('Teste de comando')
    .action(async () => {
      console.log('Comando de teste executado!');
    });
}

module.exports = exampleCommands;
```

## Troubleshooting

### Erro de conexão com banco

- Verifique se o `DATABASE_URL` está configurado
- Execute `npm run cli db status` para diagnosticar

### Erro do Stripe

- Verifique se `STRIPE_SECRET_KEY` está configurada
- Execute `npm run cli stripe status` para diagnosticar

### Permissões de arquivo

- Em sistemas Unix, certifique-se de que o arquivo CLI tem permissão de execução
- Execute `chmod +x scripts/cli/index.js` se necessário
