const { PrismaClient } = require('@prisma/client');
const Stripe = require('stripe');

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function stripeCommands(program) {
  const stripeCmd = program.command('stripe').description('Comandos para gerenciamento do Stripe');

  // Status do Stripe
  stripeCmd
    .command('status')
    .description('Verificar status da integração com Stripe')
    .action(async () => {
      try {
        console.log('🔍 Verificando status do Stripe...');

        // Verificar se a chave está configurada
        if (!process.env.STRIPE_SECRET_KEY) {
          console.error('❌ STRIPE_SECRET_KEY não configurada');
          process.exit(1);
        }

        // Testar conexão com Stripe
        const account = await stripe.accounts.retrieve();
        console.log('✅ Conexão com Stripe: OK');
        console.log(`   Conta: ${account.business_profile?.name || 'N/A'}`);
        console.log(`   País: ${account.country}`);
        console.log(`   Moeda: ${account.default_currency}`);

        // Verificar produtos/planos
        const products = await stripe.products.list({ limit: 10 });
        console.log(`\n📦 Produtos no Stripe: ${products.data.length}`);
        products.data.forEach((product) => {
          console.log(`   - ${product.name} (${product.id})`);
        });

        // Verificar clientes
        const customers = await stripe.customers.list({ limit: 5 });
        console.log(`\n👥 Clientes no Stripe: ${customers.data.length} (mostrando 5)`);

        // Verificar pagamentos recentes
        const payments = await stripe.paymentIntents.list({ limit: 5 });
        console.log(`\n💳 Pagamentos recentes: ${payments.data.length} (mostrando 5)`);
      } catch (error) {
        console.error('❌ Erro ao verificar status do Stripe:', error.message);
        process.exit(1);
      }
    });

  // Sincronizar planos
  stripeCmd
    .command('sync-plans')
    .description('Sincronizar planos do banco com o Stripe')
    .option('--force', 'Forçar sincronização completa')
    .action(async (options) => {
      try {
        console.log('🔄 Sincronizando planos...');

        const plans = await prisma.plan.findMany();
        console.log(`📋 Encontrados ${plans.length} planos no banco`);

        let created = 0;
        let updated = 0;

        for (const plan of plans) {
          try {
            // Verificar se o produto já existe no Stripe
            let stripeProduct;
            try {
              stripeProduct = await stripe.products.retrieve(plan.stripeProductId);
            } catch (error) {
              if (error.code === 'resource_missing') {
                stripeProduct = null;
              } else {
                throw error;
              }
            }

            if (!stripeProduct) {
              // Criar produto no Stripe
              const product = await stripe.products.create({
                id: plan.stripeProductId,
                name: plan.name,
                description: plan.description,
                metadata: {
                  planId: plan.id.toString(),
                  type: plan.type,
                },
              });

              // Criar preço
              await stripe.prices.create({
                product: product.id,
                unit_amount: Math.round(plan.price * 100), // Stripe usa centavos
                currency: 'brl',
                recurring: {
                  interval: plan.interval.toLowerCase(),
                },
                metadata: {
                  planId: plan.id.toString(),
                },
              });

              created++;
              console.log(`   ✅ Criado: ${plan.name}`);
            } else {
              // Atualizar produto existente
              await stripe.products.update(plan.stripeProductId, {
                name: plan.name,
                description: plan.description,
              });

              updated++;
              console.log(`   🔄 Atualizado: ${plan.name}`);
            }
          } catch (error) {
            console.error(`   ❌ Erro ao processar plano ${plan.name}:`, error.message);
          }
        }

        console.log(`\n✅ Sincronização concluída:`);
        console.log(`   Criados: ${created}`);
        console.log(`   Atualizados: ${updated}`);
      } catch (error) {
        console.error('❌ Erro ao sincronizar planos:', error.message);
        process.exit(1);
      }
    });

  // Sincronizar clientes
  stripeCmd
    .command('sync-customers')
    .description('Sincronizar clientes do banco com o Stripe')
    .option('--force', 'Forçar sincronização completa')
    .action(async (options) => {
      try {
        console.log('🔄 Sincronizando clientes...');

        const users = await prisma.user.findMany({
          where: {
            stripeCustomerId: null,
          },
          select: {
            id: true,
            email: true,
            name: true,
          },
        });

        console.log(`📋 Encontrados ${users.length} usuários sem Stripe Customer ID`);

        let created = 0;
        let errors = 0;

        for (const user of users) {
          try {
            // Criar cliente no Stripe
            const customer = await stripe.customers.create({
              email: user.email,
              name: user.name,
              metadata: {
                userId: user.id.toString(),
              },
            });

            // Atualizar usuário no banco
            await prisma.user.update({
              where: { id: user.id },
              data: { stripeCustomerId: customer.id },
            });

            created++;
            console.log(`   ✅ Criado: ${user.email}`);
          } catch (error) {
            errors++;
            console.error(`   ❌ Erro ao criar cliente ${user.email}:`, error.message);
          }
        }

        console.log(`\n✅ Sincronização concluída:`);
        console.log(`   Criados: ${created}`);
        console.log(`   Erros: ${errors}`);
      } catch (error) {
        console.error('❌ Erro ao sincronizar clientes:', error.message);
        process.exit(1);
      }
    });

  // Verificar pagamentos
  stripeCmd
    .command('check-payments')
    .description('Verificar pagamentos no Stripe')
    .option('-d, --days <number>', 'Dias para verificar', '7')
    .option('--sync', 'Sincronizar pagamentos com o banco')
    .action(async (options) => {
      try {
        const days = parseInt(options.days);
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        console.log(`🔍 Verificando pagamentos dos últimos ${days} dias...`);

        const payments = await stripe.paymentIntents.list({
          created: {
            gte: Math.floor(since.getTime() / 1000),
          },
          limit: 100,
        });

        console.log(`📊 Encontrados ${payments.data.length} pagamentos no Stripe`);

        let successCount = 0;
        let failedCount = 0;
        let pendingCount = 0;

        payments.data.forEach((payment) => {
          switch (payment.status) {
            case 'succeeded':
              successCount++;
              break;
            case 'canceled':
            case 'requires_payment_method':
              failedCount++;
              break;
            default:
              pendingCount++;
          }
        });

        console.log(`\n📈 Status dos pagamentos:`);
        console.log(`   Sucessos: ${successCount}`);
        console.log(`   Falhas: ${failedCount}`);
        console.log(`   Pendentes: ${pendingCount}`);

        if (options.sync) {
          console.log('\n🔄 Sincronizando com banco de dados...');

          let synced = 0;
          for (const payment of payments.data) {
            try {
              // Verificar se já existe no banco
              const existingPayment = await prisma.payment.findFirst({
                where: { stripePaymentIntentId: payment.id },
              });

              if (!existingPayment) {
                // Buscar usuário pelo customer ID
                const user = await prisma.user.findFirst({
                  where: { stripeCustomerId: payment.customer },
                });

                if (user) {
                  await prisma.payment.create({
                    data: {
                      userId: user.id,
                      amount: payment.amount / 100, // Converter de centavos
                      currency: payment.currency,
                      status: payment.status.toUpperCase(),
                      stripePaymentIntentId: payment.id,
                      stripeCustomerId: payment.customer,
                      createdAt: new Date(payment.created * 1000),
                    },
                  });

                  synced++;
                }
              }
            } catch (error) {
              console.error(`   ❌ Erro ao sincronizar pagamento ${payment.id}:`, error.message);
            }
          }

          console.log(`✅ Sincronizados: ${synced} pagamentos`);
        }
      } catch (error) {
        console.error('❌ Erro ao verificar pagamentos:', error.message);
        process.exit(1);
      }
    });

  // Criar webhook
  stripeCmd
    .command('create-webhook')
    .description('Criar webhook do Stripe')
    .requiredOption('-u, --url <url>', 'URL do webhook')
    .option(
      '-e, --events <events>',
      'Eventos (separados por vírgula)',
      'payment_intent.succeeded,payment_intent.payment_failed,customer.subscription.created',
    )
    .action(async (options) => {
      try {
        console.log('🔗 Criando webhook do Stripe...');

        const events = options.events.split(',').map((e) => e.trim());

        const webhook = await stripe.webhookEndpoints.create({
          url: options.url,
          enabled_events: events,
        });

        console.log('✅ Webhook criado com sucesso:');
        console.log(`   ID: ${webhook.id}`);
        console.log(`   URL: ${webhook.url}`);
        console.log(`   Status: ${webhook.status}`);
        console.log(`   Eventos: ${webhook.enabled_events.join(', ')}`);
        console.log(`\n🔑 Chave secreta: ${webhook.secret}`);
        console.log('⚠️  Guarde esta chave em STRIPE_WEBHOOK_SECRET');
      } catch (error) {
        console.error('❌ Erro ao criar webhook:', error.message);
        process.exit(1);
      }
    });

  // Listar webhooks
  stripeCmd
    .command('list-webhooks')
    .description('Listar webhooks do Stripe')
    .action(async () => {
      try {
        console.log('📋 Listando webhooks do Stripe...');

        const webhooks = await stripe.webhookEndpoints.list();

        if (webhooks.data.length === 0) {
          console.log('Nenhum webhook encontrado');
          return;
        }

        webhooks.data.forEach((webhook) => {
          console.log(`\n🔗 Webhook: ${webhook.id}`);
          console.log(`   URL: ${webhook.url}`);
          console.log(`   Status: ${webhook.status}`);
          console.log(`   Eventos: ${webhook.enabled_events.join(', ')}`);
          console.log(`   Criado: ${new Date(webhook.created * 1000).toLocaleDateString('pt-BR')}`);
        });
      } catch (error) {
        console.error('❌ Erro ao listar webhooks:', error.message);
        process.exit(1);
      }
    });
}

module.exports = stripeCommands;
