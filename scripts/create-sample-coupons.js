const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function createSampleCoupons() {
  console.log('🎫 Criando cupons de exemplo...');

  const sampleCoupons = [
    {
      code: 'WELCOME10',
      name: 'Cupom de Boas-vindas',
      description: '10% de desconto para novos usuários',
      type: 'PERCENTAGE',
      value: 10,
      maxUses: 100,
      validFrom: new Date(),
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 dias
    },
    {
      code: 'LOYALTY20',
      name: 'Cupom de Fidelidade',
      description: '20% de desconto para assinantes de 3+ meses',
      type: 'PERCENTAGE',
      value: 20,
      maxUses: 50,
      minSubscriptionMonths: 3,
      validFrom: new Date(),
      validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 dias
    },
    {
      code: 'FREEMONTH',
      name: 'Mês Grátis',
      description: 'Próximo mês gratuito para assinantes ativos',
      type: 'FREE_MONTH',
      value: 0,
      maxUses: 25,
      minSubscriptionMonths: 1,
      validFrom: new Date(),
      validUntil: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // 60 dias
    },
    {
      code: 'FIXED50',
      name: 'Desconto Fixo',
      description: 'R$ 50,00 de desconto em qualquer plano',
      type: 'FIXED_AMOUNT',
      value: 50,
      maxUses: 75,
      validFrom: new Date(),
      validUntil: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000), // 45 dias
    },
    {
      code: 'YEARLY25',
      name: 'Desconto Anual',
      description: '25% de desconto em planos anuais',
      type: 'PERCENTAGE',
      value: 25,
      maxUses: 30,
      applicablePlans: JSON.stringify([1, 2, 3]), // IDs dos planos anuais
      validFrom: new Date(),
      validUntil: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000), // 120 dias
    },
  ];

  for (const couponData of sampleCoupons) {
    try {
      const coupon = await prisma.coupon.create({
        data: couponData,
      });
      console.log(`✅ Cupom criado: ${coupon.code} - ${coupon.name}`);
    } catch (error) {
      if (error.code === 'P2002') {
        console.log(`⚠️  Cupom já existe: ${couponData.code}`);
      } else {
        console.error(`❌ Erro ao criar cupom ${couponData.code}:`, error.message);
      }
    }
  }

  console.log('🎉 Cupons de exemplo criados com sucesso!');
}

async function main() {
  try {
    await createSampleCoupons();
  } catch (error) {
    console.error('Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}

module.exports = { createSampleCoupons }; 