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

// Função para converter data do Stripe para Date
function stripeDateToDate(stripeDate) {
  return new Date(stripeDate * 1000);
}

// Função para converter centavos para reais
function centsToReais(cents) {
  return cents / 100;
}

// Função para sincronizar pagamentos de um usuário específico
async function syncSingleUserPayments(userIdentifier) {
  console.log('🔍 Buscando usuário...');

  let user;

  // Tentar buscar por email primeiro
  if (userIdentifier.includes('@')) {
    user = await prisma.user.findFirst({
      where: {
        email: userIdentifier,
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
        fullName: true,
        stripeCustomerId: true,
      },
    });
  } else {
    // Tentar buscar por ID
    user = await prisma.user.findFirst({
      where: {
        id: parseInt(userIdentifier),
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
        fullName: true,
        stripeCustomerId: true,
      },
    });
  }

  if (!user) {
    console.error('❌ Usuário não encontrado ou não possui Stripe Customer ID');
    console.log('💡 Certifique-se de que:');
    console.log('   - O email/ID está correto');
    console.log('   - O usuário possui um stripeCustomerId válido');
    return;
  }

  console.log(`\n✅ Usuário encontrado: ${user.email} (ID: ${user.id})`);
  console.log(`   Stripe Customer ID: ${user.stripeCustomerId}`);

  try {
    // Buscar todas as assinaturas do usuário
    const subscriptions = await prisma.subscription.findMany({
      where: {
        userId: user.id,
        stripeSubscriptionId: {
          not: null,
        },
      },
      include: {
        plan: true,
        payments: true,
      },
    });

    console.log(`\n📋 Encontradas ${subscriptions.length} assinaturas com Stripe ID`);

    if (subscriptions.length === 0) {
      console.log('⚠️  Nenhuma assinatura com Stripe ID encontrada');
      return;
    }

    // Listar assinaturas
    subscriptions.forEach((sub, index) => {
      console.log(`   ${index + 1}. Plano: ${sub.plan.name} - Status: ${sub.status}`);
      console.log(`      Stripe Subscription ID: ${sub.stripeSubscriptionId}`);
      console.log(`      Pagamentos existentes: ${sub.payments.length}`);
    });

    // Buscar invoices do Stripe
    console.log('\n💳 Buscando invoices no Stripe...');
    const invoices = await stripe.invoices.list({
      customer: user.stripeCustomerId,
      limit: 100,
    });

    console.log(`   Encontrados ${invoices.data.length} invoices no Stripe`);

    let totalProcessed = 0;
    let totalCreated = 0;
    let totalUpdated = 0;
    let totalErrors = 0;

    // Processar cada invoice
    for (const invoice of invoices.data) {
      try {
        // Pular invoices que não são de pagamento
        if (invoice.status !== 'paid' && invoice.status !== 'open') {
          continue;
        }

        // Buscar assinatura relacionada
        const subscription = subscriptions.find(
          (sub) => sub.stripeSubscriptionId === invoice.subscription,
        );

        if (!subscription) {
          console.log(`   ⚠️  Invoice ${invoice.id} não tem assinatura correspondente no banco`);
          continue;
        }

        // Verificar se o pagamento já existe
        const existingPayment = await prisma.payment.findFirst({
          where: {
            transactionId: invoice.payment_intent || invoice.id,
            subscriptionId: subscription.id,
          },
        });

        const paymentData = {
          subscriptionId: subscription.id,
          amount: centsToReais(invoice.amount_paid),
          paymentDate: stripeDateToDate(invoice.created),
          nextPaymentDate: invoice.next_payment_attempt
            ? stripeDateToDate(invoice.next_payment_attempt)
            : new Date(stripeDateToDate(invoice.created).getTime() + 30 * 24 * 60 * 60 * 1000),
          paymentMethod: 'stripe',
          transactionId: invoice.payment_intent || invoice.id,
          status: invoice.status === 'paid' ? 'COMPLETED' : 'PENDING',
        };

        if (existingPayment) {
          // Atualizar pagamento existente
          await prisma.payment.update({
            where: { id: existingPayment.id },
            data: paymentData,
          });
          totalUpdated++;
          console.log(`   ✅ Atualizado pagamento: ${invoice.id} (R$ ${paymentData.amount})`);
        } else {
          // Criar novo pagamento
          await prisma.payment.create({
            data: paymentData,
          });
          totalCreated++;
          console.log(`   ➕ Criado pagamento: ${invoice.id} (R$ ${paymentData.amount})`);
        }

        totalProcessed++;
      } catch (error) {
        console.error(`   ❌ Erro ao processar invoice ${invoice.id}:`, error.message);
        totalErrors++;
      }
    }

    // Relatório final
    console.log('\n' + '='.repeat(50));
    console.log('📊 RELATÓRIO DE SINCRONIZAÇÃO');
    console.log('='.repeat(50));
    console.log(`👤 Usuário: ${user.email}`);
    console.log(`💳 Pagamentos processados: ${totalProcessed}`);
    console.log(`➕ Pagamentos criados: ${totalCreated}`);
    console.log(`🔄 Pagamentos atualizados: ${totalUpdated}`);
    console.log(`❌ Erros: ${totalErrors}`);
    console.log('='.repeat(50));
  } catch (error) {
    console.error('💥 Erro durante a sincronização:', error);
  } finally {
    await prisma.$disconnect();
    console.log('\n🔌 Conexão com banco de dados fechada');
  }
}

// Executar o script
if (require.main === module) {
  const userIdentifier = process.argv[2];

  if (!userIdentifier) {
    console.error('❌ Uso: node sync-single-user-payments.js <email_ou_id>');
    console.log('💡 Exemplos:');
    console.log('   node sync-single-user-payments.js usuario@exemplo.com');
    console.log('   node sync-single-user-payments.js 123');
    process.exit(1);
  }

  syncSingleUserPayments(userIdentifier)
    .then(() => {
      console.log('\n✅ Sincronização concluída!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Erro fatal:', error);
      process.exit(1);
    });
}

module.exports = { syncSingleUserPayments };
