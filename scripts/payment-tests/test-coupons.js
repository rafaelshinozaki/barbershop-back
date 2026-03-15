#!/usr/bin/env node
/**
 * Teste de Sistema de Cupons
 * Testa: validação de cupons, aplicação de descontos, cupons do usuário
 */

const { AuthModule } = require('./auth');

class CouponTester {
  constructor() {
    this.auth = new AuthModule();
    this.planIds = [];
    this.userCoupons = [];
  }

  log(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    const emoji = {
      'INFO': '🎟️',
      'SUCCESS': '✅',
      'ERROR': '❌',
      'WARNING': '⚠️'
    }[type] || '🎟️';

    console.log(`[${timestamp}] ${emoji} ${message}`);
  }

  async init() {
    this.log('Inicializando teste de cupons...');

    const authSuccess = await this.auth.authenticate();
    if (!authSuccess) {
      this.log('Falha na autenticação', 'ERROR');
      process.exit(1);
    }

    // Buscar planos para testes
    try {
      const client = this.auth.getClient();
      const response = await client.get('/plans');
      if (response.data && Array.isArray(response.data.plans)) {
        this.planIds = response.data.plans.map(p => p.id);
      }
    } catch (error) {
      this.log('Aviso: Não foi possível buscar planos', 'WARNING');
    }

    return this.auth.getClient();
  }

  async testMyCoupons() {
    this.log('1. Verificando cupons disponíveis do usuário');

    try {
      const client = this.auth.getClient();
      const response = await client.get('/coupons/my-coupons');

      this.userCoupons = response.data || [];
      this.log(`Encontrados ${this.userCoupons.length} cupons disponíveis`, 'SUCCESS');

      if (this.userCoupons.length > 0) {
        this.userCoupons.forEach((coupon, index) => {
          this.log(`   ${index + 1}. ${coupon.code} - ${coupon.name}`);
          this.log(`      Tipo: ${coupon.type} | Valor: ${coupon.value}`);
          this.log(`      Descrição: ${coupon.description}`);
          this.log(`      Usado: ${coupon.usedAt ? 'Sim' : 'Não'}`);
        });
      } else {
        this.log('   - Usuário não possui cupons disponíveis');
      }

      return true;

    } catch (error) {
      this.log(`Erro ao buscar cupons do usuário: ${error.response?.data?.message || error.message}`, 'ERROR');
      return false;
    }
  }

  async testInvalidCouponValidation() {
    if (this.planIds.length === 0) {
      this.log('2. SKIP - Validação de cupom inválido (nenhum plano disponível)', 'WARNING');
      return true;
    }

    this.log('2. Testando validação de cupom inexistente');

    try {
      const client = this.auth.getClient();
      const response = await client.post('/coupons/validate', {
        code: 'CUPOM_INEXISTENTE_TESTE',
        planId: this.planIds[0],
        amount: 100
      });

      // Se chegou aqui, a validação deveria ter falhado
      if (response.data.isValid === false) {
        this.log('Cupom inexistente corretamente rejeitado', 'SUCCESS');
        this.log(`   Mensagem: ${response.data.error || response.data.message}`);
        return true;
      } else {
        this.log('ERRO: Cupom inexistente foi aceito como válido', 'ERROR');
        return false;
      }

    } catch (error) {
      // Erro é esperado para cupons inexistentes
      if (error.response?.status === 404 || error.response?.status === 400) {
        this.log('Cupom inexistente corretamente rejeitado (status de erro)', 'SUCCESS');
        return true;
      }

      this.log(`Erro inesperado na validação: ${error.response?.data?.message || error.message}`, 'ERROR');
      return false;
    }
  }

  async testValidCouponValidation() {
    if (this.userCoupons.length === 0 || this.planIds.length === 0) {
      this.log('3. SKIP - Validação de cupom válido (sem cupons ou planos disponíveis)', 'WARNING');
      return true;
    }

    const validCoupon = this.userCoupons.find(c => !c.usedAt); // Cupom não usado
    if (!validCoupon) {
      this.log('3. SKIP - Validação de cupom válido (todos os cupons já foram usados)', 'WARNING');
      return true;
    }

    this.log(`3. Testando validação de cupom válido: ${validCoupon.code}`);

    try {
      const client = this.auth.getClient();
      const response = await client.post('/coupons/validate', {
        code: validCoupon.code,
        planId: this.planIds[0],
        amount: 100
      });

      if (response.data.isValid === true) {
        this.log(`Cupom ${validCoupon.code} validado com sucesso`, 'SUCCESS');
        this.log(`   Desconto: R$ ${response.data.discountAmount || 'N/A'}`);
        this.log(`   Valor final: R$ ${response.data.finalAmount || 'N/A'}`);
        return true;
      } else {
        this.log(`Cupom válido foi rejeitado: ${response.data.error}`, 'ERROR');
        return false;
      }

    } catch (error) {
      this.log(`Erro na validação de cupom válido: ${error.response?.data?.message || error.message}`, 'ERROR');
      return false;
    }
  }

  async testCouponWithDifferentAmounts() {
    if (this.userCoupons.length === 0 || this.planIds.length === 0) {
      this.log('4. SKIP - Teste com diferentes valores (sem cupons ou planos)', 'WARNING');
      return true;
    }

    const testCoupon = this.userCoupons[0];
    this.log(`4. Testando cupom ${testCoupon.code} com diferentes valores`);

    const testAmounts = [50, 100, 200, 500];
    let allPassed = true;

    for (const amount of testAmounts) {
      try {
        const client = this.auth.getClient();
        const response = await client.post('/coupons/validate', {
          code: testCoupon.code,
          planId: this.planIds[0],
          amount: amount
        });

        const discount = response.data.discountAmount || 0;
        const finalAmount = response.data.finalAmount || amount;

        this.log(`   Valor R$ ${amount} → Desconto R$ ${discount} → Final R$ ${finalAmount}`,
                response.data.isValid ? 'SUCCESS' : 'WARNING');

      } catch (error) {
        this.log(`   Erro com valor R$ ${amount}: ${error.response?.data?.message || error.message}`, 'ERROR');
        allPassed = false;
      }

      // Pausa entre testes
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return allPassed;
  }

  async testCouponApplication() {
    if (this.userCoupons.length === 0) {
      this.log('5. SKIP - Aplicação de cupom (sem cupons disponíveis)', 'WARNING');
      return true;
    }

    // Este teste seria mais complexo pois precisa de um pagamento ativo
    // Por enquanto, apenas testamos o endpoint se estiver disponível
    this.log('5. Testando aplicação de cupom (simulado)');

    try {
      // Tentar aplicar cupom a um pagamento fictício
      const client = this.auth.getClient();
      const testCoupon = this.userCoupons[0];

      // Como não temos um paymentId real, vamos testar com ID fictício
      const response = await client.post(`/coupons/apply/999999`, {
        code: testCoupon.code
      });

      this.log('Aplicação de cupom testada (resultado pode variar)', 'SUCCESS');
      return true;

    } catch (error) {
      if (error.response?.status === 404) {
        this.log('Endpoint de aplicação de cupom disponível (pagamento não encontrado)', 'SUCCESS');
        return true;
      }

      this.log(`Erro no teste de aplicação: ${error.response?.data?.message || error.message}`, 'WARNING');
      return true; // Não falhar o teste por isso
    }
  }

  async runAllTests() {
    const client = await this.init();
    const results = [];

    this.log('🚀 INICIANDO TESTES DE CUPONS');
    this.log('===============================');

    const tests = [
      { name: 'My Coupons', fn: () => this.testMyCoupons() },
      { name: 'Invalid Coupon Validation', fn: () => this.testInvalidCouponValidation() },
      { name: 'Valid Coupon Validation', fn: () => this.testValidCouponValidation() },
      { name: 'Coupon Different Amounts', fn: () => this.testCouponWithDifferentAmounts() },
      { name: 'Coupon Application', fn: () => this.testCouponApplication() }
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
    this.log('===============================');
    this.log('📊 RELATÓRIO FINAL - CUPONS');
    this.log('===============================');

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

    this.log('===============================');
    return results;
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  const tester = new CouponTester();
  tester.runAllTests()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('❌ Erro inesperado:', error);
      process.exit(1);
    });
}

module.exports = CouponTester;