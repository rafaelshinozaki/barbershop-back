const { PrismaClient } = require('@prisma/client');
const Stripe = require('stripe');

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

async function updatePlanWithStripe(plan) {
  try {
    console.log(`Updating plan: ${plan.name}`);

    // Criar produto no Stripe
    const product = await stripe.products.create({
      name: plan.name,
      description: plan.description,
    });

    // Determinar intervalo de cobrança
    const recurring = plan.billingCycle === 'YEARLY' ? { interval: 'year' } : { interval: 'month' };

    // Criar preço no Stripe
    const stripePrice = await stripe.prices.create({
      product: product.id,
      unit_amount: Math.round(plan.price * 100), // Converter para centavos
      currency: 'brl',
      recurring,
    });

    // Atualizar plano no banco de dados
    const updatedPlan = await prisma.plan.update({
      where: { id: plan.id },
      data: {
        stripePriceId: stripePrice.id,
      },
    });

    console.log(`✅ Plan updated: ${plan.name} (ID: ${plan.id}, Stripe Price: ${stripePrice.id})`);
    return updatedPlan;
  } catch (error) {
    console.error(`❌ Failed to update plan ${plan.name}:`, error.message);
    throw error;
  }
}

async function updatePlansWithStripe() {
  try {
    console.log('🚀 Updating plans with Stripe...');

    // Buscar todos os planos
    const plans = await prisma.plan.findMany();

    if (plans.length === 0) {
      console.log('⚠️  No plans found. Run init-plans.js first.');
      return;
    }

    console.log(`Found ${plans.length} plans to update`);

    // Atualizar cada plano
    for (const plan of plans) {
      if (!plan.stripePriceId) {
        await updatePlanWithStripe(plan);
      } else {
        console.log(`⚠️  Plan ${plan.name} already has Stripe price ID: ${plan.stripePriceId}`);
      }
    }

    console.log('✅ All plans updated successfully!');
  } catch (error) {
    console.error('❌ Error updating plans:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  updatePlansWithStripe();
}

module.exports = { updatePlansWithStripe };
