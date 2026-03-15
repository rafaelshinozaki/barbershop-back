require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const Stripe = require('stripe');

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function importStripeData() {
  try {
    console.log('Iniciando importação dos dados do Stripe...');
    // 1. Buscar todos os clientes do Stripe
    const customers = [];
    let hasMore = true;
    let startingAfter = undefined;
    while (hasMore) {
      const resp = await stripe.customers.list({ limit: 100, starting_after: startingAfter });
      customers.push(...resp.data);
      hasMore = resp.has_more;
      if (hasMore) {
        startingAfter = resp.data[resp.data.length - 1].id;
      }
    }
    console.log(`Clientes encontrados no Stripe: ${customers.length}`);

    for (const customer of customers) {
      // 2. Criar usuário no banco se não existir
      let user = await prisma.user.findUnique({
        where: {
          email_provider: {
            email: customer.email || `${customer.id}@stripe.local`,
            provider: 'stripe',
          },
        },
      });
      if (!user) {
        user = await prisma.user.create({
          data: {
            email: customer.email || `${customer.id}@stripe.local`,
            fullName: customer.name || customer.email || customer.id,
            provider: 'stripe',
            password: 'imported', // senha dummy
            phone: customer.phone || '',
            gender: 'N/A',
            birthdate: new Date(2000, 0, 1),
            idDocNumber: customer.id,
            company: customer.metadata?.company || '',
            professionalSegment: '',
            knowledgeApp: '',
            readTerms: false,
            isActive: true,
            stripeCustomerId: customer.id,
            membership: 'FREE',
            roleId: 1, // ajuste se necessário
          },
        });
        console.log(`Usuário criado: ${user.email}`);
      } else {
        // Atualiza stripeCustomerId se necessário
        if (user.stripeCustomerId !== customer.id) {
          await prisma.user.update({
            where: { id: user.id },
            data: { stripeCustomerId: customer.id },
          });
          console.log(`Usuário atualizado: ${user.email}`);
        }
      }

      // 3. Buscar assinaturas do cliente
      const subscriptions = await stripe.subscriptions.list({ customer: customer.id, limit: 100 });
      for (const sub of subscriptions.data) {
        // 4. Criar assinatura no banco se não existir
        let dbSub = await prisma.subscription.findFirst({
          where: { stripeSubscriptionId: sub.id },
        });
        if (!dbSub) {
          // Buscar plano pelo stripePriceId
          let plan = await prisma.plan.findFirst({
            where: { stripePriceId: sub.items.data[0]?.price?.id },
          });
          if (!plan) {
            // Cria plano dummy se não existir
            plan = await prisma.plan.create({
              data: {
                name: sub.items.data[0]?.price?.nickname || 'Stripe Plan',
                price: Number(sub.items.data[0]?.price?.unit_amount || 0) / 100,
                billingCycle:
                  sub.items.data[0]?.price?.recurring?.interval?.toUpperCase() || 'UNKNOWN',
                features: '',
                stripePriceId: sub.items.data[0]?.price?.id,
              },
            });
          }
          dbSub = await prisma.subscription.create({
            data: {
              userId: user.id,
              planId: plan.id,
              startSubDate: new Date(sub.start_date * 1000),
              cancelationDate: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
              status: sub.status.toUpperCase(),
              stripeCustomerId: customer.id,
              stripeSubscriptionId: sub.id,
            },
          });
          console.log(`Assinatura criada: ${sub.id} para usuário ${user.email}`);
        }

        // 5. Buscar pagamentos (invoices) da assinatura
        const invoices = await stripe.invoices.list({ subscription: sub.id, limit: 100 });
        for (const inv of invoices.data) {
          let dbPay = await prisma.payment.findFirst({ where: { transactionId: inv.id } });
          if (!dbPay) {
            await prisma.payment.create({
              data: {
                subscriptionId: dbSub.id,
                amount: Number(inv.amount_paid || 0) / 100,
                paymentDate: inv.status_transitions?.paid_at
                  ? new Date(inv.status_transitions.paid_at * 1000)
                  : new Date(),
                nextPaymentDate: inv.due_date ? new Date(inv.due_date * 1000) : new Date(),
                paymentMethod: inv.payment_method_types?.[0] || 'unknown',
                transactionId: inv.id,
                status: inv.status.toUpperCase(),
              },
            });
            console.log(`Pagamento criado: ${inv.id} para assinatura ${sub.id}`);
          }
        }
      }
    }
    console.log('Importação concluída!');
  } catch (err) {
    console.error('Erro ao importar dados do Stripe:', err);
  } finally {
    await prisma.$disconnect();
  }
}

importStripeData();
