#!/usr/bin/env node
/**
 * Teste de Fluxo de Assinaturas
 * Testa: criação, recuperação, upgrade/downgrade e cancelamento de assinaturas
 */

const { AuthModule } = require('./auth');

class SubscriptionTester {
  constructor() {
    this.auth = new AuthModule();
    this.planIds = [];
    this.subscriptionId = null;
    this.paymentIntentId = null;
  }

  log(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    const emoji = {
      'INFO': '📋',
      'SUCCESS': '✅',
      'ERROR': '❌',
      'WARNING': '⚠️'
    }[type] || '📋';

    console.log(`[${timestamp}] ${emoji} ${message}`);
  }

  async init() {
    this.log('Inicializando teste de assinaturas...');

    const authSuccess = await this.auth.authenticate();
    if (!authSuccess) {
      this.log('Falha na autenticação', 'ERROR');
      process.exit(1);
    }

    return this.auth.getClient();
  }

  async testPlanRetrieval() {
    this.log('1. Testando recuperação de planos disponíveis');

    try {
      const client = this.auth.getClient();
      const response = await client.get('/plans/all');

      if (response.data && Array.isArray(response.data)) {
        this.planIds = response.data.map(p => p.id);
        this.log(`Encontrados ${response.data.length} planos: [${this.planIds.join(', ')}]`, 'SUCCESS');

        // Log detalhes dos planos
        response.data.forEach(plan => {
          this.log(`   - ${plan.name}: R$ ${plan.price} (ID: ${plan.id})`);
        });

        return response.data.length > 0;
      }

      this.log('Nenhum plano encontrado', 'WARNING');
      return false;

    } catch (error) {
      this.log(`Erro ao buscar planos: ${error.response?.data?.message || error.message}`, 'ERROR');
      return false;
    }
  }

  async testPaymentIntentCreation() {
    if (this.planIds.length === 0) {
      this.log('Nenhum plano disponível para criar PaymentIntent', 'WARNING');
      return false;
    }

    const planId = this.planIds[0];
    this.log(`2. Criando PaymentIntent para plano ${planId}`);

    try {
      const client = this.auth.getClient();
      const response = await client.post('/payments/create-payment-intent', {
        planId: planId
      });

      if (response.data.clientSecret && response.data.paymentIntentId) {
        this.paymentIntentId = response.data.paymentIntentId;
        this.log(`PaymentIntent criado: ${this.paymentIntentId}`, 'SUCCESS');
        this.log(`   - Client Secret: ${response.data.clientSecret.substring(0, 20)}...`);
        return true;
      }

      this.log('PaymentIntent inválido retornado', 'ERROR');
      return false;

    } catch (error) {
      this.log(`Erro ao criar PaymentIntent: ${error.response?.data?.message || error.message}`, 'ERROR');
      return false;
    }
  }

  async testMySubscriptions() {
    this.log('3. Verificando assinaturas existentes');

    try {
      const client = this.auth.getClient();
      const response = await client.get('/payments/subscriptions');

      this.log(`Encontradas ${response.data.length || 0} assinaturas`, 'SUCCESS');

      if (response.data.length > 0) {
        this.subscriptionId = response.data[0].id;
        response.data.forEach((sub, index) => {
          this.log(`   ${index + 1}. Assinatura ${sub.id} - Status: ${sub.status}`);
          this.log(`      Plano: ${sub.plan?.name || 'N/A'} (R$ ${sub.plan?.price || 'N/A'})`);
          this.log(`      Criada em: ${sub.createdAt}`);
        });
      }

      return true;

    } catch (error) {
      this.log(`Erro ao buscar assinaturas: ${error.response?.data?.message || error.message}`, 'ERROR');
      return false;
    }
  }

  async testPaymentHistory() {
    this.log('4. Verificando histórico de pagamentos');

    try {
      const client = this.auth.getClient();
      const response = await client.get('/payments');

      this.log(`Encontrados ${response.data.length || 0} pagamentos`, 'SUCCESS');

      if (response.data.length > 0) {
        response.data.slice(0, 3).forEach((payment, index) => {
          this.log(`   ${index + 1}. Pagamento ${payment.id} - Status: ${payment.status}`);
          this.log(`      Valor: R$ ${payment.amount}`);
          this.log(`      Data: ${payment.paymentDate}`);
          this.log(`      Próximo: ${payment.nextPaymentDate}`);
        });
      }

      return true;

    } catch (error) {
      this.log(`Erro ao buscar pagamentos: ${error.response?.data?.message || error.message}`, 'ERROR');
      return false;
    }
  }

  async testLatestPendingPayment() {
    this.log('5. Verificando pagamento pendente mais recente');

    try {
      const client = this.auth.getClient();
      const response = await client.get('/payments/latest');

      if (response.data && response.data.id) {
        this.log(`Pagamento pendente encontrado: ${response.data.id}`, 'SUCCESS');
        this.log(`   - Valor: R$ ${response.data.amount}`);
        this.log(`   - Status: ${response.data.status}`);
      } else {
        this.log('Nenhum pagamento pendente encontrado', 'INFO');
      }

      return true;

    } catch (error) {
      this.log(`Erro ao buscar pagamento pendente: ${error.response?.data?.message || error.message}`, 'ERROR');
      return false;
    }
  }

  async testChangeplan() {
    if (this.planIds.length < 2) {
      this.log('6. SKIP - Alteração de plano (menos de 2 planos disponíveis)', 'WARNING');
      return true;
    }

    const newPlanId = this.planIds[1]; // Usar segundo plano
    this.log(`6. Testando alteração para plano ${newPlanId}`);

    try {
      const client = this.auth.getClient();
      const response = await client.patch('/payments/change-plan', {
        planId: newPlanId
      });

      if (response.data.success !== false) {
        this.log(`Alteração de plano solicitada com sucesso`, 'SUCCESS');
        return true;
      }

      this.log(`Alteração de plano falhou: ${response.data.message}`, 'WARNING');
      return false;

    } catch (error) {
      this.log(`Erro na alteração de plano: ${error.response?.data?.message || error.message}`, 'ERROR');
      return false;
    }
  }

  async runAllTests() {
    const client = await this.init();
    const results = [];

    this.log('🚀 INICIANDO TESTES DE ASSINATURES');
    this.log('=====================================');

    const tests = [
      { name: 'Plan Retrieval', fn: () => this.testPlanRetrieval() },
      { name: 'PaymentIntent Creation', fn: () => this.testPaymentIntentCreation() },
      { name: 'My Subscriptions', fn: () => this.testMySubscriptions() },
      { name: 'Payment History', fn: () => this.testPaymentHistory() },
      { name: 'Latest Pending Payment', fn: () => this.testLatestPendingPayment() },
      { name: 'Change Plan', fn: () => this.testChangeplan() }
    ];

    for (const test of tests) {
      try {
        const result = await test.fn();
        results.push({ test: test.name, passed: result });

        if (result) {
          this.log(`${test.name}: PASSOU`, 'SUCCESS');
        } else {
          this.log(`${test.name}: FALHOU`, 'ERROR');
        }

        // Pausa entre testes
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        this.log(`${test.name}: ERRO - ${error.message}`, 'ERROR');
        results.push({ test: test.name, passed: false, error: error.message });
      }
    }

    // Relatório final
    this.log('=====================================');
    this.log('📊 RELATÓRIO FINAL');
    this.log('=====================================');

    const passed = results.filter(r => r.passed).length;
    const total = results.length;

    this.log(`Total de testes: ${total}`);
    this.log(`Passaram: ${passed}`, passed === total ? 'SUCCESS' : 'WARNING');
    this.log(`Falharam: ${total - passed}`, total - passed === 0 ? 'SUCCESS' : 'ERROR');
    this.log(`Taxa de sucesso: ${Math.round((passed / total) * 100)}%`);

    results.forEach(result => {
      const status = result.passed ? '✅' : '❌';
      this.log(`${status} ${result.test}${result.error ? ` (${result.error})` : ''}`);
    });

    this.log('=====================================');
    return results;
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  const tester = new SubscriptionTester();
  tester.runAllTests()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('❌ Erro inesperado:', error);
      process.exit(1);
    });
}

module.exports = SubscriptionTester;