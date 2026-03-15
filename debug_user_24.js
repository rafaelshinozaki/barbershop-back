const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function debugUser24() {
  try {
    console.log('=== DEBUG USER 24 ===');

    // Verificar o usuário 24 especificamente
    const user24 = await prisma.user.findUnique({
      where: { id: 24 },
      select: {
        id: true,
        email: true,
        stripeCustomerId: true,
        createdAt: true,
      },
    });

    console.log('\n=== USER 24 DETAILS ===');
    if (user24) {
      console.log(`User ID: ${user24.id}`);
      console.log(`Email: ${user24.email}`);
      console.log(`Stripe Customer ID: "${user24.stripeCustomerId}"`);
      console.log(`Stripe Customer ID type: ${typeof user24.stripeCustomerId}`);
      console.log(
        `Stripe Customer ID length: ${
          user24.stripeCustomerId ? user24.stripeCustomerId.length : 'null'
        }`,
      );
      console.log(`Is null: ${user24.stripeCustomerId === null}`);
      console.log(`Is undefined: ${user24.stripeCustomerId === undefined}`);
      console.log(`Is empty string: ${user24.stripeCustomerId === ''}`);
      console.log(
        `Trimmed length: ${
          user24.stripeCustomerId ? user24.stripeCustomerId.trim().length : 'null'
        }`,
      );
    } else {
      console.log('User 24 not found');
    }

    // Verificar também o usuário 1 para comparação
    const user1 = await prisma.user.findUnique({
      where: { id: 1 },
      select: {
        id: true,
        email: true,
        stripeCustomerId: true,
      },
    });

    console.log('\n=== USER 1 DETAILS (for comparison) ===');
    if (user1) {
      console.log(`User ID: ${user1.id}`);
      console.log(`Email: ${user1.email}`);
      console.log(`Stripe Customer ID: "${user1.stripeCustomerId}"`);
    } else {
      console.log('User 1 not found');
    }
  } catch (error) {
    console.error('Error debugging user 24:', error);
  } finally {
    await prisma.$disconnect();
  }
}

debugUser24();
