const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testNotifications() {
  try {
    console.log('🧪 Testando sistema de notificações...\n');

    // 1. Verificar se existe pelo menos um usuário
    const users = await prisma.user.findMany({ take: 1 });
    if (users.length === 0) {
      console.log('❌ Nenhum usuário encontrado. Crie um usuário primeiro.');
      return;
    }

    const testUser = users[0];
    console.log(`✅ Usuário de teste encontrado: ${testUser.email} (ID: ${testUser.id})\n`);

    // 2. Criar uma notificação de teste
    console.log('📝 Criando notificação de teste...');
    const testNotification = await prisma.userNotification.create({
      data: {
        userId: testUser.id,
        title: 'Teste de Notificação',
        message: 'Esta é uma notificação de teste para verificar se o sistema está funcionando.',
        type: 'info',
        isRead: false,
        isNew: true,
        actionUrl: 'https://example.com',
        actionText: 'Ver mais',
      },
    });
    console.log(`✅ Notificação criada com ID: ${testNotification.id}\n`);

    // 3. Buscar notificações do usuário
    console.log('🔍 Buscando notificações do usuário...');
    const userNotifications = await prisma.userNotification.findMany({
      where: { userId: testUser.id },
      orderBy: { createdAt: 'desc' },
    });
    console.log(`✅ Encontradas ${userNotifications.length} notificações\n`);

    // 4. Buscar notificações não lidas
    console.log('📖 Buscando notificações não lidas...');
    const unreadNotifications = await prisma.userNotification.findMany({
      where: {
        userId: testUser.id,
        isRead: false,
      },
    });
    console.log(`✅ Encontradas ${unreadNotifications.length} notificações não lidas\n`);

    // 5. Buscar notificações novas
    console.log('🆕 Buscando notificações novas...');
    const newNotifications = await prisma.userNotification.findMany({
      where: {
        userId: testUser.id,
        isNew: true,
      },
    });
    console.log(`✅ Encontradas ${newNotifications.length} notificações novas\n`);

    // 6. Marcar notificação como lida
    console.log('✅ Marcando notificação como lida...');
    const updatedNotification = await prisma.userNotification.update({
      where: { id: testNotification.id },
      data: {
        isRead: true,
        isNew: false,
      },
    });
    console.log(`✅ Notificação marcada como lida: ${updatedNotification.isRead}\n`);

    // 7. Verificar contagem
    console.log('📊 Verificando contagem de notificações...');
    const [unreadCount, newCount] = await Promise.all([
      prisma.userNotification.count({
        where: {
          userId: testUser.id,
          isRead: false,
        },
      }),
      prisma.userNotification.count({
        where: {
          userId: testUser.id,
          isNew: true,
        },
      }),
    ]);
    console.log(`✅ Contagem - Não lidas: ${unreadCount}, Novas: ${newCount}\n`);

    // 8. Deletar notificação de teste
    console.log('🗑️ Deletando notificação de teste...');
    await prisma.userNotification.delete({
      where: { id: testNotification.id },
    });
    console.log('✅ Notificação de teste deletada\n');

    console.log(
      '🎉 Todos os testes passaram! O sistema de notificações está funcionando corretamente.',
    );
  } catch (error) {
    console.error('❌ Erro durante o teste:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testNotifications();
