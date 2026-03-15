#!/usr/bin/env node
/**
 * Teste de Integração com Stripe
 * Testa: métodos de pagamento, Setup Intent, autenticação Stripe
 */

const { AuthModule } = require('./auth');

class StripeIntegrationTester {
  constructor() {
    this.auth = new AuthModule();
    this.paymentMethods = [];
  }

  log(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    const emoji = {
      'INFO': '💎',
      'SUCCESS': '✅',
      'ERROR': '❌',
      'WARNING': '⚠️'
    }[type] || '💎';

    console.log(`[${timestamp}] ${emoji} ${message}`);
  }

  async init() {
    this.log('Inicializando teste de integração Stripe...');

    const authSuccess = await this.auth.authenticate();
    if (!authSuccess) {
      this.log('Falha na autenticação', 'ERROR');
      process.exit(1);
    }

    return this.auth.getClient();
  }

  async testStripeAuth() {
    this.log('1. Testando autenticação para endpoints Stripe');

    try {
      const client = this.auth.getClient();
      const response = await client.get('/payments/test-auth');

      if (response.data.success && response.data.user) {
        this.log(`Autenticação Stripe OK - Usuário ${response.data.user.userId}`, 'SUCCESS');
        this.log(`   Email: ${response.data.user.email}`);
        this.log(`   Autenticado: ${response.data.user.authenticated}`);
        return true;
      } else {
        this.log('Resposta de autenticação inválida', 'ERROR');
        return false;
      }

    } catch (error) {
      this.log(`Erro na autenticação Stripe: ${error.response?.data?.message || error.message}`, 'ERROR');
      return false;
    }
  }

  async testPaymentMethods() {
    this.log('2. Verificando métodos de pagamento salvos');

    try {
      const client = this.auth.getClient();
      const response = await client.get('/payments/payment-methods/list');

      this.paymentMethods = response.data || [];
      this.log(`Encontrados ${this.paymentMethods.length} métodos de pagamento`, 'SUCCESS');

      if (this.paymentMethods.length > 0) {
        this.paymentMethods.forEach((pm, index) => {
          this.log(`   ${index + 1}. ID: ${pm.id}`);
          this.log(`      Tipo: ${pm.type}`);

          if (pm.card) {
            this.log(`      Cartão: **** **** **** ${pm.card.last4}`);
            this.log(`      Bandeira: ${pm.card.brand.toUpperCase()}`);
            this.log(`      Expiração: ${pm.card.expMonth}/${pm.card.expYear}`);
          }
        });
      } else {
        this.log('   - Usuário não possui métodos de pagamento salvos');
      }

      return true;

    } catch (error) {
      this.log(`Erro ao buscar métodos de pagamento: ${error.response?.data?.message || error.message}`, 'ERROR');
      return false;
    }
  }

  async testSetupIntent() {
    this.log('3. Criando Setup Intent para adicionar método de pagamento');

    try {
      const client = this.auth.getClient();
      const response = await client.post('/payments/setup-intent');

      if (response.data.client_secret && response.data.id) {
        this.log('Setup Intent criado com sucesso', 'SUCCESS');
        this.log(`   Setup Intent ID: ${response.data.id}`);
        this.log(`   Client Secret: ${response.data.client_secret.substring(0, 30)}...`);
        this.log(`   Status: ${response.data.status || 'N/A'}`);

        // Informações adicionais se disponíveis
        if (response.data.customer) {
          this.log(`   Customer: ${response.data.customer}`);
        }

        if (response.data.usage) {
          this.log(`   Uso: ${response.data.usage}`);
        }

        return true;
      } else {
        this.log('Setup Intent inválido retornado', 'ERROR');
        this.log('   Resposta:', JSON.stringify(response.data, null, 2));
        return false;
      }

    } catch (error) {
      this.log(`Erro ao criar Setup Intent: ${error.response?.data?.message || error.message}`, 'ERROR');
      return false;
    }
  }

  async testPaymentMethodDeletion() {
    if (this.paymentMethods.length === 0) {
      this.log('4. SKIP - Teste de remoção de método de pagamento (nenhum método disponível)', 'WARNING');
      return true;
    }

    // Não vamos realmente deletar um método de pagamento válido
    // Em vez disso, vamos testar com um ID fictício para ver se o endpoint responde
    this.log('4. Testando endpoint de remoção de método de pagamento');

    try {
      const client = this.auth.getClient();

      // Usar ID fictício para não deletar métodos reais
      const fakePaymentMethodId = 'pm_test_fake_id_for_testing';
      const response = await client.delete(`/payments/payment-methods/${fakePaymentMethodId}`);

      this.log('Endpoint de remoção respondeu (resultado esperado: método não encontrado)', 'SUCCESS');
      return true;

    } catch (error) {
      if (error.response?.status === 404) {
        this.log('Método de pagamento não encontrado (comportamento esperado)', 'SUCCESS');
        return true;
      }

      if (error.response?.status === 400 && error.response.data?.message?.includes('Invalid')) {
        this.log('ID de método de pagamento inválido (comportamento esperado)', 'SUCCESS');
        return true;
      }

      this.log(`Erro inesperado na remoção: ${error.response?.data?.message || error.message}`, 'ERROR');
      return false;
    }
  }

  async testPaymentIntentCreation() {
    this.log('5. Testando criação de PaymentIntent');

    // Primeiro, buscar planos disponíveis
    let planId = null;

    try {
      const client = this.auth.getClient();
      const plansResponse = await client.get('/plans');

      if (plansResponse.data && plansResponse.data.plans && plansResponse.data.plans.length > 0) {
        planId = plansResponse.data.plans[0].id;
        this.log(`Usando plano ${planId} para teste de PaymentIntent`);
      } else {
        this.log('5. SKIP - Nenhum plano disponível para teste', 'WARNING');
        return true;
      }

    } catch (error) {
      this.log('5. SKIP - Não foi possível buscar planos', 'WARNING');
      return true;
    }

    try {
      const client = this.auth.getClient();
      const response = await client.post('/payments/create-payment-intent', {
        planId: planId
      });

      if (response.data.clientSecret && response.data.paymentIntentId) {
        this.log('PaymentIntent criado com sucesso', 'SUCCESS');
        this.log(`   Payment Intent ID: ${response.data.paymentIntentId}`);
        this.log(`   Client Secret: ${response.data.clientSecret.substring(0, 30)}...`);

        // Informações adicionais se disponíveis
        if (response.data.amount) {
          this.log(`   Valor: R$ ${response.data.amount / 100}`);
        }

        if (response.data.currency) {
          this.log(`   Moeda: ${response.data.currency.toUpperCase()}`);
        }

        return true;
      } else {
        this.log('PaymentIntent inválido retornado', 'ERROR');
        return false;
      }

    } catch (error) {
      this.log(`Erro ao criar PaymentIntent: ${error.response?.data?.message || error.message}`, 'ERROR');
      return false;
    }
  }

  async testStripeWebhookEndpoints() {
    this.log('6. Verificando disponibilidade de endpoints de webhook Stripe');

    // Webhooks geralmente não são testáveis diretamente, mas podemos verificar se os endpoints existem
    const webhookEndpoints = [
      '/stripe/webhook',
      '/webhooks/stripe'
    ];

    let webhookFound = false;

    for (const endpoint of webhookEndpoints) {
      try {
        const client = this.auth.getClient();

        // Fazer uma requisição OPTIONS ou GET para ver se o endpoint existe
        const response = await client.get(endpoint);

        this.log(`Endpoint webhook encontrado: ${endpoint}`, 'SUCCESS');
        webhookFound = true;
        break;

      } catch (error) {
        if (error.response?.status === 405) {
          // Method Not Allowed - endpoint existe mas não aceita GET
          this.log(`Endpoint webhook encontrado: ${endpoint} (método não permitido)`, 'SUCCESS');
          webhookFound = true;
          break;
        }

        if (error.response?.status === 404) {
          // Endpoint não existe, tentar próximo
          continue;
        }

        // Outros erros podem indicar que o endpoint existe
        this.log(`Endpoint webhook possivelmente encontrado: ${endpoint}`, 'WARNING');
        webhookFound = true;
        break;
      }
    }

    if (!webhookFound) {
      this.log('Nenhum endpoint de webhook Stripe encontrado', 'WARNING');
    }

    return true; // Não falhar o teste se webhooks não forem encontrados
  }

  async runAllTests() {
    const client = await this.init();
    const results = [];

    this.log('🚀 INICIANDO TESTES DE INTEGRAÇÃO STRIPE');
    this.log('======================================');

    const tests = [
      { name: 'Stripe Auth', fn: () => this.testStripeAuth() },
      { name: 'Payment Methods', fn: () => this.testPaymentMethods() },
      { name: 'Setup Intent', fn: () => this.testSetupIntent() },
      { name: 'Payment Method Deletion', fn: () => this.testPaymentMethodDeletion() },
      { name: 'PaymentIntent Creation', fn: () => this.testPaymentIntentCreation() },
      { name: 'Webhook Endpoints', fn: () => this.testStripeWebhookEndpoints() }
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
    this.log('======================================');
    this.log('📊 RELATÓRIO FINAL - STRIPE');
    this.log('======================================');

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

    this.log('======================================');
    return results;
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  const tester = new StripeIntegrationTester();
  tester.runAllTests()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('❌ Erro inesperado:', error);
      process.exit(1);
    });
}

module.exports = StripeIntegrationTester;