const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkPlans() {
  try {
    const plans = await prisma.plan.findMany();
    console.log('Planos encontrados:');
    plans.forEach(plan => {
      console.log(`- ${plan.name}: R$ ${plan.price} (stripePriceId: ${plan.stripePriceId || 'NÃO CONFIGURADO'})`);
    });
  } catch (error) {
    console.error('Erro ao buscar planos:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkPlans(); 