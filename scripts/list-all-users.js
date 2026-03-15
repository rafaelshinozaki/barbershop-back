const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function listAllUsers() {
  try {
    console.log('\n📋 Listando todos os usuários...\n');

    const users = await prisma.user.findMany({
      include: {
        role: true,
        subscriptions: {
          include: {
            plan: true,
          },
          where: {
            status: 'ACTIVE',
          },
        },
      },
      orderBy: {
        id: 'asc',
      },
    });

    console.log(`Total de usuários: ${users.length}\n`);

    users.forEach((user) => {
      const activeSub = user.subscriptions[0];
      console.log(`ID: ${user.id} | ${user.fullName} (${user.email})`);
      console.log(
        `   Membership: ${user.membership} | Active: ${user.isActive} | Role: ${
          user.role?.name || 'N/A'
        }`,
      );

      if (activeSub) {
        console.log(`   ✅ Subscription ATIVA: ${activeSub.plan.name} (ID: ${activeSub.id})`);
      } else {
        console.log(`   ❌ Sem subscription ativa`);
      }
      console.log('');
    });
  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

listAllUsers();
