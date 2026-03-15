/**
 * Módulo de Autenticação para Testes Locais
 * Configurado para ambiente de desenvolvimento local
 */

const axios = require('axios');

const CONFIG = {
  API_URL: process.env.API_URL || 'http://localhost:3020',
  EMAIL: 'rafael.lima@relable.com',
  PASSWORD: 'pwned'
};

class AuthModule {
  constructor() {
    this.token = null;
    this.userId = null;
    this.client = axios.create({
      baseURL: CONFIG.API_URL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      },
      withCredentials: true // Importante para cookies
    });

    // Interceptor para incluir token automaticamente
    this.client.interceptors.request.use((config) => {
      if (this.token && this.token !== 'mock_token') {
        config.headers.Authorization = `Bearer ${this.token}`;
      }
      return config;
    });
  }

  async authenticate() {
    console.log('🔐 Autenticando usuário local...');

    try {
      const response = await this.client.post('/auth/login', {
        email: CONFIG.EMAIL,
        password: CONFIG.PASSWORD
      });

      console.log('📋 Status da resposta:', response.status);
      console.log('📋 Dados da resposta:', JSON.stringify(response.data, null, 2));
      console.log('📋 Headers da resposta:', JSON.stringify(response.headers, null, 2));

      // Verificar diferentes formatos de resposta de login
      if (response.data) {
        // Extrair token de diferentes possíveis locais
        this.token = response.data.token ||
                    response.data.accessToken ||
                    response.data.access_token;

        // Tentar extrair token do cookie Set-Cookie header
        if (!this.token && response.headers['set-cookie']) {
          const setCookieHeader = response.headers['set-cookie'];
          console.log('📋 Set-Cookie headers:', setCookieHeader);

          for (const cookie of setCookieHeader) {
            const match = cookie.match(/Authentication=([^;]+)/);
            if (match) {
              this.token = match[1];
              console.log('📋 Token extraído do cookie Authentication');
              break;
            }
          }
        }

        // Extrair userId de diferentes possíveis locais
        this.userId = response.data.data?.id ||
                     response.data.user?.id ||
                     response.data.userId ||
                     response.data.id ||
                     1;

        console.log(`✅ Autenticação bem-sucedida`);
        console.log(`   - Token: ${this.token ? 'Configurado' : 'Não encontrado'}`);
        console.log(`   - User ID: ${this.userId}`);
        console.log(`   - Email: ${CONFIG.EMAIL}`);

        return true;
      }

      throw new Error('Resposta de login inválida');

    } catch (error) {
      console.error('❌ Erro na autenticação:', error.response?.data || error.message);
      return false;
    }
  }

  getClient() {
    if (!this.token) {
      throw new Error('Usuário não autenticado. Execute authenticate() primeiro.');
    }
    return this.client;
  }

  getUserId() {
    return this.userId;
  }

  getToken() {
    return this.token;
  }

  isAuthenticated() {
    return !!this.token;
  }
}

module.exports = { AuthModule, CONFIG };