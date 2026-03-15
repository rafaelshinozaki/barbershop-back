# Testes de Fluxos de Pagamento - Relable

Suite completa de testes para validar todas as implementações e fluxos do sistema de pagamentos do Relable.

## 📁 Estrutura

```
scripts/payment-tests/
├── auth.js                        # Módulo de autenticação para ambiente local
├── test-subscriptions.js          # Testes de assinaturas
├── test-coupons.js                # Testes de sistema de cupons
├── test-recurring-payments.js     # Testes de pagamentos recorrentes
├── test-stripe-integration.js     # Testes de integração Stripe
├── run-all-tests.js              # Executor principal
└── README.md                      # Esta documentação
```

## 🚀 Como Executar

### Todos os Testes
```bash
# Executar todos os testes
node scripts/payment-tests/run-all-tests.js

# Ver ajuda
node scripts/payment-tests/run-all-tests.js --help
```

### Testes Específicos
```bash
# Executar suite específica
node scripts/payment-tests/run-all-tests.js --suite subscriptions
node scripts/payment-tests/run-all-tests.js --suite coupons
node scripts/payment-tests/run-all-tests.js --suite recurring
node scripts/payment-tests/run-all-tests.js --suite stripe

# Executar teste individual
node scripts/payment-tests/test-subscriptions.js
node scripts/payment-tests/test-coupons.js
node scripts/payment-tests/test-recurring-payments.js
node scripts/payment-tests/test-stripe-integration.js
```

## 🧪 Suites de Teste

### 1. **Subscriptions (test-subscriptions.js)**
Testa o fluxo completo de assinaturas:

- ✅ Recuperação de planos disponíveis
- ✅ Criação de PaymentIntent
- ✅ Consulta de assinaturas do usuário
- ✅ Histórico de pagamentos
- ✅ Pagamentos pendentes
- ✅ Alteração de planos

**Endpoints testados:**
- `GET /plans`
- `POST /payments/create-payment-intent`
- `GET /payments/subscriptions`
- `GET /payments`
- `GET /payments/latest`
- `PATCH /payments/change-plan`

### 2. **Coupons (test-coupons.js)**
Testa o sistema de cupons de desconto:

- ✅ Consulta de cupons do usuário
- ✅ Validação de cupons inexistentes
- ✅ Validação de cupons válidos
- ✅ Teste com diferentes valores
- ✅ Aplicação de cupons

**Endpoints testados:**
- `GET /coupons/my-coupons`
- `POST /coupons/validate`
- `POST /coupons/apply/:paymentId`

### 3. **Recurring Payments (test-recurring-payments.js)**
Testa pagamentos recorrentes e processamento automático:

- ✅ Consulta de pagamentos vencidos
- ✅ Estatísticas de pagamentos recorrentes
- ✅ Processamento manual
- ✅ Processamento forçado de pagamento específico
- ✅ Estatísticas do usuário

**Endpoints testados:**
- `GET /payments/recurring/overdue`
- `GET /payments/recurring/stats`
- `POST /payments/recurring/process`
- `POST /payments/recurring/force/:paymentId`

### 4. **Stripe Integration (test-stripe-integration.js)**
Testa integração com Stripe:

- ✅ Autenticação para Stripe
- ✅ Consulta de métodos de pagamento
- ✅ Criação de Setup Intent
- ✅ Remoção de métodos de pagamento
- ✅ Criação de PaymentIntent
- ✅ Verificação de endpoints de webhook

**Endpoints testados:**
- `GET /payments/test-auth`
- `GET /payments/payment-methods/list`
- `POST /payments/setup-intent`
- `DELETE /payments/payment-methods/:id`
- `POST /payments/create-payment-intent`

## 🔐 Autenticação

O módulo `auth.js` gerencia a autenticação automática usando credenciais locais:

- **Email:** `rafael.lima@relable.com`
- **Senha:** `pwned`

### Configuração
```javascript
const CONFIG = {
  API_URL: process.env.API_URL || 'http://localhost:3020',
  EMAIL: 'rafael.lima@relable.com',
  PASSWORD: 'pwned'
};
```

## 📊 Relatórios

### Formato de Saída
Cada teste gera logs detalhados com:
- ✅ **Timestamps** precisos
- ✅ **Status colorizado** (Success/Error/Warning)
- ✅ **Detalhes** de cada operação
- ✅ **Estatísticas finais** de sucesso

### Exemplo de Relatório
```
[2024-XX-XXTXX:XX:XX.XXXZ] 🚀 INICIANDO TESTES DE ASSINATURES
=====================================
[2024-XX-XXTXX:XX:XX.XXXZ] ✅ Encontrados 3 planos: [1, 2, 3]
[2024-XX-XXTXX:XX:XX.XXXZ] ✅ PaymentIntent criado: pi_XXXXXXXXXX
...
=====================================
📊 RELATÓRIO FINAL
=====================================
Total de testes: 6
✅ Passaram: 6
❌ Falharam: 0
📈 Taxa de sucesso: 100%
```

## 🛠️ Pré-requisitos

### Ambiente
1. **Backend rodando:** `cd back && pnpm start:dev`
2. **Porta 3020** disponível
3. **Banco de dados** configurado
4. **Stripe configurado** no ambiente

### Dependências
Utiliza dependências já instaladas no projeto:
- `axios` (HTTP client)
- Módulos nativos do Node.js

### Verificação de Ambiente
```bash
# Verificar se backend está rodando
curl http://localhost:3020/health

# Deve retornar:
# {"status":"ok","database":"connected","stripe":"available"...}
```

## 🔧 Customização

### Modificar Credenciais
Edite `auth.js`:
```javascript
const CONFIG = {
  API_URL: process.env.API_URL || 'http://localhost:3020',
  EMAIL: 'seu-email@relable.com',
  PASSWORD: 'sua-senha'
};
```

### Adicionar Novos Testes
1. Crie novo arquivo `test-nova-funcionalidade.js`
2. Siga o padrão dos arquivos existentes
3. Adicione no `run-all-tests.js`:

```javascript
const NovaFuncionalidadeTester = require('./test-nova-funcionalidade');

const testSuites = [
  // ... suites existentes
  { class: NovaFuncionalidadeTester, name: 'Nova Funcionalidade' }
];
```

## 🚨 Troubleshooting

### Problemas Comuns

1. **Erro 404 em endpoints**
   - Verifique se o backend está rodando
   - Confirme as rotas no código fonte

2. **Falha na autenticação**
   - Verifique credenciais em `auth.js`
   - Confirme que o usuário existe no banco

3. **Timeouts**
   - Backend pode estar sobrecarregado
   - Aumente timeout em `auth.js`

4. **Testes falhando**
   - Alguns falhas são esperadas em ambiente de dev
   - Revise logs detalhados para diagnóstico

### Debug
Execute com logs detalhados:
```bash
# Os scripts já incluem logging verbose
node scripts/payment-tests/test-subscriptions.js
```

## 📈 Extensões Futuras

- [ ] Testes de GraphQL queries
- [ ] Testes de performance
- [ ] Testes de concorrência
- [ ] Integração com CI/CD
- [ ] Testes de regressão
- [ ] Mocks para Stripe em ambiente de teste

---

**Versão:** 1.0.0
**Autor:** Claude Code
**Data:** 2024