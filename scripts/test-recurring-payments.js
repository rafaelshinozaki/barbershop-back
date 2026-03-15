const { PrismaClient } = require('@prisma/client');
const { addDays, addYears } = require('date-fns');

const prisma = new PrismaClient();

async function testRecurringPayments() {
  console.log('🧪 Iniciando teste do sistema de cobrança recorrente...\n');

  try {
    // 1. Verificar pagamentos vencidos
    console.log('1️⃣ Verificando pagamentos vencidos...');
    const overduePayments = await prisma.payment.findMany({
      where: {
        nextPaymentDate: {
          lte: new Date(),
        },
        status: 'COMPLETED',
      },
      include: {
        subscription: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                fullName: true,
                membership: true,
                stripeCustomerId: true,
              },
            },
            plan: {
              select: {
                id: true,
                name: true,
                price: true,
                billingCycle: true,
              },
            },
          },
        },
      },
      orderBy: {
        nextPaymentDate: 'asc',
      },
    });

    console.log(`   📊 Encontrados ${overduePayments.length} pagamentos vencidos\n`);

    if (overduePayments.length > 0) {
      console.log('   📋 Detalhes dos pagamentos vencidos:');
      overduePayments.forEach((payment, index) => {
        const daysOverdue = Math.floor(
          (new Date().getTime() - new Date(payment.nextPaymentDate).getTime()) /
            (1000 * 60 * 60 * 24),
        );
        console.log(
          `   ${index + 1}. Usuário: ${payment.subscription.user.fullName} (${
            payment.subscription.user.email
          })`,
        );
        console.log(
          `      Plano: ${payment.subscription.plan.name} - R$ ${payment.subscription.plan.price}`,
        );
        console.log(`      Vencido há: ${daysOverdue} dias`);
        console.log(
          `      Stripe Customer ID: ${
            payment.subscription.user.stripeCustomerId || 'NÃO CONFIGURADO'
          }`,
        );
        console.log('');
      });
    }

    // 2. Verificar assinaturas ativas
    console.log('2️⃣ Verificando assinaturas ativas...');
    const activeSubscriptions = await prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            membership: true,
          },
        },
        plan: {
          select: {
            id: true,
            name: true,
            price: true,
            billingCycle: true,
          },
        },
        payments: {
          orderBy: {
            paymentDate: 'desc',
          },
          take: 1,
        },
      },
    });

    console.log(`   📊 Encontradas ${activeSubscriptions.length} assinaturas ativas\n`);

    // 3. Verificar próximos pagamentos
    console.log('3️⃣ Verificando próximos pagamentos...');
    const upcomingPayments = await prisma.payment.findMany({
      where: {
        nextPaymentDate: {
          gte: new Date(),
          lte: addDays(new Date(), 7), // Próximos 7 dias
        },
        status: 'COMPLETED',
      },
      include: {
        subscription: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                fullName: true,
              },
            },
            plan: {
              select: {
                id: true,
                name: true,
                price: true,
                billingCycle: true,
              },
            },
          },
        },
      },
      orderBy: {
        nextPaymentDate: 'asc',
      },
    });

    console.log(`   📊 Encontrados ${upcomingPayments.length} pagamentos nos próximos 7 dias\n`);

    if (upcomingPayments.length > 0) {
      console.log('   📋 Próximos pagamentos:');
      upcomingPayments.forEach((payment, index) => {
        const daysUntilPayment = Math.floor(
          (new Date(payment.nextPaymentDate).getTime() - new Date().getTime()) /
            (1000 * 60 * 60 * 24),
        );
        console.log(
          `   ${index + 1}. Usuário: ${payment.subscription.user.fullName} (${
            payment.subscription.user.email
          })`,
        );
        console.log(
          `      Plano: ${payment.subscription.plan.name} - R$ ${payment.subscription.plan.price}`,
        );
        console.log(
          `      Próximo pagamento: ${payment.nextPaymentDate.toLocaleDateString(
            'pt-BR',
          )} (em ${daysUntilPayment} dias)`,
        );
        console.log(`      Ciclo: ${payment.subscription.plan.billingCycle}`);
        console.log('');
      });
    }

    // 4. Estatísticas gerais
    console.log('4️⃣ Estatísticas gerais...');
    const totalPayments = await prisma.payment.count();
    const completedPayments = await prisma.payment.count({
      where: { status: 'COMPLETED' },
    });
    const failedPayments = await prisma.payment.count({
      where: { status: 'FAILED' },
    });

    console.log(`   📊 Total de pagamentos: ${totalPayments}`);
    console.log(`   ✅ Pagamentos completados: ${completedPayments}`);
    console.log(`   ❌ Pagamentos falhados: ${failedPayments}`);
    console.log(
      `   📈 Taxa de sucesso: ${((completedPayments / totalPayments) * 100).toFixed(2)}%\n`,
    );

    // 5. Verificar configuração do Stripe
    console.log('5️⃣ Verificando configuração do Stripe...');
    const usersWithStripe = await prisma.user.count({
      where: {
        stripeCustomerId: {
          not: null,
        },
      },
    });
    const usersWithoutStripe = await prisma.user.count({
      where: {
        stripeCustomerId: null,
      },
    });

    console.log(`   💳 Usuários com Stripe configurado: ${usersWithStripe}`);
    console.log(`   ⚠️ Usuários sem Stripe configurado: ${usersWithoutStripe}`);
    console.log(
      `   📊 Taxa de configuração: ${(
        (usersWithStripe / (usersWithStripe + usersWithoutStripe)) *
        100
      ).toFixed(2)}%\n`,
    );

    // 6. Recomendações
    console.log('6️⃣ Recomendações:');
    if (overduePayments.length > 0) {
      console.log('   ⚠️ Existem pagamentos vencidos que precisam ser processados');
      console.log('   💡 Execute o cron job de cobrança recorrente');
    } else {
      console.log('   ✅ Nenhum pagamento vencido encontrado');
    }

    if (usersWithoutStripe > 0) {
      console.log('   ⚠️ Existem usuários sem método de pagamento configurado');
      console.log('   💡 Considere enviar lembretes para configurar pagamento');
    }

    if (upcomingPayments.length > 0) {
      console.log('   📅 Existem pagamentos programados para os próximos dias');
      console.log('   💡 O sistema está funcionando corretamente');
    }

    console.log('\n✅ Teste concluído com sucesso!');
  } catch (error) {
    console.error('❌ Erro durante o teste:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Executar o teste
testRecurringPayments();
