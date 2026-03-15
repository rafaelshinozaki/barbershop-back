const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkUserSubscription(userId) {
  try {
    console.log(`\n🔍 Verificando usuário ${userId}...\n`);

    // Buscar usuário
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: true,
        subscriptions: {
          include: {
            plan: true,
            payments: true,
          },
          orderBy: {
            startSubDate: 'desc',
          },
        },
      },
    });

    if (!user) {
      console.log(`❌ Usuário ${userId} não encontrado`);
      return;
    }

    console.log('👤 DADOS DO USUÁRIO:');
    console.log(`   ID: ${user.id}`);
    console.log(`   Nome: ${user.fullName}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Membership: ${user.membership}`);
    console.log(`   Stripe Customer ID: ${user.stripeCustomerId || 'N/A'}`);
    console.log(`   Is Active: ${user.isActive}`);
    console.log(`   Role: ${user.role?.name || 'N/A'}`);

    console.log('\n📋 SUBSCRIPTIONS:');
    if (user.subscriptions.length === 0) {
      console.log('   ❌ Nenhuma subscription encontrada no banco de dados!');
    } else {
      user.subscriptions.forEach((sub, index) => {
        console.log(`\n   [${index + 1}] Subscription ID: ${sub.id}`);
        console.log(`       Plano: ${sub.plan.name}`);
        console.log(`       Status: ${sub.status}`);
        console.log(`       Data Início: ${sub.startSubDate}`);
        console.log(`       Data Cancelamento: ${sub.cancelationDate || 'N/A'}`);
        console.log(`       Stripe Subscription ID: ${sub.stripeSubscriptionId || 'N/A'}`);
        console.log(`       Pagamentos: ${sub.payments.length}`);
      });
    }

    // Verificar subscription ativa
    const activeSubscription = user.subscriptions.find((sub) => sub.status === 'ACTIVE');

    console.log('\n✅ SUBSCRIPTION ATIVA:');
    if (activeSubscription) {
      console.log(`   Plano: ${activeSubscription.plan.name}`);
      console.log(`   Status: ${activeSubscription.status}`);
      console.log(`   Stripe ID: ${activeSubscription.stripeSubscriptionId || 'N/A'}`);
    } else {
      console.log('   ❌ Nenhuma subscription ATIVA encontrada!');
    }

    // Análise do problema
    console.log('\n🔧 DIAGNÓSTICO:');

    if (user.membership === 'FREE' && activeSubscription) {
      console.log('   ⚠️  PROBLEMA: Usuário tem membership FREE mas subscription ATIVA!');
      console.log('   💡 Solução: O webhook do Stripe precisa atualizar o membership para PAID');
    }

    if (user.membership === 'PAID' && !activeSubscription) {
      console.log('   ⚠️  PROBLEMA: Usuário tem membership PAID mas nenhuma subscription ATIVA!');
      console.log('   💡 Solução: Verificar no Stripe se há uma subscription ativa');
    }

    if (user.membership === 'FREE' && user.subscriptions.length === 0) {
      console.log('   ⚠️  PROBLEMA: Usuário não tem subscriptions no banco de dados!');
      console.log('   💡 Solução: Criar subscription no banco ou verificar no Stripe');
    }

    if (activeSubscription) {
      console.log('\n   ✅ O campo `plan` no GraphQL deve retornar:', activeSubscription.plan.name);
      console.log(
        '   ✅ O campo `subscriptionStatus` no GraphQL deve retornar:',
        activeSubscription.status,
      );
    } else {
      console.log('\n   ⚠️  O campo `plan` no GraphQL vai retornar: FREE (padrão)');
      console.log(
        '   ⚠️  O campo `subscriptionStatus` no GraphQL vai retornar:',
        user.membership || 'FREE',
      );
    }
  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Verificar se foi passado um userId como argumento
const userId = process.argv[2];

if (!userId) {
  console.log('❌ Por favor, forneça um ID de usuário como argumento');
  console.log('   Exemplo: node check-user-subscription.js 1');
  process.exit(1);
}

checkUserSubscription(parseInt(userId));
