const { PrismaClient } = require('@prisma/client');
const Stripe = require('stripe');

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

async function createPlan(name, description, price, billingCycle, features) {
  try {
    console.log(`Creating plan: ${name}`);

    // Criar produto no Stripe
    const product = await stripe.products.create({
      name,
      description,
    });

    // Determinar intervalo de cobrança
    const recurring = billingCycle === 'YEARLY' ? { interval: 'year' } : { interval: 'month' };

    // Criar preço no Stripe
    const stripePrice = await stripe.prices.create({
      product: product.id,
      unit_amount: Math.round(price * 100), // Converter para centavos
      currency: 'brl',
      recurring,
    });

    // Criar plano no banco de dados
    const plan = await prisma.plan.create({
      data: {
        name,
        description,
        price: price,
        billingCycle,
        features,
        stripePriceId: stripePrice.id,
      },
    });

    console.log(`✅ Plan created: ${name} (ID: ${plan.id}, Stripe Price: ${stripePrice.id})`);
    return plan;
  } catch (error) {
    console.error(`❌ Failed to create plan ${name}:`, error.message);
    throw error;
  }
}

async function initPlans() {
  try {
    console.log('🚀 Initializing plans...');

    // Verificar se já existem planos
    const existingPlans = await prisma.plan.count();
    if (existingPlans > 0) {
      console.log(`⚠️  Found ${existingPlans} existing plans. Skipping initialization.`);
      return;
    }

    // Criar planos de exemplo
    const plans = [
      {
        name: 'Plano Básico',
        description: 'Ideal para pequenas empresas e profissionais autônomos',
        price: 29.9,
        billingCycle: 'MONTHLY',
        features: 'Análises básicas, Suporte por email, 5 projetos ativos',
      },
      {
        name: 'Plano Profissional',
        description: 'Perfeito para empresas em crescimento',
        price: 79.9,
        billingCycle: 'MONTHLY',
        features:
          'Análises avançadas, Suporte prioritário, 20 projetos ativos, Relatórios personalizados',
      },
      {
        name: 'Plano Empresarial',
        description: 'Solução completa para grandes empresas',
        price: 199.9,
        billingCycle: 'MONTHLY',
        features:
          'Análises ilimitadas, Suporte 24/7, Projetos ilimitados, API personalizada, Treinamento incluído',
      },
      {
        name: 'Plano Básico Anual',
        description: 'Plano básico com desconto anual',
        price: 299.9,
        billingCycle: 'YEARLY',
        features: 'Análises básicas, Suporte por email, 5 projetos ativos, 2 meses grátis',
      },
      {
        name: 'Plano Profissional Anual',
        description: 'Plano profissional com desconto anual',
        price: 799.9,
        billingCycle: 'YEARLY',
        features:
          'Análises avançadas, Suporte prioritário, 20 projetos ativos, Relatórios personalizados, 2 meses grátis',
      },
    ];

    for (const planData of plans) {
      await createPlan(
        planData.name,
        planData.description,
        planData.price,
        planData.billingCycle,
        planData.features,
      );
    }

    console.log('✅ All plans initialized successfully!');
  } catch (error) {
    console.error('❌ Error initializing plans:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  initPlans();
}

module.exports = { initPlans };
