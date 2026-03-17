const fetch = require('node-fetch');

const GRAPHQL_URL = 'http://localhost:5555/graphql';

// Query para buscar todos os usuários (requer autenticação de Admin)
const GET_ALL_USERS_QUERY = `
  query GetAllUsers {
    getAllUsers {
      id
      fullName
      email
      membership
      isActive
      role
      plan
      subscriptionStatus
    }
  }
`;

// Query para fazer login
const LOGIN_MUTATION = `
  mutation Login($email: String!, $password: String!) {
    login(loginInput: { email: $email, password: $password }) {
      access_token
      user {
        id
        fullName
        email
        role
      }
    }
  }
`;

async function testGraphQL() {
  try {
    console.log('\n🔍 Testando queries GraphQL...\n');

    // 1. Fazer login como admin
    console.log('1️⃣ Fazendo login como admin...');
    const loginResponse = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: LOGIN_MUTATION,
        variables: {
          email: 'rafaelsinosak@barbershop.com',
          password: 'pwned',
        },
      }),
    });

    const loginData = await loginResponse.json();

    if (loginData.errors) {
      console.error('❌ Erro no login:', loginData.errors);
      return;
    }

    const token = loginData.data.login.access_token;
    console.log('✅ Login realizado com sucesso!');
    console.log(`   Token: ${token.substring(0, 50)}...`);
    console.log(
      `   User: ${loginData.data.login.user.fullName} (${loginData.data.login.user.role})`,
    );

    // 2. Buscar todos os usuários
    console.log('\n2️⃣ Buscando todos os usuários...');
    const usersResponse = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: GET_ALL_USERS_QUERY,
      }),
    });

    const usersData = await usersResponse.json();

    if (usersData.errors) {
      console.error('❌ Erro ao buscar usuários:', usersData.errors);
      return;
    }

    const users = usersData.data.getAllUsers;
    console.log(`✅ ${users.length} usuários encontrados!\n`);

    // Mostrar os primeiros 5 usuários
    console.log('📋 Primeiros 5 usuários:');
    users.slice(0, 5).forEach((user, index) => {
      console.log(`\n${index + 1}. ${user.fullName}`);
      console.log(`   Email: ${user.email}`);
      console.log(`   Role: ${user.role}`);
      console.log(`   Membership (DB): ${user.membership}`);
      console.log(`   Plan (GraphQL computed): ${user.plan || 'N/A'}`);
      console.log(`   Subscription Status: ${user.subscriptionStatus || 'N/A'}`);
      console.log(`   Active: ${user.isActive}`);
    });

    // Verificar se os campos computados estão funcionando
    console.log('\n\n📊 Análise dos campos computados:');
    const usersWithPlan = users.filter((u) => u.plan && u.plan !== 'FREE');
    const usersWithPaidMembership = users.filter((u) => u.membership === 'PAID');

    console.log(`   Usuários com plan (computed): ${usersWithPlan.length}`);
    console.log(`   Usuários com membership PAID: ${usersWithPaidMembership.length}`);

    if (usersWithPlan.length > 0) {
      console.log('\n   ✅ Os campos computados `plan` e `subscriptionStatus` estão funcionando!');
    } else {
      console.log('\n   ⚠️  Os campos computados não estão retornando valores');
    }
  } catch (error) {
    console.error('❌ Erro:', error.message);
  }
}

testGraphQL();
