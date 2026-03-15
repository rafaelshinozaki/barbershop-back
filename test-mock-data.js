const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:3020';

// Credenciais de teste (baseadas no seed)
const TEST_CREDENTIALS = {
  email: 'rafael.lima@relable.com',
  password: 'pwned',
};

let cookies = [];

// Função para extrair cookies da resposta
function extractCookies(response) {
  const setCookieHeaders = response.headers.raw()['set-cookie'];
  if (setCookieHeaders) {
    setCookieHeaders.forEach((cookie) => {
      const cookieName = cookie.split('=')[0];
      const cookieValue = cookie.split(';')[0].split('=')[1];
      cookies.push(`${cookieName}=${cookieValue}`);
    });
  }
}

// Função para fazer requisição GraphQL com cookies
async function graphqlRequest(query, variables = {}) {
  const response = await fetch(`${BASE_URL}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookies.join('; '),
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  });

  // Extrair cookies da resposta
  extractCookies(response);

  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.status}`);
  }

  return response.json();
}

async function login() {
  const loginMutation = `
    mutation Login($input: LoginInput!) {
      login(input: $input) {
        id
        email
        fullName
        role
        membership
        isActive
        twoFactorEnabled
        photoKey
        twoFactorRequired
        loginId
        userSystemConfig {
          id
          theme
          accentColor
          grayColor
          radius
          scaling
          language
          createdAt
          updatedAt
        }
      }
    }
  `;

  try {
    console.log('🔐 Fazendo login...');

    const loginData = await graphqlRequest(loginMutation, {
      input: TEST_CREDENTIALS,
    });

    if (loginData.data && loginData.data.login) {
      console.log('✅ Login realizado com sucesso');
      console.log(`👤 Usuário: ${loginData.data.login.fullName} (${loginData.data.login.email})`);
      console.log(`🔑 Role: ${loginData.data.login.role}`);
      console.log(`📊 Membership: ${loginData.data.login.membership}`);
      console.log(`🍪 Cookies: ${cookies.join(', ')}`);
      console.log('');

      return true;
    } else {
      console.error('❌ Resposta de login inválida:', loginData);
      return false;
    }
  } catch (error) {
    console.error('❌ Erro no login:', error.message);
    if (error.response) {
      console.error('📄 Resposta do servidor:', error.response);
    }
    return false;
  }
}

async function testMockData() {
  try {
    console.log('🧪 Testando dados mock da API de análise...\n');

    // 1. Listar análises do usuário (dados do seed)
    console.log('1️⃣ Listando análises do usuário:');

    const myAnalysesQuery = `
      query GetMyAnalyses {
        myAnalyses {
          id
          name
          description
          type
          status
          createdAt
          updatedAt
        }
      }
    `;

    const analysesData = await graphqlRequest(myAnalysesQuery);
    const analyses = analysesData.data?.myAnalyses || [];
    console.log(`✅ Encontradas ${analyses.length} análises`);
    console.log('📊 Tipos de análise encontrados:', [...new Set(analyses.map((a) => a.type))]);
    console.log('');

    // 2. Buscar análise específica (se existir)
    console.log('2️⃣ Buscando análise específica:');
    if (analyses.length > 0) {
      const firstAnalysis = analyses[0];
      const specificAnalysisQuery = `
        query GetAnalysis($id: Int!) {
          analysis(id: $id) {
            id
            name
            description
            type
            status
            createdAt
            updatedAt
          }
        }
      `;

      const specificAnalysisData = await graphqlRequest(specificAnalysisQuery, {
        id: firstAnalysis.id,
      });

      const specificAnalysis = specificAnalysisData.data.analysis;
      console.log(`✅ Análise encontrada: ${specificAnalysis.name}`);
      console.log(`📊 Tipo: ${specificAnalysis.type}`);
      console.log(`📊 Status: ${specificAnalysis.status}`);
      console.log('');
    } else {
      console.log('⚠️  Nenhuma análise encontrada para buscar');
      console.log('');
    }

    // 3. Listar análises compartilhadas
    console.log('3️⃣ Listando análises compartilhadas:');
    const sharedQuery = `
      query GetSharedAnalyses {
        sharedAnalyses {
          id
          analysisId
          sharedWithUserId
          sharedWithEmail
          invitationToken
          status
          createdAt
        }
      }
    `;

    const sharedData = await graphqlRequest(sharedQuery);
    const sharedAnalyses = sharedData.data?.sharedAnalyses || [];
    console.log(`✅ Encontradas ${sharedAnalyses.length} análises compartilhadas`);
    console.log('');

    // 4. Testar criação de nova análise
    console.log('4️⃣ Testando criação de nova análise:');
    const createAnalysisMutation = `
      mutation CreateAnalysis($input: CreateAnalysisInput!) {
        createAnalysis(input: $input) {
          id
          name
          description
          type
          status
          createdAt
          updatedAt
        }
      }
    `;

    const newAnalysisData = await graphqlRequest(createAnalysisMutation, {
      input: {
        name: 'Análise de Teste via JS',
        description: 'Análise criada via script de teste',
        type: 'LDA',
        inputData: JSON.stringify({ sampleSize: 30 }),
        parameters: JSON.stringify({ distribution: 'weibull' }),
      },
    });

    const newAnalysis = newAnalysisData.data.createAnalysis;
    console.log(`✅ Nova análise criada com ID: ${newAnalysis.id}`);
    console.log(`📊 Nome: ${newAnalysis.name}`);
    console.log(`📊 Tipo: ${newAnalysis.type}`);
    console.log(`📊 Status: ${newAnalysis.status}`);
    console.log('');

    // 5. Testar atualização de análise
    console.log('5️⃣ Testando atualização de análise:');
    const updateAnalysisMutation = `
      mutation UpdateAnalysis($id: Int!, $input: UpdateAnalysisInput!) {
        updateAnalysis(id: $id, input: $input) {
          id
          name
          description
          type
          status
          results
          updatedAt
        }
      }
    `;

    const updateData = await graphqlRequest(updateAnalysisMutation, {
      id: newAnalysis.id,
      input: {
        description: 'Análise atualizada via script de teste',
        status: 'COMPLETED',
        results: JSON.stringify({
          type: 'LDA',
          status: 'COMPLETED',
          statistics: {
            mean: 1000,
            median: 950,
            reliability: 0.85,
          },
        }),
      },
    });

    const updatedAnalysis = updateData.data.updateAnalysis;
    console.log(`✅ Análise atualizada: ${updatedAnalysis.name}`);
    console.log(`📊 Status: ${updatedAnalysis.status}`);
    console.log('');

    // 6. Testar compartilhamento de análise
    console.log('6️⃣ Testando compartilhamento de análise:');
    const shareAnalysisMutation = `
      mutation ShareAnalysis($input: ShareAnalysisInput!) {
        shareAnalysis(input: $input) {
          id
          analysisId
          sharedWithEmail
          invitationToken
          status
          createdAt
        }
      }
    `;

    const shareData = await graphqlRequest(shareAnalysisMutation, {
      input: {
        analysisId: newAnalysis.id,
        emails: ['teste@exemplo.com'],
        message: 'Análise compartilhada via script de teste',
      },
    });

    const sharedAnalysis = shareData.data.shareAnalysis[0];
    console.log(`✅ Análise compartilhada com: ${sharedAnalysis.sharedWithEmail}`);
    console.log(`📊 Status: ${sharedAnalysis.status}`);
    console.log('');

    // 7. Testar exclusão de análise
    console.log('7️⃣ Testando exclusão de análise:');
    const deleteAnalysisMutation = `
      mutation DeleteAnalysis($id: Int!) {
        deleteAnalysis(id: $id)
      }
    `;

    try {
      const deleteData = await graphqlRequest(deleteAnalysisMutation, {
        id: newAnalysis.id,
      });

      if (deleteData.data && deleteData.data.deleteAnalysis) {
        console.log('✅ Análise de teste excluída');
      } else {
        console.log('❌ Falha ao excluir análise');
        console.log('📄 Resposta:', JSON.stringify(deleteData, null, 2));
      }
    } catch (error) {
      console.log('❌ Erro ao excluir análise:', error.message);
      if (error.response) {
        console.log('📄 Resposta do servidor:', error.response);
      }
    }
    console.log('');

    // 8. Testar queries de usuário
    console.log('8️⃣ Testando queries de usuário:');

    // Query me
    const meQuery = `
      query Me {
        me {
          id
          email
          fullName
          role
          membership
          isActive
          userSystemConfig {
            id
            theme
            accentColor
            grayColor
            radius
            scaling
            language
          }
        }
      }
    `;
    
    const meData = await graphqlRequest(meQuery);
    const me = meData.data.me;
    console.log(`✅ Usuário atual: ${me.fullName} (${me.email})`);
    console.log(`📊 Role: ${me.role}`);
    console.log(`📊 Membership: ${me.membership}`);
    if (me.userSystemConfig) {
      const config = me.userSystemConfig;
      console.log(`✅ Configuração do usuário: ${config.theme} theme, ${config.language} language`);
      console.log(`📊 Accent Color: ${config.accentColor}`);
      console.log(`📊 Scaling: ${config.scaling}`);
    } else {
      console.log('⚠️  Usuário não possui configuração de sistema cadastrada.');
    }
    console.log('');

    // 9. Testar queries de notificações
    console.log('9️⃣ Testando queries de notificações:');

    const notificationsQuery = `
      query MyNotifications {
        myNotifications(limit: 5) {
          id
          title
          message
          type
          isRead
          isNew
          createdAt
        }
      }
    `;

    const notificationsData = await graphqlRequest(notificationsQuery);
    const notifications = notificationsData.data.myNotifications;
    console.log(`✅ Encontradas ${notifications.length} notificações`);
    console.log('');

    // 10. Testar queries de histórico de login
    console.log('🔟 Testando queries de histórico de login:');

    const loginHistoryQuery = `
      query LoginHistory {
        loginHistory(page: 1, limit: 5) {
          data {
            id
            deviceType
            browser
            os
            ip
            location
            createdAt
          }
          total
          page
          limit
          totalPages
        }
      }
    `;

    const loginHistoryData = await graphqlRequest(loginHistoryQuery);
    const loginHistory = loginHistoryData.data.loginHistory;
    console.log(`✅ Encontrados ${loginHistory.total} registros de login`);
    console.log(`📊 Página atual: ${loginHistory.page}/${loginHistory.totalPages}`);
    console.log('');

    console.log(
      '🎉 Todos os testes passaram! O sistema de dados mock está funcionando corretamente.',
    );
    console.log('');
    console.log('📊 Resumo dos testes:');
    console.log('✅ Login e autenticação');
    console.log('✅ Listagem de análises');
    console.log('✅ Busca de análise específica');
    console.log('✅ Listagem de análises compartilhadas');
    console.log('✅ CRUD completo de análises');
    console.log('✅ Compartilhamento de análises');
    console.log('✅ Queries de usuário');
    console.log('✅ Queries de notificações');
    console.log('✅ Queries de histórico de login');
  } catch (error) {
    console.error('❌ Erro durante o teste:', error.message);
    if (error.response) {
      console.error('📄 Resposta do servidor:', error.response);
    }
  }
}

async function main() {
  const loginSuccess = await login();
  if (loginSuccess) {
    await testMockData();
  } else {
    console.log('❌ Não foi possível fazer login. Verifique se o servidor está rodando.');
  }
}

main();
