const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function syncUserMembership() {
  try {
    console.log('\n🔄 Sincronizando membership dos usuários...\n');

    // Buscar todos os usuários
    const users = await prisma.user.findMany({
      include: {
        subscriptions: {
          where: {
            status: 'ACTIVE',
          },
        },
      },
    });

    console.log(`Total de usuários: ${users.length}\n`);

    let updatedCount = 0;

    for (const user of users) {
      const hasActiveSubscription = user.subscriptions.length > 0;

      // Determinar o membership correto
      let correctMembership = 'FREE';
      if (hasActiveSubscription) {
        correctMembership = 'PAID';
      }

      // Verificar se precisa atualizar
      if (user.membership !== correctMembership) {
        console.log(`🔧 Atualizando usuário ${user.id} (${user.fullName})`);
        console.log(`   Membership atual: ${user.membership}`);
        console.log(`   Membership correto: ${correctMembership}`);
        console.log(`   Has active subscription: ${hasActiveSubscription}`);

        await prisma.user.update({
          where: { id: user.id },
          data: {
            membership: correctMembership,
            isActive: hasActiveSubscription,
          },
        });

        updatedCount++;
        console.log('   ✅ Atualizado!\n');
      }
    }

    console.log(`\n✅ Sincronização concluída!`);
    console.log(`   Total de usuários atualizados: ${updatedCount}`);
  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

syncUserMembership();
