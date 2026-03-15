const { PrismaClient } = require('@prisma/client');
const Stripe = require('stripe');

// Configuração do Prisma
const prisma = new PrismaClient();

// Configuração do Stripe
const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey) {
  console.error('❌ STRIPE_SECRET_KEY não configurada. Defina no .env');
  process.exit(1);
}
const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });

async function testConnections() {
  console.log('🔍 Testando conectividades...\n');

  // Teste 1: Conexão com banco de dados
  console.log('1️⃣ Testando conexão com banco de dados...');
  try {
    await prisma.$connect();
    console.log('   ✅ Conexão com banco de dados: OK');

    // Testar query simples
    const userCount = await prisma.user.count();
    console.log(`   📊 Total de usuários na base: ${userCount}`);

    const stripeUserCount = await prisma.user.count({
      where: {
        stripeCustomerId: {
          not: null,
        },
        stripeCustomerId: {
          not: '',
        },
      },
    });
    console.log(`   💳 Usuários com Stripe Customer ID: ${stripeUserCount}`);
  } catch (error) {
    console.error('   ❌ Erro na conexão com banco de dados:', error.message);
    return false;
  }

  // Teste 2: Conexão com Stripe
  console.log('\n2️⃣ Testando conexão com Stripe...');
  try {
    // Testar balance para verificar se a chave está válida
    const balance = await stripe.balance.retrieve();
    console.log('   ✅ Conexão com Stripe: OK');
    console.log(
      `   💰 Saldo disponível: ${balance.available[0]?.amount / 100} ${
        balance.available[0]?.currency
      }`,
    );

    // Testar se é chave de teste ou produção
    const isTestKey = stripeKey?.startsWith('sk_test_') ?? false;

    if (isTestKey) {
      console.log('   🧪 Usando chave de TESTE do Stripe');
    } else {
      console.log('   ⚠️  Usando chave de PRODUÇÃO do Stripe');
    }
  } catch (error) {
    console.error('   ❌ Erro na conexão com Stripe:', error.message);
    return false;
  }

  // Teste 3: Verificar estrutura da base
  console.log('\n3️⃣ Verificando estrutura da base de dados...');
  try {
    // Verificar se as tabelas existem
    const tables = await prisma.$queryRaw`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name IN ('User', 'Subscription', 'Payment', 'Plan')
    `;

    const requiredTables = ['User', 'Subscription', 'Payment', 'Plan'];
    const existingTables = tables.map((t) => t.name);

    console.log('   📋 Tabelas encontradas:', existingTables.join(', '));

    const missingTables = requiredTables.filter((table) => !existingTables.includes(table));
    if (missingTables.length > 0) {
      console.error(`   ❌ Tabelas faltando: ${missingTables.join(', ')}`);
      return false;
    } else {
      console.log('   ✅ Todas as tabelas necessárias existem');
    }
  } catch (error) {
    console.error('   ❌ Erro ao verificar estrutura:', error.message);
    return false;
  }

  // Teste 4: Verificar usuários com Stripe
  console.log('\n4️⃣ Verificando usuários com Stripe...');
  try {
    const stripeUsers = await prisma.user.findMany({
      where: {
        stripeCustomerId: {
          not: null,
        },
        stripeCustomerId: {
          not: '',
        },
      },
      select: {
        id: true,
        email: true,
        stripeCustomerId: true,
      },
      take: 5, // Limitar a 5 para não sobrecarregar
    });

    if (stripeUsers.length === 0) {
      console.log('   ⚠️  Nenhum usuário com Stripe Customer ID encontrado');
      console.log('   💡 Execute a sincronização apenas quando houver usuários com pagamentos');
    } else {
      console.log(`   👥 Encontrados ${stripeUsers.length} usuários com Stripe ID`);
      console.log('   📋 Exemplos:');
      stripeUsers.forEach((user, index) => {
        console.log(`      ${index + 1}. ${user.email} (ID: ${user.id})`);
      });
    }
  } catch (error) {
    console.error('   ❌ Erro ao buscar usuários:', error.message);
    return false;
  }

  // Teste 5: Verificar assinaturas
  console.log('\n5️⃣ Verificando assinaturas...');
  try {
    const subscriptions = await prisma.subscription.count({
      where: {
        stripeSubscriptionId: {
          not: null,
        },
      },
    });

    console.log(`   📋 Total de assinaturas com Stripe ID: ${subscriptions}`);

    if (subscriptions === 0) {
      console.log('   ⚠️  Nenhuma assinatura com Stripe ID encontrada');
    }
  } catch (error) {
    console.error('   ❌ Erro ao verificar assinaturas:', error.message);
    return false;
  }

  console.log('\n' + '='.repeat(50));
  console.log('✅ TODOS OS TESTES PASSARAM!');
  console.log('🚀 Você pode executar a sincronização com segurança');
  console.log('='.repeat(50));

  return true;
}

// Executar o script
if (require.main === module) {
  testConnections()
    .then((success) => {
      if (success) {
        console.log('\n💡 Próximos passos:');
        console.log('   1. Execute: node scripts/stripe/sync-stripe-payments.js');
        console.log(
          '   2. Ou teste um usuário específico: node scripts/stripe/sync-single-user-payments.js <email>',
        );
      } else {
        console.log('\n❌ Corrija os problemas acima antes de executar a sincronização');
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error('\n💥 Erro fatal:', error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
      console.log('\n🔌 Conexão com banco de dados fechada');
    });
}

module.exports = { testConnections };
