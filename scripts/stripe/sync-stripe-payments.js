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

// Função para sincronizar pagamentos de um usuário
async function syncUserPayments(user) {
  console.log(`\n🔄 Sincronizando pagamentos para usuário: ${user.email} (ID: ${user.id})`);
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

    console.log(`   📋 Encontradas ${subscriptions.length} assinaturas com Stripe ID`);

    // Buscar invoices do Stripe
    const invoices = await stripe.invoices.list({
      customer: user.stripeCustomerId,
      limit: 100, // Limitar a 100 invoices para evitar sobrecarga
    });

    console.log(`   💳 Encontrados ${invoices.data.length} invoices no Stripe`);

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
            : new Date(stripeDateToDate(invoice.created).getTime() + 30 * 24 * 60 * 60 * 1000), // +30 dias padrão
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
          console.log(`   ✅ Atualizado pagamento: ${invoice.id}`);
        } else {
          // Criar novo pagamento
          await prisma.payment.create({
            data: paymentData,
          });
          totalCreated++;
          console.log(`   ➕ Criado pagamento: ${invoice.id}`);
        }

        totalProcessed++;
      } catch (error) {
        console.error(`   ❌ Erro ao processar invoice ${invoice.id}:`, error.message);
        totalErrors++;
      }
    }

    console.log(`   📊 Resumo para ${user.email}:`);
    console.log(`      - Processados: ${totalProcessed}`);
    console.log(`      - Criados: ${totalCreated}`);
    console.log(`      - Atualizados: ${totalUpdated}`);
    console.log(`      - Erros: ${totalErrors}`);

    return {
      userId: user.id,
      email: user.email,
      processed: totalProcessed,
      created: totalCreated,
      updated: totalUpdated,
      errors: totalErrors,
    };
  } catch (error) {
    console.error(`   💥 Erro ao sincronizar usuário ${user.email}:`, error.message);
    return {
      userId: user.id,
      email: user.email,
      processed: 0,
      created: 0,
      updated: 0,
      errors: 1,
      error: error.message,
    };
  }
}

// Função principal
async function syncAllStripePayments() {
  console.log('🚀 Iniciando sincronização de pagamentos Stripe...\n');

  try {
    // Buscar todos os usuários com stripeCustomerId
    const users = await prisma.user.findMany({
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
        fullName: true,
        stripeCustomerId: true,
      },
    });

    console.log(`📋 Encontrados ${users.length} usuários com Stripe Customer ID\n`);

    if (users.length === 0) {
      console.log('❌ Nenhum usuário com Stripe Customer ID encontrado');
      return;
    }

    const results = [];
    let totalProcessed = 0;
    let totalCreated = 0;
    let totalUpdated = 0;
    let totalErrors = 0;

    // Processar cada usuário
    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      console.log(`\n[${i + 1}/${users.length}] Processando usuário...`);

      const result = await syncUserPayments(user);
      results.push(result);

      // Atualizar totais
      totalProcessed += result.processed;
      totalCreated += result.created;
      totalUpdated += result.updated;
      totalErrors += result.errors;

      // Pequena pausa para não sobrecarregar a API do Stripe
      if (i < users.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    // Relatório final
    console.log('\n' + '='.repeat(60));
    console.log('📊 RELATÓRIO FINAL DE SINCRONIZAÇÃO');
    console.log('='.repeat(60));
    console.log(`👥 Usuários processados: ${users.length}`);
    console.log(`💳 Pagamentos processados: ${totalProcessed}`);
    console.log(`➕ Pagamentos criados: ${totalCreated}`);
    console.log(`🔄 Pagamentos atualizados: ${totalUpdated}`);
    console.log(`❌ Erros: ${totalErrors}`);
    console.log('='.repeat(60));

    // Salvar relatório em arquivo
    const fs = require('fs');
    const reportData = {
      timestamp: new Date().toISOString(),
      summary: {
        totalUsers: users.length,
        totalProcessed: totalProcessed,
        totalCreated: totalCreated,
        totalUpdated: totalUpdated,
        totalErrors: totalErrors,
      },
      details: results,
    };

    const reportPath = `stripe-sync-report-${new Date().toISOString().split('T')[0]}.json`;
    fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
    console.log(`\n📄 Relatório detalhado salvo em: ${reportPath}`);
  } catch (error) {
    console.error('💥 Erro durante a sincronização:', error);
  } finally {
    await prisma.$disconnect();
    console.log('\n🔌 Conexão com banco de dados fechada');
  }
}

// Executar o script
if (require.main === module) {
  syncAllStripePayments()
    .then(() => {
      console.log('\n✅ Sincronização concluída com sucesso!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Erro fatal:', error);
      process.exit(1);
    });
}

module.exports = { syncAllStripePayments, syncUserPayments };
