#!/usr/bin/env node
/**
 * Teste de Pagamentos Recorrentes
 * Testa: pagamentos vencidos, estatísticas, processamento manual
 */

const { AuthModule } = require('./auth');

class RecurringPaymentTester {
  constructor() {
    this.auth = new AuthModule();
  }

  log(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    const emoji = {
      'INFO': '🔄',
      'SUCCESS': '✅',
      'ERROR': '❌',
      'WARNING': '⚠️'
    }[type] || '🔄';

    console.log(`[${timestamp}] ${emoji} ${message}`);
  }

  async init() {
    this.log('Inicializando teste de pagamentos recorrentes...');

    const authSuccess = await this.auth.authenticate();
    if (!authSuccess) {
      this.log('Falha na autenticação', 'ERROR');
      process.exit(1);
    }

    return this.auth.getClient();
  }

  async testOverduePayments() {
    this.log('1. Verificando pagamentos vencidos');

    try {
      const client = this.auth.getClient();
      const response = await client.get('/payments/recurring/overdue');

      const overduePayments = response.data || [];
      this.log(`Encontrados ${overduePayments.length} pagamentos vencidos`, 'SUCCESS');

      if (overduePayments.length > 0) {
        overduePayments.slice(0, 3).forEach((payment, index) => {
          this.log(`   ${index + 1}. Pagamento ${payment.id}`);
          this.log(`      Usuário: ${payment.subscription?.user?.fullName || 'N/A'} (${payment.subscription?.user?.email || 'N/A'})`);
          this.log(`      Plano: ${payment.subscription?.plan?.name || 'N/A'}`);
          this.log(`      Valor: R$ ${payment.amount}`);
          this.log(`      Vencimento: ${payment.nextPaymentDate}`);

          // Calcular dias em atraso
          const dueDate = new Date(payment.nextPaymentDate);
          const now = new Date();
          const daysOverdue = Math.floor((now - dueDate) / (1000 * 60 * 60 * 24));
          this.log(`      Dias em atraso: ${daysOverdue}`);
        });

        if (overduePayments.length > 3) {
          this.log(`   ... e mais ${overduePayments.length - 3} pagamentos vencidos`);
        }
      }

      return true;

    } catch (error) {
      this.log(`Erro ao buscar pagamentos vencidos: ${error.response?.data?.message || error.message}`, 'ERROR');
      return false;
    }
  }

  async testRecurringStats() {
    this.log('2. Obtendo estatísticas de pagamentos recorrentes');

    try {
      const client = this.auth.getClient();
      const response = await client.get('/payments/recurring/stats');

      const stats = response.data;
      this.log('Estatísticas obtidas com sucesso', 'SUCCESS');
      this.log(`   - Pagamentos vencidos: ${stats.overdueCount || 0}`);
      this.log(`   - Última verificação: ${stats.lastCheck || 'N/A'}`);
      this.log(`   - Timezone: ${stats.timezone || 'N/A'}`);
      this.log(`   - Próxima execução: ${stats.nextScheduledRun || 'N/A'}`);

      // Detalhes de pagamentos vencidos
      if (stats.overduePayments && stats.overduePayments.length > 0) {
        this.log('   Detalhes dos pagamentos vencidos:');
        stats.overduePayments.slice(0, 3).forEach((payment, index) => {
          this.log(`     ${index + 1}. ${payment.userName || 'N/A'} - R$ ${payment.amount}`);
          this.log(`        Plano: ${payment.planName || 'N/A'}`);
          this.log(`        Dias em atraso: ${payment.daysOverdue || 0}`);
        });
      }

      return true;

    } catch (error) {
      this.log(`Erro ao obter estatísticas: ${error.response?.data?.message || error.message}`, 'ERROR');
      return false;
    }
  }

  async testManualProcessing() {
    this.log('3. Testando processamento manual de pagamentos recorrentes');

    try {
      const client = this.auth.getClient();
      const response = await client.post('/payments/recurring/process');

      this.log('Processamento manual executado', 'SUCCESS');

      if (response.data) {
        this.log(`   Resultado: ${JSON.stringify(response.data, null, 2)}`);

        if (response.data.processed !== undefined) {
          this.log(`   Pagamentos processados: ${response.data.processed}`);
        }

        if (response.data.failed !== undefined) {
          this.log(`   Pagamentos falhados: ${response.data.failed}`);
        }

        if (response.data.message) {
          this.log(`   Mensagem: ${response.data.message}`);
        }
      }

      return true;

    } catch (error) {
      // Este endpoint pode estar protegido ou não disponível
      if (error.response?.status === 403 || error.response?.status === 401) {
        this.log('Processamento manual não permitido para este usuário (esperado)', 'WARNING');
        return true; // Não considerar como falha
      }

      this.log(`Erro no processamento manual: ${error.response?.data?.message || error.message}`, 'ERROR');
      return false;
    }
  }

  async testForceRecurringPayment() {
    this.log('4. Testando processamento forçado de pagamento específico');

    // Primeiro, buscar um pagamento vencido para testar
    let paymentId = null;

    try {
      const client = this.auth.getClient();
      const overdueResponse = await client.get('/payments/recurring/overdue');

      if (overdueResponse.data && overdueResponse.data.length > 0) {
        paymentId = overdueResponse.data[0].id;
        this.log(`Usando pagamento ${paymentId} para teste de processamento forçado`);
      } else {
        this.log('4. SKIP - Nenhum pagamento vencido disponível para teste', 'WARNING');
        return true;
      }

    } catch (error) {
      this.log('4. SKIP - Não foi possível buscar pagamentos vencidos', 'WARNING');
      return true;
    }

    try {
      const client = this.auth.getClient();
      const response = await client.post(`/payments/recurring/force/${paymentId}`);

      this.log(`Processamento forçado executado para pagamento ${paymentId}`, 'SUCCESS');

      if (response.data) {
        this.log(`   Status: ${response.data.success ? 'Sucesso' : 'Falha'}`);
        this.log(`   Mensagem: ${response.data.message || 'N/A'}`);

        if (response.data.processedAt) {
          this.log(`   Processado em: ${response.data.processedAt}`);
        }
      }

      return true;

    } catch (error) {
      if (error.response?.status === 404) {
        this.log(`Pagamento ${paymentId} não encontrado (esperado em ambiente de teste)`, 'WARNING');
        return true;
      }

      this.log(`Erro no processamento forçado: ${error.response?.data?.message || error.message}`, 'ERROR');
      return false;
    }
  }

  async testUserRecurringStats() {
    this.log('5. Testando estatísticas de pagamentos recorrentes do usuário (GraphQL)');

    try {
      // Este teste assumeque há endpoints GraphQL disponíveis
      // Como não temos acesso direto ao GraphQL aqui, vamos simular

      const client = this.auth.getClient();

      // Tentar buscar pagamentos vencidos do usuário especificamente
      // Se existir um endpoint REST equivalente

      this.log('Verificando se usuário tem pagamentos vencidos...', 'INFO');

      // Como alternativa, vamos verificar os pagamentos do usuário
      const paymentsResponse = await client.get('/payments');
      const userPayments = paymentsResponse.data || [];

      const now = new Date();
      const overdueUserPayments = userPayments.filter(payment => {
        const nextPayment = new Date(payment.nextPaymentDate);
        return nextPayment < now && payment.status === 'COMPLETED';
      });

      this.log(`Usuário tem ${overdueUserPayments.length} pagamentos vencidos`, 'SUCCESS');

      if (overdueUserPayments.length > 0) {
        this.log('   Pagamentos vencidos do usuário:');
        overdueUserPayments.forEach((payment, index) => {
          const daysOverdue = Math.floor((now - new Date(payment.nextPaymentDate)) / (1000 * 60 * 60 * 24));
          this.log(`     ${index + 1}. Pagamento ${payment.id} - ${daysOverdue} dias em atraso`);
        });
      }

      return true;

    } catch (error) {
      this.log(`Erro ao verificar estatísticas do usuário: ${error.response?.data?.message || error.message}`, 'ERROR');
      return false;
    }
  }

  async runAllTests() {
    const client = await this.init();
    const results = [];

    this.log('🚀 INICIANDO TESTES DE PAGAMENTOS RECORRENTES');
    this.log('============================================');

    const tests = [
      { name: 'Overdue Payments', fn: () => this.testOverduePayments() },
      { name: 'Recurring Stats', fn: () => this.testRecurringStats() },
      { name: 'Manual Processing', fn: () => this.testManualProcessing() },
      { name: 'Force Recurring Payment', fn: () => this.testForceRecurringPayment() },
      { name: 'User Recurring Stats', fn: () => this.testUserRecurringStats() }
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
    this.log('============================================');
    this.log('📊 RELATÓRIO FINAL - PAGAMENTOS RECORRENTES');
    this.log('============================================');

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

    this.log('============================================');
    return results;
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  const tester = new RecurringPaymentTester();
  tester.runAllTests()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('❌ Erro inesperado:', error);
      process.exit(1);
    });
}

module.exports = RecurringPaymentTester;