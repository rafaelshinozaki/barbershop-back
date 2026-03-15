const fetch = require('node-fetch');

async function testPaymentsEndpoint() {
  try {
    console.log('=== TESTING PAYMENTS ENDPOINT ===');

    // Primeiro, fazer login para obter o token
    console.log('1. Making login request...');
    const loginResponse = await fetch('http://localhost:3020/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'rafaelsinosak@gmail.com',
        password: 'password123', // Ajuste a senha conforme necessário
      }),
    });

    const loginData = await loginResponse.json();
    console.log('Login response:', loginData);

    if (!loginResponse.ok) {
      console.error('Login failed');
      return;
    }

    // Extrair cookies da resposta
    const cookies = loginResponse.headers.get('set-cookie');
    console.log('Cookies received:', cookies);

    // Testar o endpoint de pagamentos
    console.log('\n2. Testing payments endpoint...');
    const paymentsResponse = await fetch('http://localhost:3020/payments', {
      method: 'GET',
      headers: {
        Cookie: cookies,
      },
    });

    const paymentsData = await paymentsResponse.json();
    console.log('Payments response status:', paymentsResponse.status);
    console.log('Payments response:', paymentsData);

    // Testar o endpoint de teste
    console.log('\n3. Testing test endpoint for user 24...');
    const testResponse = await fetch('http://localhost:3020/payments/test-invoices/24', {
      method: 'GET',
      headers: {
        Cookie: cookies,
      },
    });

    const testData = await testResponse.json();
    console.log('Test response status:', testResponse.status);
    console.log('Test response:', testData);
  } catch (error) {
    console.error('Error testing endpoint:', error);
  }
}

testPaymentsEndpoint();
