const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function insertTestData() {
  try {
    console.log('Inserindo dados de teste...');

    // Buscar o usuário de teste
    const testUser = await prisma.user.findFirst({
      where: { email: 'rafael.sinosaki@barbershop.com' },
    });

    if (!testUser) {
      console.error(
        'Usuário de teste não encontrado. Execute primeiro o script create-test-user.js',
      );
      return;
    }

    console.log(`Usuário encontrado: ${testUser.email} (ID: ${testUser.id})`);

    // Inserir dados de teste no LoginHistory
    const loginHistoryData = [
      {
        userId: testUser.id,
        deviceType: 'Laptop',
        browser: 'Chrome',
        os: 'Windows 10',
        ip: '192.168.1.100',
        location: 'São Paulo, Brazil',
        createdAt: new Date(),
      },
      {
        userId: testUser.id,
        deviceType: 'Smartphone',
        browser: 'Safari',
        os: 'iOS 15',
        ip: '192.168.1.101',
        location: 'Rio de Janeiro, Brazil',
        createdAt: new Date(Date.now() - 3600000),
      },
      {
        userId: testUser.id,
        deviceType: 'Tablet',
        browser: 'Firefox',
        os: 'Android 12',
        ip: '192.168.1.102',
        location: 'Belo Horizonte, Brazil',
        createdAt: new Date(Date.now() - 7200000),
      },
    ];

    for (const data of loginHistoryData) {
      await prisma.loginHistory.create({
        data,
      });
    }

    // Inserir dados de teste no ActiveSession
    const activeSessionData = [
      {
        userId: testUser.id,
        deviceType: 'Laptop',
        browser: 'Chrome',
        os: 'Windows 10',
        ip: '192.168.1.100',
        location: 'São Paulo, Brazil',
        createdAt: new Date(),
      },
      {
        userId: testUser.id,
        deviceType: 'Smartphone',
        browser: 'Safari',
        os: 'iOS 15',
        ip: '192.168.1.101',
        location: 'Rio de Janeiro, Brazil',
        createdAt: new Date(Date.now() - 3600000),
      },
    ];

    for (const data of activeSessionData) {
      await prisma.activeSession.create({
        data,
      });
    }

    console.log('Dados de teste inseridos com sucesso!');
  } catch (error) {
    console.error('Erro ao inserir dados de teste:', error);
  } finally {
    await prisma.$disconnect();
  }
}

insertTestData();
