const axios = require('axios');

async function testAnalysisEndpoint() {
  try {
    console.log('Testando endpoint de análise...');

    // Primeiro, fazer login para obter o token
    const loginResponse = await axios.post('http://localhost:3000/auth/login', {
      email: 'test@example.com', // Substitua por um email válido
      password: 'password123', // Substitua por uma senha válida
    });

    const token = loginResponse.data.access_token;
    console.log('Token obtido:', token ? 'Sim' : 'Não');

    // Testar endpoint de teste
    const testResponse = await axios.get('http://localhost:3000/analysis/test', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    console.log('Endpoint de teste funcionando:', testResponse.data);

    // Testar criação de análise
    const createResponse = await axios.post(
      'http://localhost:3000/analysis',
      {
        name: 'Teste LDA',
        description: 'Análise de teste',
        type: 'LDA',
        inputData: {
          failureData: [100, 200, 300, 400],
          censoredData: [500, 600],
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    console.log('Análise criada com sucesso:', createResponse.data);
  } catch (error) {
    console.error('Erro no teste:', error.response?.data || error.message);
  }
}

testAnalysisEndpoint();
