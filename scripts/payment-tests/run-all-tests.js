#!/usr/bin/env node
/**
 * Executor Principal de Todos os Testes de Pagamento
 * Executa todos os testes em sequência e gera relatório consolidado
 */

const SubscriptionTester = require('./test-subscriptions');
const CouponTester = require('./test-coupons');
const RecurringPaymentTester = require('./test-recurring-payments');
const StripeIntegrationTester = require('./test-stripe-integration');

class PaymentTestRunner {
  constructor() {
    this.allResults = [];
    this.startTime = new Date();
  }

  log(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    const emoji = {
      'INFO': '🚀',
      'SUCCESS': '✅',
      'ERROR': '❌',
      'WARNING': '⚠️'
    }[type] || '🚀';

    console.log(`[${timestamp}] ${emoji} ${message}`);
  }

  async runTestSuite(TesterClass, suiteName) {
    this.log(`\n${'='.repeat(60)}`);
    this.log(`INICIANDO SUITE: ${suiteName.toUpperCase()}`);
    this.log(`${'='.repeat(60)}`);

    try {
      const tester = new TesterClass();
      const results = await tester.runAllTests();

      this.allResults.push({
        suite: suiteName,
        results: results,
        timestamp: new Date().toISOString(),
        duration: Date.now() - this.startTime
      });

      const passed = results.filter(r => r.passed).length;
      const total = results.length;

      this.log(`Suite ${suiteName} finalizada: ${passed}/${total} testes passaram`,
                passed === total ? 'SUCCESS' : 'WARNING');

      return { passed, total, results };

    } catch (error) {
      this.log(`Erro na suite ${suiteName}: ${error.message}`, 'ERROR');

      this.allResults.push({
        suite: suiteName,
        error: error.message,
        timestamp: new Date().toISOString(),
        duration: Date.now() - this.startTime
      });

      return { passed: 0, total: 1, results: [{ test: suiteName, passed: false, error: error.message }] };
    }
  }

  generateConsolidatedReport() {
    this.log(`\n${'='.repeat(80)}`);
    this.log('📊 RELATÓRIO CONSOLIDADO - TESTES DE PAGAMENTO');
    this.log(`${'='.repeat(80)}`);

    const endTime = new Date();
    const totalDuration = endTime - this.startTime;

    // Estatísticas gerais
    let totalTests = 0;
    let totalPassed = 0;
    let totalSuites = this.allResults.length;
    let suitesWithErrors = 0;

    this.log(`Início: ${this.startTime.toISOString()}`);
    this.log(`Término: ${endTime.toISOString()}`);
    this.log(`Duração total: ${Math.round(totalDuration / 1000)}s`);
    this.log('-'.repeat(80));

    // Estatísticas por suite
    this.allResults.forEach((suiteResult, index) => {
      if (suiteResult.error) {
        this.log(`${index + 1}. ❌ ${suiteResult.suite} - ERRO: ${suiteResult.error}`, 'ERROR');
        suitesWithErrors++;
        totalTests++;
        return;
      }

      const passed = suiteResult.results.filter(r => r.passed).length;
      const total = suiteResult.results.length;
      const successRate = Math.round((passed / total) * 100);

      totalTests += total;
      totalPassed += passed;

      const status = passed === total ? '✅' : '⚠️';
      this.log(`${index + 1}. ${status} ${suiteResult.suite} - ${passed}/${total} (${successRate}%)`);

      // Listar falhas se houver
      const failures = suiteResult.results.filter(r => !r.passed);
      if (failures.length > 0) {
        failures.forEach(failure => {
          this.log(`     ❌ ${failure.test}${failure.error ? ` - ${failure.error}` : ''}`, 'ERROR');
        });
      }
    });

    // Estatísticas finais
    this.log('-'.repeat(80));
    this.log(`RESUMO GERAL:`);
    this.log(`  Suites executadas: ${totalSuites}`);
    this.log(`  Suites com erro: ${suitesWithErrors}`);
    this.log(`  Total de testes: ${totalTests}`);
    this.log(`  Testes passaram: ${totalPassed}`, totalPassed === totalTests ? 'SUCCESS' : 'WARNING');
    this.log(`  Testes falharam: ${totalTests - totalPassed}`, totalTests - totalPassed === 0 ? 'SUCCESS' : 'ERROR');

    const overallSuccessRate = totalTests > 0 ? Math.round((totalPassed / totalTests) * 100) : 0;
    this.log(`  Taxa de sucesso geral: ${overallSuccessRate}%`, overallSuccessRate >= 80 ? 'SUCCESS' : 'WARNING');

    // Recomendações
    if (overallSuccessRate < 100) {
      this.log('\n⚠️  RECOMENDAÇÕES:', 'WARNING');

      if (suitesWithErrors > 0) {
        this.log('  - Verifique se o backend está executando corretamente');
        this.log('  - Confirme se as credenciais de autenticação estão corretas');
      }

      if (totalTests - totalPassed > 0) {
        this.log('  - Revise os testes que falharam para identificar problemas');
        this.log('  - Alguns falhas podem ser esperadas em ambiente de desenvolvimento');
      }

      this.log('  - Execute testes individuais para análise detalhada');
    } else {
      this.log('\n🎉 PARABÉNS! Todos os testes passaram!', 'SUCCESS');
    }

    this.log(`${'='.repeat(80)}\n`);

    return {
      totalSuites: totalSuites,
      suitesWithErrors: suitesWithErrors,
      totalTests: totalTests,
      totalPassed: totalPassed,
      overallSuccessRate: overallSuccessRate,
      duration: totalDuration,
      results: this.allResults
    };
  }

  async runAllTests() {
    this.log('🚀 INICIANDO EXECUÇÃO COMPLETA DOS TESTES DE PAGAMENTO');
    this.log(`Horário de início: ${this.startTime.toISOString()}`);

    // Definir suites de teste
    const testSuites = [
      { class: SubscriptionTester, name: 'Subscriptions' },
      { class: CouponTester, name: 'Coupons' },
      { class: RecurringPaymentTester, name: 'Recurring Payments' },
      { class: StripeIntegrationTester, name: 'Stripe Integration' }
    ];

    // Executar cada suite
    for (const suite of testSuites) {
      await this.runTestSuite(suite.class, suite.name);

      // Pausa entre suites
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Gerar relatório consolidado
    const finalReport = this.generateConsolidatedReport();

    // Determinar código de saída
    const exitCode = finalReport.overallSuccessRate >= 80 ? 0 : 1;

    if (exitCode === 0) {
      this.log('✅ Testes concluídos com sucesso!', 'SUCCESS');
    } else {
      this.log('❌ Alguns testes falharam. Verifique o relatório acima.', 'ERROR');
    }

    return finalReport;
  }
}

// Função para mostrar ajuda
function showHelp() {
  console.log(`
🚀 Executor de Testes de Pagamento - Barbershop

Uso:
  node run-all-tests.js [opções]

Opções:
  --help              Mostra esta ajuda
  --suite <nome>      Executa apenas uma suite específica:
                      - subscriptions
                      - coupons
                      - recurring
                      - stripe

Exemplos:
  node run-all-tests.js                    # Executa todos os testes
  node run-all-tests.js --suite coupons    # Executa apenas testes de cupons

Suites disponíveis:
  - subscriptions     Testa criação, modificação e consulta de assinaturas
  - coupons          Testa validação e aplicação de cupons de desconto
  - recurring        Testa pagamentos recorrentes e processamento automático
  - stripe           Testa integração com Stripe (métodos de pagamento, etc.)

Para executar testes individuais:
  node test-subscriptions.js
  node test-coupons.js
  node test-recurring-payments.js
  node test-stripe-integration.js
  `);
}

// Executar se chamado diretamente
if (require.main === module) {
  const args = process.argv.slice(2);

  // Verificar argumentos
  if (args.includes('--help')) {
    showHelp();
    process.exit(0);
  }

  // Verificar se deve executar suite específica
  const suiteIndex = args.indexOf('--suite');
  if (suiteIndex !== -1 && args[suiteIndex + 1]) {
    const suiteName = args[suiteIndex + 1].toLowerCase();

    const suiteMap = {
      'subscriptions': SubscriptionTester,
      'coupons': CouponTester,
      'recurring': RecurringPaymentTester,
      'stripe': StripeIntegrationTester
    };

    if (suiteMap[suiteName]) {
      console.log(`🎯 Executando apenas suite: ${suiteName}`);
      const tester = new suiteMap[suiteName]();
      tester.runAllTests()
        .then(() => process.exit(0))
        .catch(error => {
          console.error('❌ Erro:', error);
          process.exit(1);
        });
    } else {
      console.error(`❌ Suite desconhecida: ${suiteName}`);
      console.error('Suites disponíveis: subscriptions, coupons, recurring, stripe');
      process.exit(1);
    }
  } else {
    // Executar todos os testes
    const runner = new PaymentTestRunner();
    runner.runAllTests()
      .then(report => {
        process.exit(report.overallSuccessRate >= 80 ? 0 : 1);
      })
      .catch(error => {
        console.error('❌ Erro inesperado:', error);
        process.exit(1);
      });
  }
}

module.exports = PaymentTestRunner;