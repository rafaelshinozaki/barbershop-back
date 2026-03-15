const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkStripeData() {
  try {
    console.log('=== VERIFICANDO DADOS DO STRIPE ===\n');

    // Verificar usuários com stripeCustomerId
    const usersWithStripe = await prisma.user.findMany({
      where: {
        stripeCustomerId: {
          not: null,
        },
      },
      select: {
        id: true,
        email: true,
        stripeCustomerId: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    console.log(`=== USUÁRIOS COM STRIPE CUSTOMER ID (${usersWithStripe.length}) ===`);
    if (usersWithStripe.length === 0) {
      console.log('❌ NENHUM usuário encontrado com stripeCustomerId');
    } else {
      usersWithStripe.forEach((user) => {
        console.log(
          `✅ User ID: ${user.id}, Email: ${user.email}, Stripe ID: ${user.stripeCustomerId}`,
        );
      });
    }

    // Verificar assinaturas com stripeCustomerId
    const subscriptionsWithStripe = await prisma.subscription.findMany({
      where: {
        stripeCustomerId: {
          not: null,
        },
      },
      select: {
        id: true,
        userId: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        status: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    console.log(`\n=== ASSINATURAS COM STRIPE CUSTOMER ID (${subscriptionsWithStripe.length}) ===`);
    if (subscriptionsWithStripe.length === 0) {
      console.log('❌ NENHUMA assinatura encontrada com stripeCustomerId');
    } else {
      subscriptionsWithStripe.forEach((sub) => {
        console.log(
          `✅ Subscription ID: ${sub.id}, User ID: ${sub.userId}, Stripe Customer ID: ${sub.stripeCustomerId}, Status: ${sub.status}`,
        );
      });
    }

    // Verificar total de usuários
    const totalUsers = await prisma.user.count();
    console.log(`\n=== TOTAL DE USUÁRIOS NO BANCO: ${totalUsers} ===`);

    // Verificar total de assinaturas
    const totalSubscriptions = await prisma.subscription.count();
    console.log(`=== TOTAL DE ASSINATURAS NO BANCO: ${totalSubscriptions} ===`);

    // Verificar total de pagamentos
    const totalPayments = await prisma.payment.count();
    console.log(`=== TOTAL DE PAGAMENTOS NO BANCO: ${totalPayments} ===`);

    // Verificar quando foi a última atualização
    const lastUpdatedUser = await prisma.user.findFirst({
      orderBy: {
        updatedAt: 'desc',
      },
      select: {
        id: true,
        email: true,
        updatedAt: true,
        stripeCustomerId: true,
      },
    });

    console.log(`\n=== ÚLTIMA ATUALIZAÇÃO ===`);
    if (lastUpdatedUser) {
      console.log(
        `Último usuário atualizado: ${lastUpdatedUser.email} (ID: ${lastUpdatedUser.id})`,
      );
      console.log(`Data: ${lastUpdatedUser.updatedAt}`);
      console.log(`Stripe Customer ID: ${lastUpdatedUser.stripeCustomerId || 'NULL'}`);
    }

    // Verificar se há usuários sem stripeCustomerId mas com assinaturas
    const usersWithoutStripeButWithSubs = await prisma.user.findMany({
      where: {
        stripeCustomerId: null,
        subscriptions: {
          some: {},
        },
      },
      select: {
        id: true,
        email: true,
        subscriptions: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    console.log(
      `\n=== USUÁRIOS SEM STRIPE MAS COM ASSINATURAS (${usersWithoutStripeButWithSubs.length}) ===`,
    );
    if (usersWithoutStripeButWithSubs.length > 0) {
      usersWithoutStripeButWithSubs.forEach((user) => {
        console.log(
          `⚠️  User ID: ${user.id}, Email: ${user.email}, Assinaturas: ${user.subscriptions.length}`,
        );
      });
    }
  } catch (error) {
    console.error('Erro ao verificar dados do Stripe:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkStripeData();
