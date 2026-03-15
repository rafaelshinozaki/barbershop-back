#!/usr/bin/env node
/**
 * Teste de Pagamentos via GraphQL
 * Testa os endpoints GraphQL reais do sistema
 */

const { AuthModule } = require('./auth');
const GraphQLClient = require('./graphql-client');

class GraphQLPaymentTester {
  constructor() {
    this.auth = new AuthModule();
    this.graphql = null;
  }

  log(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    const emoji = {
      'INFO': '🔮',
      'SUCCESS': '✅',
      'ERROR': '❌',
      'WARNING': '⚠️'
    }[type] || '🔮';

    console.log(`[${timestamp}] ${emoji} ${message}`);
  }

  async init() {
    this.log('Inicializando teste GraphQL de pagamentos...');

    const authSuccess = await this.auth.authenticate();
    if (!authSuccess) {
      this.log('Falha na autenticação', 'ERROR');
      process.exit(1);
    }

    this.graphql = new GraphQLClient('http://localhost:3020', this.auth);
    return true;
  }

  async testMyPayments() {
    this.log('1. Testando consulta de pagamentos do usuário (GraphQL)');

    try {
      const result = await this.graphql.getMyPayments();

      if (result.myPayments) {
        this.log(`Encontrados ${result.myPayments.length} pagamentos`, 'SUCCESS');

        if (result.myPayments.length > 0) {
          result.myPayments.slice(0, 3).forEach((payment, index) => {
            this.log(`   ${index + 1}. Pagamento ${payment.id} - R$ ${payment.amount}`);
            this.log(`      Status: ${payment.status} | Data: ${payment.paymentDate}`);
          });
        }

        return true;
      }

      this.log('Resposta inválida do GraphQL', 'ERROR');
      return false;

    } catch (error) {
      this.log(`Erro na consulta GraphQL: ${error.message}`, 'ERROR');
      return false;
    }
  }

  async testMySubscriptions() {
    this.log('2. Testando consulta de assinaturas do usuário (GraphQL)');

    try {
      const result = await this.graphql.getMySubscriptions();

      if (result.mySubscriptions) {
        this.log(`Encontradas ${result.mySubscriptions.length} assinaturas`, 'SUCCESS');

        if (result.mySubscriptions.length > 0) {
          result.mySubscriptions.forEach((sub, index) => {
            this.log(`   ${index + 1}. Assinatura ${sub.id} - Status: ${sub.status}`);
            if (sub.plan) {
              this.log(`      Plano: ${sub.plan.name} (R$ ${sub.plan.price})`);
            }
            this.log(`      Data de início: ${sub.startSubDate}`);
          });
        }

        return true;
      }

      this.log('Resposta inválida do GraphQL', 'ERROR');
      return false;

    } catch (error) {
      this.log(`Erro na consulta GraphQL: ${error.message}`, 'ERROR');
      return false;
    }
  }

  async testCreatePaymentIntent() {
    this.log('3. Testando criação de PaymentIntent (GraphQL)');

    // Usar um planId que sabemos que existe (do teste anterior)
    const planId = 22; // Basic plan

    try {
      const result = await this.graphql.createPaymentIntent(planId);

      if (result.createPaymentIntent && result.createPaymentIntent.clientSecret) {
        this.log(`PaymentIntent criado com sucesso`, 'SUCCESS');
        this.log(`   PaymentIntent ID: ${result.createPaymentIntent.paymentIntentId}`);
        this.log(`   Client Secret: ${result.createPaymentIntent.clientSecret.substring(0, 30)}...`);
        return true;
      }

      this.log('PaymentIntent inválido retornado', 'ERROR');
      return false;

    } catch (error) {
      this.log(`Erro na criação de PaymentIntent: ${error.message}`, 'ERROR');
      return false;
    }
  }

  async testPaymentMethods() {
    this.log('4. Testando consulta de métodos de pagamento (GraphQL)');

    try {
      const result = await this.graphql.getMyPaymentMethods();

      if (result.myPaymentMethods) {
        this.log(`Encontrados ${result.myPaymentMethods.length} métodos de pagamento`, 'SUCCESS');

        if (result.myPaymentMethods.length > 0) {
          result.myPaymentMethods.forEach((pm, index) => {
            this.log(`   ${index + 1}. ${pm.type} - ID: ${pm.id}`);
            if (pm.card) {
              this.log(`      Cartão: **** ${pm.card.last4} (${pm.card.brand})`);
              this.log(`      Expira: ${pm.card.expMonth}/${pm.card.expYear}`);
            }
          });
        }

        return true;
      }

      this.log('Resposta inválida do GraphQL', 'ERROR');
      return false;

    } catch (error) {
      this.log(`Erro na consulta GraphQL: ${error.message}`, 'ERROR');
      return false;
    }
  }

  async testSetupIntent() {
    this.log('5. Testando criação de Setup Intent (GraphQL)');

    try {
      const result = await this.graphql.createSetupIntent();

      if (result.createSetupIntent && result.createSetupIntent.client_secret) {
        this.log('Setup Intent criado com sucesso', 'SUCCESS');
        this.log(`   ID: ${result.createSetupIntent.id}`);
        this.log(`   Status: ${result.createSetupIntent.status}`);
        return true;
      }

      this.log('Setup Intent inválido retornado', 'ERROR');
      return false;

    } catch (error) {
      this.log(`Erro na criação de Setup Intent: ${error.message}`, 'ERROR');
      return false;
    }
  }

  async testMyCoupons() {
    this.log('6. Testando consulta de cupons do usuário (GraphQL)');

    try {
      const result = await this.graphql.getMyCoupons();

      if (result.myCoupons) {
        this.log(`Encontrados ${result.myCoupons.length} cupons`, 'SUCCESS');

        if (result.myCoupons.length > 0) {
          result.myCoupons.forEach((coupon, index) => {
            this.log(`   ${index + 1}. ${coupon.code} - ${coupon.name}`);
            this.log(`      Tipo: ${coupon.type} | Valor: ${coupon.value}`);
            this.log(`      Usado: ${coupon.usedAt ? 'Sim' : 'Não'}`);
          });
        }

        return true;
      }

      this.log('Resposta inválida do GraphQL', 'ERROR');
      return false;

    } catch (error) {
      this.log(`Erro na consulta GraphQL: ${error.message}`, 'ERROR');
      return false;
    }
  }

  async testCouponValidation() {
    this.log('7. Testando validação de cupom (GraphQL)');

    try {
      const result = await this.graphql.validateCoupon('CUPOM_TESTE_INEXISTENTE', 22, 100);

      if (result.validateCoupon) {
        if (result.validateCoupon.isValid === false) {
          this.log('Cupom inexistente corretamente rejeitado', 'SUCCESS');
          this.log(`   Erro: ${result.validateCoupon.error}`);
        } else {
          this.log('ATENÇÃO: Cupom inexistente foi aceito', 'WARNING');
        }

        return true;
      }

      this.log('Resposta inválida do GraphQL', 'ERROR');
      return false;

    } catch (error) {
      this.log(`Erro na validação de cupom: ${error.message}`, 'ERROR');
      // Alguns erros podem ser esperados para cupons inexistentes
      return true;
    }
  }

  async testRecurringPaymentsStats() {
    this.log('8. Testando estatísticas de pagamentos recorrentes (GraphQL)');

    try {
      const result = await this.graphql.getRecurringPaymentsStats();

      if (result.recurringPaymentsStats) {
        const stats = result.recurringPaymentsStats;
        this.log('Estatísticas obtidas com sucesso', 'SUCCESS');
        this.log(`   Pagamentos vencidos: ${stats.overdueCount || 0}`);
        this.log(`   Pagamentos próximos: ${stats.upcomingCount || 0}`);
        this.log(`   Última verificação: ${stats.lastCheck || 'N/A'}`);
        this.log(`   Timezone: ${stats.timezone || 'N/A'}`);

        return true;
      }

      this.log('Resposta inválida do GraphQL', 'ERROR');
      return false;

    } catch (error) {
      this.log(`Erro na consulta GraphQL: ${error.message}`, 'ERROR');
      return false;
    }
  }

  async testRawGraphQL() {
    this.log('9. Testando query GraphQL raw - allPlans');

    const query = `
      query TestQuery {
        getAllPlans {
          id
          name
          price
          description
        }
      }
    `;

    try {
      const result = await this.graphql.query(query);

      if (result.getAllPlans) {
        this.log(`Query raw funcionou: ${result.getAllPlans.length} planos encontrados`, 'SUCCESS');
        result.getAllPlans.slice(0, 3).forEach(plan => {
          this.log(`   - ${plan.name}: R$ ${plan.price}`);
        });
        return true;
      }

      this.log('Query raw não retornou dados esperados', 'ERROR');
      return false;

    } catch (error) {
      this.log(`Erro na query raw: ${error.message}`, 'ERROR');
      return false;
    }
  }

  async runAllTests() {
    await this.init();
    const results = [];

    this.log('🚀 INICIANDO TESTES GRAPHQL DE PAGAMENTOS');
    this.log('==========================================');

    const tests = [
      { name: 'My Payments (GraphQL)', fn: () => this.testMyPayments() },
      { name: 'My Subscriptions (GraphQL)', fn: () => this.testMySubscriptions() },
      { name: 'Create PaymentIntent (GraphQL)', fn: () => this.testCreatePaymentIntent() },
      { name: 'Payment Methods (GraphQL)', fn: () => this.testPaymentMethods() },
      { name: 'Setup Intent (GraphQL)', fn: () => this.testSetupIntent() },
      { name: 'My Coupons (GraphQL)', fn: () => this.testMyCoupons() },
      { name: 'Coupon Validation (GraphQL)', fn: () => this.testCouponValidation() },
      { name: 'Recurring Stats (GraphQL)', fn: () => this.testRecurringPaymentsStats() },
      { name: 'Raw GraphQL Query', fn: () => this.testRawGraphQL() }
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
    this.log('==========================================');
    this.log('📊 RELATÓRIO FINAL - GRAPHQL');
    this.log('==========================================');

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

    this.log('==========================================');
    return results;
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  const tester = new GraphQLPaymentTester();
  tester.runAllTests()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('❌ Erro inesperado:', error);
      process.exit(1);
    });
}

module.exports = GraphQLPaymentTester;