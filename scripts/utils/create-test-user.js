const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function createTestUser() {
  try {
    console.log('Creating test user...');

    // Primeiro, vamos verificar se existe um role
    let role = await prisma.role.findFirst({
      where: { name: 'User' },
    });

    if (!role) {
      console.log('Creating User role...');
      role = await prisma.role.create({
        data: { name: 'User' },
      });
    }

    const hashedPassword = await bcrypt.hash('test123', 10);

    const user = await prisma.user.create({
      data: {
        fullName: 'Test User',
        email: 'test@relable.com',
        password: hashedPassword,
        provider: 'local',
        phone: '(11) 99999-9999',
        gender: 'Male',
        birthdate: new Date('1990-01-01'),
        idDocNumber: '12345678901',
        company: 'Test Company',
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
            street: 'Test Street',
            city: 'São Paulo',
            neighborhood: 'Test Neighborhood',
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

    console.log('Test user created successfully:', user.email);
    console.log('Password: test123');
  } catch (error) {
    console.error('Error creating test user:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createTestUser();
