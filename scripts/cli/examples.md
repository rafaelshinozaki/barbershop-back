# Exemplos Práticos do Barbershop CLI

Este arquivo contém exemplos práticos de como usar o CLI em diferentes cenários.

## 🚀 Setup Inicial do Sistema

### 1. Verificar Saúde do Sistema

```bash
npm run cli -- system health
```

### 2. Executar Migrações do Banco

```bash
npm run cli -- db migrate
```

### 3. Executar Seed do Banco

```bash
npm run cli -- db seed
```

### 4. Criar Usuário Administrador

```bash
npm run cli -- user create \
  --email admin@barbershop.com \
  --password Admin123! \
  --name "Administrador" \
  --role SystemAdmin \
  --verified
```

### 5. Sincronizar Planos com Stripe

```bash
npm run cli -- stripe sync-plans
```

## 👥 Gerenciamento de Usuários

### Listar Todos os Usuários

```bash
npm run cli -- user list
```

### Listar Apenas Administradores do Sistema

```bash
npm run cli -- user list --role SystemAdmin
```

### Listar Usuários Verificados

```bash
npm run cli -- user list --verified
```

### Criar Usuário Gerente do Sistema

```bash
npm run cli -- user create \
  --email manager@barbershop.com \
  --password Manager123! \
  --name "Gerente do Sistema" \
  --role SystemManager \
  --verified
```

### Atualizar Role de Usuário

```bash
npm run cli -- user update --id 5 --role BarbershopManager
```

### Verificar Estatísticas de Usuários

```bash
npm run cli -- user stats
```

## 🗄️ Gerenciamento de Banco de Dados

### Verificar Status do Banco

```bash
npm run cli -- db status
```

### Fazer Backup do Banco

```bash
npm run cli -- db backup --output backup-$(date +%Y%m%d).db
```

### Restaurar Backup

```bash
npm run cli -- db restore --file backup-20241201.db --force
```

### Limpar Dados Antigos

```bash
# Limpar sessões expiradas
npm run cli -- db cleanup --sessions

# Limpar logs antigos
npm run cli -- db cleanup --logs

# Limpar usuários inativos
npm run cli -- db cleanup --users

# Limpar tudo (mais de 30 dias)
npm run cli -- db cleanup --users --sessions --logs --days 30
```

### Ver Estatísticas do Banco

```bash
npm run cli -- db stats
```

## 💳 Gerenciamento do Stripe

### Verificar Status do Stripe

```bash
npm run cli -- stripe status
```

### Sincronizar Planos

```bash
npm run cli -- stripe sync-plans --force
```

### Sincronizar Clientes

```bash
npm run cli -- stripe sync-customers
```

### Verificar Pagamentos Recentes

```bash
# Últimos 7 dias
npm run cli -- stripe check-payments --days 7

# Sincronizar com banco
npm run cli -- stripe check-payments --days 7 --sync
```

### Criar Webhook

```bash
npm run cli -- stripe create-webhook \
  --url https://api.barbershop.com/webhooks/stripe \
  --events "payment_intent.succeeded,payment_intent.payment_failed"
```

### Listar Webhooks

```bash
npm run cli -- stripe list-webhooks
```

## 📊 Gerenciamento de Análises

### Listar Todas as Análises

```bash
npm run cli -- analysis list
```

### Listar Análises por Tipo

```bash
npm run cli -- analysis list --type LDA
npm run cli -- analysis list --type RGA
npm run cli -- analysis list --type DA
```

### Listar Análises por Status

```bash
npm run cli -- analysis list --status COMPLETED
npm run cli -- analysis list --status FAILED
npm run cli -- analysis list --status PROCESSING
```

### Ver Estatísticas de Análises

```bash
npm run cli -- analysis stats --days 30
```

### Limpar Análises Antigas

```bash
# Apenas análises com falha
npm run cli -- analysis cleanup --failed --force

# Todas as análises antigas
npm run cli -- analysis cleanup --days 30 --force
```

### Exportar Análises

```bash
npm run cli -- analysis export \
  --output analyses-export.csv \
  --days 90 \
  --type LDA
```

### Reparar Análises com Problemas

```bash
# Reparar análises com falha
npm run cli -- analysis repair --failed

# Reparar análises travadas
npm run cli -- analysis repair --stuck
```

### Ver Detalhes de uma Análise

```bash
npm run cli -- analysis show --id 123
```

## 🛠️ Manutenção do Sistema

### Verificar Saúde Geral

```bash
npm run cli -- system health
```

### Limpeza Geral do Sistema

```bash
# Limpar logs
npm run cli -- system cleanup --logs

# Limpar cache
npm run cli -- system cleanup --cache

# Limpar arquivos temporários
npm run cli -- system cleanup --temp

# Limpar tudo
npm run cli -- system cleanup --all
```

### Backup Completo do Sistema

```bash
npm run cli -- system backup \
  --include-config \
  --include-logs \
  --output ./backups
```

### Restaurar Sistema

```bash
npm run cli -- system restore \
  --path ./backups/backup-2024-12-01 \
  --force
```

### Ver Informações do Sistema

```bash
npm run cli -- system info
```

## 🔄 Rotinas de Manutenção

### Rotina Diária

```bash
#!/bin/bash
# daily-maintenance.sh

echo "=== Rotina Diária de Manutenção ==="

# Verificar saúde do sistema
npm run cli -- system health

# Verificar pagamentos do Stripe
npm run cli -- stripe check-payments --days 1 --sync

# Limpar sessões expiradas
npm run cli -- db cleanup --sessions

echo "Rotina diária concluída!"
```

### Rotina Semanal

```bash
#!/bin/bash
# weekly-maintenance.sh

echo "=== Rotina Semanal de Manutenção ==="

# Backup do banco
npm run cli -- db backup --output weekly-backup-$(date +%Y%m%d).db

# Limpar logs antigos
npm run cli -- db cleanup --logs --days 7

# Reparar análises com problemas
npm run cli -- analysis repair --failed
npm run cli -- analysis repair --stuck

# Verificar estatísticas
npm run cli -- user stats
npm run cli -- analysis stats --days 7

echo "Rotina semanal concluída!"
```

### Rotina Mensal

```bash
#!/bin/bash
# monthly-maintenance.sh

echo "=== Rotina Mensal de Manutenção ==="

# Backup completo do sistema
npm run cli -- system backup --include-config --include-logs

# Limpeza geral
npm run cli -- system cleanup --all

# Limpar análises antigas
npm run cli -- analysis cleanup --days 30 --force

# Sincronizar com Stripe
npm run cli -- stripe sync-plans
npm run cli -- stripe sync-customers

echo "Rotina mensal concluída!"
```

## 🚨 Troubleshooting

### Problema: Erro de Conexão com Banco

```bash
# Verificar status do banco
npm run cli -- db status

# Verificar variáveis de ambiente
npm run cli -- system health
```

### Problema: Erro do Stripe

```bash
# Verificar status do Stripe
npm run cli -- stripe status

# Verificar pagamentos
npm run cli -- stripe check-payments --days 1
```

### Problema: Análises Travadas

```bash
# Ver análises com problemas
npm run cli -- analysis list --status PROCESSING

# Reparar análises travadas
npm run cli -- analysis repair --stuck
```

### Problema: Sistema Lento

```bash
# Verificar informações do sistema
npm run cli -- system info

# Limpar dados antigos
npm run cli -- system cleanup --all
```

## 📝 Scripts Úteis

### Criar Usuário de Teste

```bash
#!/bin/bash
# create-test-user.sh

EMAIL="test@barbershop.com"
PASSWORD="Test123!"

npm run cli -- user create \
  --email "$EMAIL" \
  --password "$PASSWORD" \
  --name "Usuário Teste" \
  --role USER \
  --verified

echo "Usuário de teste criado: $EMAIL"
```

### Backup Automático

```bash
#!/bin/bash
# auto-backup.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="./backups"

mkdir -p "$BACKUP_DIR"

# Backup do banco
npm run cli -- db backup --output "$BACKUP_DIR/db_$DATE.db"

# Backup do sistema
npm run cli -- system backup \
  --include-config \
  --output "$BACKUP_DIR/system_$DATE"

echo "Backup automático concluído: $DATE"
```

### Monitor de Saúde

```bash
#!/bin/bash
# health-monitor.sh

# Verificar saúde
npm run cli -- system health

# Se houver problemas, enviar alerta
if [ $? -ne 0 ]; then
    echo "ALERTA: Problemas detectados no sistema!"
    # Aqui você pode adicionar código para enviar email/SMS
fi
```
