// test-security-headers.js
const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/health',
  method: 'GET',
  headers: {
    'User-Agent': 'Security-Test-Script',
  },
};

console.log('🔒 Testando Headers de Segurança...\n');

const req = http.request(options, (res) => {
  console.log(`📡 Status: ${res.statusCode}`);
  console.log(`📡 URL: ${options.hostname}:${options.port}${options.path}\n`);

  console.log('🛡️ Headers de Segurança Encontrados:\n');

  const securityHeaders = [
    'x-content-type-options',
    'x-frame-options',
    'x-xss-protection',
    'x-download-options',
    'x-permitted-cross-domain-policies',
    'strict-transport-security',
    'content-security-policy',
    'cross-origin-embedder-policy',
    'cross-origin-opener-policy',
    'cross-origin-resource-policy',
    'x-dns-prefetch-control',
    'referrer-policy',
    'permissions-policy',
    'origin-agent-cluster',
  ];

  let foundHeaders = 0;
  let missingHeaders = [];

  securityHeaders.forEach((header) => {
    const value = res.headers[header];
    if (value) {
      console.log(`✅ ${header}: ${value}`);
      foundHeaders++;
    } else {
      missingHeaders.push(header);
    }
  });

  console.log('\n📊 Resumo:');
  console.log(`✅ Headers encontrados: ${foundHeaders}/${securityHeaders.length}`);

  if (missingHeaders.length > 0) {
    console.log(`❌ Headers ausentes: ${missingHeaders.join(', ')}`);
  } else {
    console.log('🎉 Todos os headers de segurança estão presentes!');
  }

  // Verificar se X-Powered-By foi removido
  if (res.headers['x-powered-by']) {
    console.log(`⚠️  X-Powered-By ainda presente: ${res.headers['x-powered-by']}`);
  } else {
    console.log('✅ X-Powered-By removido com sucesso');
  }

  console.log('\n🔍 Headers Completos:');
  Object.keys(res.headers).forEach((key) => {
    console.log(`${key}: ${res.headers[key]}`);
  });
});

req.on('error', (e) => {
  console.error(`❌ Erro ao conectar: ${e.message}`);
  console.log('\n💡 Certifique-se de que o servidor está rodando em localhost:3000');
});

req.end();
