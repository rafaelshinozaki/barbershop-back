const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function createUser() {
  try {
    let role = await prisma.role.findFirst({
      where: { name: 'BarbershopOwner' },
    });

    if (!role) {
      role = await prisma.role.create({
        data: { name: 'BarbershopOwner' },
      });
    }

    const hashedPassword = await bcrypt.hash('Adv88798!', 10);

    const user = await prisma.user.create({
      data: {
        fullName: 'Rafael',
        email: 'rafaelsinosak@gmail.com',
        password: hashedPassword,
        provider: 'local',
        phone: '(11) 99999-9999',
        gender: 'Male',
        birthdate: new Date('1990-01-01'),
        idDocNumber: '12345678901',
        company: 'Barbershop',
        professionalSegment: 'IT',
        knowledgeApp: 'LinkedIn',
        readTerms: true,
        isActive: true,
        roleId: role.id,
        userSystemConfig: {
          create: {
            theme: 'light',
            accentColor: 'blue',
            grayColor: 'gray',
            radius: 'medium',
            scaling: '100%',
            language: 'pt',
          },
        },
        address: {
          create: {
            zipcode: '01234-567',
            street: 'Rua Exemplo',
            city: 'São Paulo',
            neighborhood: 'Centro',
            state: 'SP',
            country: 'Brazil',
          },
        },
        emailNotification: {
          create: {
            news: true,
            promotions: false,
            instability: true,
            security: true,
          },
        },
      },
    });

    console.log('Usuário criado com sucesso:', user.email);
    console.log('ID:', user.id);
  } catch (error) {
    if (error.code === 'P2002') {
      console.error('Erro: já existe um usuário com este email.');
    } else {
      console.error('Erro ao criar usuário:', error.message);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

createUser();
