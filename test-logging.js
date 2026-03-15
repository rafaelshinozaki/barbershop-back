const { SmartLogger } = require('./dist/common/logger.util');

// Teste do sistema de logging
const logger = new SmartLogger('TestLogger');

console.log('=== Testando Sistema de Logging ===\n');

// Teste 1: Log simples
logger.log('Teste de log simples');

// Teste 2: Log com objeto pequeno
logger.log('Teste com objeto pequeno', { id: 1, name: 'Teste' });

// Teste 3: Log com objeto grande
const largeObject = {
  id: 1,
  name: 'Usuário Teste',
  email: 'teste@example.com',
  data: Array(1000)
    .fill(0)
    .map((_, i) => ({ id: i, value: `value-${i}` })),
  config: {
    theme: 'dark',
    language: 'pt',
    settings: {
      notifications: true,
      autoSave: true,
      advanced: {
        debug: false,
        performance: true,
      },
    },
  },
};

logger.log('Teste com objeto grande', largeObject);

// Teste 4: Log essencial
logger.logEssential('Teste log essencial', largeObject, ['id', 'name', 'email']);

// Teste 5: Log com dados sensíveis
const sensitiveData = {
  id: 1,
  email: 'teste@example.com',
  password: 'senha123',
  token: 'jwt-token-here',
  session: 'session-data',
};

logger.log('Teste com dados sensíveis', sensitiveData);

// Teste 6: Log de erro
try {
  throw new Error('Erro de teste');
} catch (error) {
  logger.error('Teste de erro', error);
}

console.log('\n=== Teste Concluído ===');
