const { SmartLogger } = require('./dist/src/common/logger.util');

// Teste das melhorias no sistema de logging
const logger = new SmartLogger('TestImprovements');

console.log('=== Testando Melhorias no Sistema de Logging ===\n');

// Teste 1: Objeto de requisição HTTP (simulando o problema)
const mockRequest = {
  headers: {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    accept: '*/*',
    'content-type': 'application/json',
    authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    cookie:
      '__stripe_mid=c2a21f89-c61a-4b53-a904-d9132a18f9b6d2cca0; __clerk_db_jwt=dvb_2zKNYfrY79Unm6OrbSi4DouPIhs; Authentication=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImlhdCI6MTc1MTU3OTk1OCwiZXhwIjoxNzUxNTgzNTU4fQ.ii5xxTrF20xXHGZZ72MPgYakr7IInZVKUV8mgQx35m0',
  },
  cookies: {
    __stripe_mid: 'c2a21f89-c61a-4b53-a904-d9132a18f9b6d2cca0',
    __clerk_db_jwt: 'dvb_2zKNYfrY79Unm6OrbSi4DouPIhs',
    Authentication:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImlhdCI6MTc1MTU3OTk1OCwiZXhwIjoxNzUxNTgzNTU4fQ.ii5xxTrF20xXHGZZ72MPgYakr7IInZVKUV8mgQx35m0',
  },
  body: {
    operationName: 'GetNotificationCount',
    variables: {},
    query:
      'query GetNotificationCount { myNotificationsCount { unreadCount newCount __typename } }',
  },
  user: {
    id: 1,
    email: 'rafaelsinosak@relable.com',
    fullName: 'Rafael Vieira Sinosaki23',
    role: { id: 3, name: 'Admin' },
  },
};

console.log('1. Testando log de objeto de requisição HTTP:');
logger.logEssential('Request data', mockRequest, ['headers', 'cookies', 'body', 'user']);

// Teste 2: Objeto de usuário
const userData = {
  id: 1,
  email: 'rafaelsinosak@relable.com',
  fullName: 'Rafael Vieira Sinosaki23',
  password: '$2a$10$nI/p4H8eD084aYVhC1kTTuXA3xLtfiCE2.L/Yr9YLDBILsvE8KY9O',
  token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  role: { id: 3, name: 'Admin' },
  address: {
    street: 'Rua das Flores, 123',
    city: 'São Paulo',
    state: 'SP',
    country: 'Brasil',
  },
};

console.log('\n2. Testando log de dados de usuário:');
logger.logEssential('User data', userData, ['id', 'email', 'fullName', 'role']);

// Teste 3: Objeto grande
const largeObject = {
  id: 1,
  data: Array(100)
    .fill(0)
    .map((_, i) => ({
      id: i,
      value: `value-${i}`,
      metadata: {
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        tags: ['tag1', 'tag2', 'tag3'],
      },
    })),
  config: {
    theme: 'dark',
    language: 'pt',
    settings: {
      notifications: true,
      autoSave: true,
      advanced: {
        debug: false,
        performance: true,
        cache: {
          enabled: true,
          ttl: 3600,
          maxSize: 1000,
        },
      },
    },
  },
};

console.log('\n3. Testando log de objeto grande:');
logger.log('Large object test', largeObject);

// Teste 4: Log essencial de objeto grande
console.log('\n4. Testando log essencial de objeto grande:');
logger.logEssential('Large object essential', largeObject, ['id', 'data', 'config']);

console.log('\n=== Teste Concluído ===');
console.log('✅ Logs agora são muito mais limpos e organizados!');
