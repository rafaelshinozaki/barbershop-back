const { PrismaClient } = require('@prisma/client');
const Stripe = require('stripe');

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

async function syncPlansWithStripe() {
  try {
    console.log('🔄 Iniciando sincronização dos planos com o Stripe...');

    // Buscar todos os planos que não têm stripePriceId
    const plans = await prisma.plan.findMany({
      where: {
        deleted_at: null,
        stripePriceId: null,
      },
    });

    console.log(`📋 Encontrados ${plans.length} planos para sincronizar`);

    for (const plan of plans) {
      try {
        console.log(`\n🔄 Sincronizando plano: ${plan.name}`);

        // Criar produto no Stripe
        const stripeProduct = await stripe.products.create({
          name: plan.name,
          description: plan.description || undefined,
        });

        console.log(`✅ Produto criado: ${stripeProduct.id}`);

        // Determinar o intervalo de cobrança
        let recurring;
        switch (plan.billingCycle.toUpperCase()) {
          case 'MONTHLY':
            recurring = { interval: 'month' };
            break;
          case 'YEARLY':
            recurring = { interval: 'year' };
            break;
          case 'WEEKLY':
            recurring = { interval: 'week' };
            break;
          case 'DAILY':
            recurring = { interval: 'day' };
            break;
          default:
            recurring = { interval: 'month' };
        }

        // Criar preço no Stripe
        const stripePrice = await stripe.prices.create({
          product: stripeProduct.id,
          unit_amount: Math.round(Number(plan.price) * 100), // Converter para centavos
          currency: 'brl',
          recurring,
        });

        console.log(`✅ Preço criado: ${stripePrice.id}`);

        // Atualizar plano com o ID do preço do Stripe
        await prisma.plan.update({
          where: { id: plan.id },
          data: { stripePriceId: stripePrice.id },
        });

        console.log(`✅ Plano ${plan.name} sincronizado com sucesso!`);
      } catch (error) {
        console.error(`❌ Erro ao sincronizar plano ${plan.name}:`, error.message);
      }
    }

    console.log('\n✅ Sincronização concluída!');
  } catch (error) {
    console.error('❌ Erro durante a sincronização:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Executar o script
syncPlansWithStripe();
