const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function debugPayments() {
  try {
    console.log('=== DEBUG PAYMENTS ===');

    // Verificar todos os usuários
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        stripeCustomerId: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 10,
    });

    console.log('\n=== USERS ===');
    users.forEach((user) => {
      console.log(
        `User ID: ${user.id}, Email: ${user.email}, Stripe Customer ID: ${
          user.stripeCustomerId || 'NULL'
        }`,
      );
    });

    // Verificar todas as assinaturas
    const subscriptions = await prisma.subscription.findMany({
      select: {
        id: true,
        userId: true,
        planId: true,
        status: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    console.log('\n=== SUBSCRIPTIONS ===');
    subscriptions.forEach((sub) => {
      console.log(
        `Subscription ID: ${sub.id}, User ID: ${sub.userId}, Status: ${
          sub.status
        }, Stripe Customer ID: ${sub.stripeCustomerId || 'NULL'}`,
      );
    });

    // Verificar todos os pagamentos
    const payments = await prisma.payment.findMany({
      select: {
        id: true,
        subscriptionId: true,
        amount: true,
        status: true,
        paymentDate: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    console.log('\n=== PAYMENTS ===');
    payments.forEach((payment) => {
      console.log(
        `Payment ID: ${payment.id}, Subscription ID: ${payment.subscriptionId}, Amount: ${payment.amount}, Status: ${payment.status}`,
      );
    });

    // Verificar se há usuários com stripeCustomerId mas sem assinaturas
    const usersWithStripeButNoSubs = await prisma.user.findMany({
      where: {
        stripeCustomerId: {
          not: null,
        },
        subscriptions: {
          none: {},
        },
      },
      select: {
        id: true,
        email: true,
        stripeCustomerId: true,
      },
    });

    console.log('\n=== USERS WITH STRIPE BUT NO SUBSCRIPTIONS ===');
    usersWithStripeButNoSubs.forEach((user) => {
      console.log(
        `User ID: ${user.id}, Email: ${user.email}, Stripe Customer ID: ${user.stripeCustomerId}`,
      );
    });

    // Verificar qual usuário tem o stripeCustomerId cus_Sahn64DMrKaTo3
    const userWithStripe = await prisma.user.findFirst({
      where: {
        stripeCustomerId: 'cus_Sahn64DMrKaTo3',
      },
      select: {
        id: true,
        email: true,
        stripeCustomerId: true,
      },
    });

    console.log('\n=== USER WITH STRIPE CUSTOMER ID ===');
    if (userWithStripe) {
      console.log(
        `User ID: ${userWithStripe.id}, Email: ${userWithStripe.email}, Stripe Customer ID: ${userWithStripe.stripeCustomerId}`,
      );
    } else {
      console.log('No user found with this Stripe Customer ID');
    }

    // Verificar se há assinaturas sem usuário correspondente
    const orphanedSubscriptions = await prisma.subscription.findMany({
      where: {
        user: null,
      },
      select: {
        id: true,
        userId: true,
        status: true,
      },
    });

    console.log('\n=== ORPHANED SUBSCRIPTIONS ===');
    orphanedSubscriptions.forEach((sub) => {
      console.log(`Subscription ID: ${sub.id}, User ID: ${sub.userId}, Status: ${sub.status}`);
    });
  } catch (error) {
    console.error('Error debugging payments:', error);
  } finally {
    await prisma.$disconnect();
  }
}

debugPayments();
