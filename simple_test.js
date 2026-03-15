const http = require('http');

function makeRequest(path, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3020,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const jsonBody = JSON.parse(body);
          resolve({ status: res.statusCode, data: jsonBody, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data: body, headers: res.headers });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function test() {
  try {
    console.log('Testing backend...');

    // Teste simples de health check
    const healthResponse = await makeRequest('/health');
    console.log('Health check:', healthResponse);

    // Teste de login
    const loginResponse = await makeRequest('/auth/login', 'POST', {
      email: 'rafaelsinosak@gmail.com',
      password: 'password123',
    });
    console.log('Login response:', loginResponse);
  } catch (error) {
    console.error('Error:', error);
  }
}

test();
