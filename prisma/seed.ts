import { PrismaClient } from '@prisma/client';
import { Sex, faker } from '@faker-js/faker';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const jobTypes = [
  'Frontend Developer',
  'Backend Developer',
  'Devops',
  'Tech Support',
  'Software Engineer',
  'Data Scientist',
  'Product Manager',
  'QA Engineer',
  'System Administrator',
  'Network Engineer',
  'Database Administrator',
  'UI/UX Designer',
  'Project Manager',
  'Business Analyst',
  'DevOps Engineer',
  'Full Stack Developer',
  'Mobile Developer',
  'Cloud Engineer',
  'Security Engineer',
  'Technical Lead',
];

const departments = [
  'Engineering',
  'Development',
  'IT',
  'Operations',
  'Quality Assurance',
  'Product',
  'Design',
  'Data Science',
  'Infrastructure',
  'Security',
  'DevOps',
  'Frontend',
  'Backend',
  'Mobile',
  'Cloud',
  'Support',
  'Research',
  'Innovation',
  'Architecture',
  'Platform',
];

const roles = [
  'User',
  'Manager',
  'Admin',
  'BarbershopOwner',
  'BarbershopEmployee',
];

const plans = [
  {
    name: 'Basic',
    description: 'Basic plan with limited features',
    price: 9.99,
    billingCycle: 'MONTHLY',
    features: 'Basic Support, 10 Projects',
  },
  {
    name: 'Basic',
    description: 'Basic plan with limited features',
    price: 99.99,
    billingCycle: 'YEARLY',
    features: 'Basic Support, 10 Projects',
  },
  {
    name: 'Standard',
    description: 'Standard plan with additional features',
    price: 19.99,
    billingCycle: 'MONTHLY',
    features: 'Priority Support, 50 Projects',
  },
  {
    name: 'Standard',
    description: 'Standard plan with additional features',
    price: 189.99,
    billingCycle: 'YEARLY',
    features: 'Priority Support, 50 Projects',
  },
  {
    name: 'Premium',
    description: 'Premium plan with all features',
    price: 29.99,
    billingCycle: 'MONTHLY',
    features: '24/7 Support, Unlimited Projects',
  },
  {
    name: 'Premium',
    description: 'Premium plan with all features',
    price: 284.99,
    billingCycle: 'YEARLY',
    features: '24/7 Support, Unlimited Projects',
  },
];

const userSystemConfig = {
  create: {
    theme: faker.helpers.arrayElement(['light', 'dark']),
    accentColor: faker.helpers.arrayElement([
      'gray',
      'gold',
      'bronze',
      'brown',
      'yellow',
      'amber',
      'orange',
      'tomato',
      'red',
      'ruby',
      'crimson',
      'pink',
      'plum',
      'purple',
      'violet',
      'iris',
      'indigo',
      'blue',
      'cyan',
      'teal',
      'jade',
      'green',
      'grass',
      'lime',
      'mint',
      'sky',
    ]),
    grayColor: faker.helpers.arrayElement([
      'auto',
      'gray',
      'mauve',
      'slate',
      'sage',
      'olive',
      'sand',
    ]),
    radius: faker.helpers.arrayElement(['small', 'none', 'medium', 'large', 'full']),
    scaling: faker.helpers.arrayElement(['90%', '95%', '100%', '105%', '110%']),
    language: faker.helpers.arrayElement(['es', 'en', 'pt']),
  },
};

async function createRandomUser() {
  const firstName = faker.name.firstName();
  const lastName = faker.name.lastName();
  return {
    fullName: `${firstName} ${lastName}`,
    email: faker.internet.email(firstName, lastName, 'relable.com'),
    provider: 'local',
    phone: faker.phone.number('(###) ###-####'),
    gender: faker.helpers.arrayElement([Sex.Male, Sex.Female]),
    birthdate: faker.date.birthdate(),
    idDocNumber: Math.floor(10000000000 + Math.random() * 90000000000).toString(),
    password: await bcrypt.hash('pwned', 10),
    company: faker.company.name(),
    jobTitle: faker.helpers.arrayElement(jobTypes),
    department: faker.helpers.arrayElement(departments),
    professionalSegment: 'IT',
    knowledgeApp: 'LinkedIn',
    readTerms: true,
    userSystemConfig: {
      theme: faker.helpers.arrayElement(['light', 'dark']),
      accentColor: faker.helpers.arrayElement([
        'gray',
        'gold',
        'bronze',
        'brown',
        'yellow',
        'amber',
        'orange',
        'tomato',
        'red',
        'ruby',
        'crimson',
        'pink',
        'plum',
        'purple',
        'violet',
        'iris',
        'indigo',
        'blue',
        'cyan',
        'teal',
        'jade',
        'green',
        'grass',
        'lime',
        'mint',
        'sky',
      ]),
      grayColor: faker.helpers.arrayElement([
        'auto',
        'gray',
        'mauve',
        'slate',
        'sage',
        'olive',
        'sand',
      ]),
      radius: faker.helpers.arrayElement(['small', 'none', 'medium', 'large', 'full']),
      scaling: faker.helpers.arrayElement(['90%', '95%', '100%', '105%', '110%']),
      language: faker.helpers.arrayElement(['es', 'en', 'pt']),
    },
    address: {
      zipcode: faker.address.zipCode(),
      street: faker.address.street(),
      city: faker.address.city(),
      neighborhood: faker.address.street(),
      state: faker.address.stateAbbr(),
      country: 'Brazil',
    },
    emailNotification: {
      news: faker.helpers.arrayElement([true, false]),
      promotions: faker.helpers.arrayElement([true, false]),
      instability: faker.helpers.arrayElement([true, false]),
      security: faker.helpers.arrayElement([true, false]),
    },
  };
}

async function main() {
  try {
    console.log('Starting seed script...');

    // Clean DB
    console.log('Cleaning database...');
    await prisma.$transaction([
      prisma.userNotification.deleteMany(),
      prisma.invalidatedToken.deleteMany(),
      prisma.activeSession.deleteMany(),
      prisma.loginHistory.deleteMany(),
      prisma.verificationCode.deleteMany(),
      prisma.payment.deleteMany(),
      prisma.subscription.deleteMany(),
      prisma.plan.deleteMany(),
      prisma.address.deleteMany(),
      prisma.userSystemConfig.deleteMany(),
      prisma.emailLogger.deleteMany(),
      prisma.emailNotification.deleteMany(),
      prisma.user.deleteMany(),
      prisma.role.deleteMany(),
    ]);

    // Create plans
    console.log('Creating plans...');
    for (const plan of plans) {
      await prisma.plan.create({
        data: plan,
      });
    }

    // Create roles
    const rs: { id: number; name: string }[] = [];
    console.log('Creating roles...');
    for (const role of roles) {
      const r = await prisma.role.create({
        data: {
          name: role,
        },
      });

      rs.push(r);
    }

    // Create admin
    console.log('Creating admin...');
    await prisma.user.create({
      data: {
        provider: 'local',
        email: 'rafaelsinosak@relable.com',
        fullName: 'Rafael Vieira Sinosaki',
        phone: faker.phone.number('(###) ###-####'),
        gender: faker.helpers.arrayElement([Sex.Male, Sex.Female]),
        birthdate: faker.date.birthdate(),
        idDocNumber: Math.floor(10000000000 + Math.random() * 90000000000).toString(),
        password: await bcrypt.hash('pwned', 10),
        company: faker.company.name(),
        jobTitle: faker.helpers.arrayElement(jobTypes),
        department: faker.helpers.arrayElement(departments),
        professionalSegment: 'IT',
        knowledgeApp: 'LinkedIn',
        readTerms: true,
        isActive: true,
        userSystemConfig: {
          create: {
            theme: faker.helpers.arrayElement(['light', 'dark']),
            accentColor: faker.helpers.arrayElement([
              'gray',
              'gold',
              'bronze',
              'brown',
              'yellow',
              'amber',
              'orange',
              'tomato',
              'red',
              'ruby',
              'crimson',
              'pink',
              'plum',
              'purple',
              'violet',
              'iris',
              'indigo',
              'blue',
              'cyan',
              'teal',
              'jade',
              'green',
              'grass',
              'lime',
              'mint',
              'sky',
            ]),
            grayColor: faker.helpers.arrayElement([
              'auto',
              'gray',
              'mauve',
              'slate',
              'sage',
              'olive',
              'sand',
            ]),
            radius: faker.helpers.arrayElement(['small', 'none', 'medium', 'large', 'full']),
            scaling: faker.helpers.arrayElement(['90%', '95%', '100%', '105%', '110%']),
            language: faker.helpers.arrayElement(['es', 'en', 'pt']),
          },
        },
        emailNotification: {
          create: {
            news: faker.helpers.arrayElement([true, false]),
            promotions: faker.helpers.arrayElement([true, false]),
            instability: faker.helpers.arrayElement([true, false]),
            security: faker.helpers.arrayElement([true, false]),
          },
        },
        address: {
          create: {
            zipcode: faker.address.zipCode(),
            street: faker.address.street(),
            city: faker.address.city(),
            neighborhood: faker.address.street(),
            state: faker.address.stateAbbr(),
            country: 'Brazil',
          },
        },
        roleId: rs.filter((r) => r.name === 'Admin')[0].id,
      },
    });

    // Create developer
    console.log('Creating Developer...');
    await prisma.user.create({
      data: {
        provider: 'local',
        email: 'rafael.lima@relable.com',
        password: await bcrypt.hash('pwned', 10),
        fullName: 'Rafael Lima',
        roleId: rs.filter((r) => r.name === 'Admin')[0].id,
        phone: faker.phone.number('(###) ###-####'),
        gender: faker.helpers.arrayElement([Sex.Male, Sex.Female]),
        birthdate: faker.date.birthdate(),
        idDocNumber: Math.floor(10000000000 + Math.random() * 90000000000).toString(),
        company: faker.company.name(),
        jobTitle: faker.helpers.arrayElement(jobTypes),
        department: faker.helpers.arrayElement(departments),
        professionalSegment: 'IT',
        knowledgeApp: 'LinkedIn',
        readTerms: true,
        membership: 'FREE',
        isActive: true,
        emailNotification: {
          create: {
            news: faker.datatype.boolean(),
            promotions: faker.datatype.boolean(),
            instability: faker.datatype.boolean(),
            security: faker.datatype.boolean(),
          },
        },
        address: {
          create: {
            zipcode: faker.address.zipCode(),
            street: faker.address.street(),
            city: faker.address.city(),
            neighborhood: faker.address.street(),
            state: faker.address.stateAbbr(),
            country: 'Brazil',
          },
        },
        userSystemConfig,
      },
    });

    // Create Rafael (rafaelsinosak@gmail.com)
    console.log('Creating Rafael...');
    await prisma.user.create({
      data: {
        provider: 'local',
        email: 'rafaelsinosak@gmail.com',
        password: await bcrypt.hash('Adv88798!', 10),
        fullName: 'Rafael',
        roleId: rs.filter((r) => r.name === 'User')[0].id,
        phone: '(11) 99999-9999',
        gender: 'Male',
        birthdate: new Date('1990-01-01'),
        idDocNumber: '12345678901',
        company: 'Relable',
        professionalSegment: 'IT',
        knowledgeApp: 'LinkedIn',
        readTerms: true,
        isActive: true,
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

    // Create manager
    console.log('Creating manager...');
    await prisma.user.create({
      data: {
        provider: 'local',
        email: 'humberto.perinni@relable.com',
        password: await bcrypt.hash('pwned', 10),
        fullName: 'Humberto Perinni',
        roleId: rs.filter((r) => r.name === 'Manager')[0].id,
        phone: faker.phone.number('(###) ###-####'),
        gender: faker.helpers.arrayElement([Sex.Male, Sex.Female]),
        birthdate: faker.date.birthdate(),
        idDocNumber: Math.floor(10000000000 + Math.random() * 90000000000).toString(),
        company: faker.company.name(),
        jobTitle: faker.helpers.arrayElement(jobTypes),
        department: faker.helpers.arrayElement(departments),
        professionalSegment: 'IT',
        knowledgeApp: 'LinkedIn',
        readTerms: true,
        membership: 'FREE',
        isActive: true,
        emailNotification: {
          create: {
            news: faker.helpers.arrayElement([true, false]),
            promotions: faker.helpers.arrayElement([true, false]),
            instability: faker.helpers.arrayElement([true, false]),
            security: faker.helpers.arrayElement([true, false]),
          },
        },
        address: {
          create: {
            zipcode: faker.address.zipCode(),
            street: faker.address.street(),
            city: faker.address.city(),
            neighborhood: faker.address.street(),
            state: faker.address.stateAbbr(),
            country: 'Brazil',
          },
        },
      },
    });

    // Create users and subscriptions
    console.log('Creating users and subscriptions...');
    const dbPlans = await prisma.plan.findMany();
    for (let i = 0; i < 20; ++i) {
      console.log(`Creating user ${i + 1}...`);
      const userData = await createRandomUser();
      const createdUser = await prisma.user.create({
        data: {
          provider: 'local',
          fullName: userData.fullName,
          email: userData.email,
          roleId: rs.filter((r) => r.name === 'User')[0].id,
          password: userData.password,
          gender: userData.gender,
          phone: userData.phone,
          idDocNumber: userData.idDocNumber,
          birthdate: userData.birthdate,
          company: userData.company,
          jobTitle: userData.jobTitle,
          department: userData.department,
          professionalSegment: userData.professionalSegment,
          knowledgeApp: userData.knowledgeApp,
          readTerms: userData.readTerms,
          membership: 'FREE',
          isActive: true,
          userSystemConfig: {
            create: {
              theme: faker.helpers.arrayElement(['light', 'dark']),
              accentColor: faker.helpers.arrayElement([
                'gray',
                'gold',
                'bronze',
                'brown',
                'yellow',
                'amber',
                'orange',
                'tomato',
                'red',
                'ruby',
                'crimson',
                'pink',
                'plum',
                'purple',
                'violet',
                'iris',
                'indigo',
                'blue',
                'cyan',
                'teal',
                'jade',
                'green',
                'grass',
                'lime',
                'mint',
                'sky',
              ]),
              grayColor: faker.helpers.arrayElement([
                'auto',
                'gray',
                'mauve',
                'slate',
                'sage',
                'olive',
                'sand',
              ]),
              radius: faker.helpers.arrayElement(['small', 'none', 'medium', 'large', 'full']),
              scaling: faker.helpers.arrayElement(['90%', '95%', '100%', '105%', '110%']),
              language: faker.helpers.arrayElement(['es', 'en', 'pt']),
            },
          },
          emailNotification: {
            create: {
              news: faker.helpers.arrayElement([true, false]),
              promotions: faker.helpers.arrayElement([true, false]),
              instability: faker.helpers.arrayElement([true, false]),
              security: faker.helpers.arrayElement([true, false]),
            },
          },
          address: {
            create: {
              zipcode: userData.address.zipcode,
              street: userData.address.street,
              city: userData.address.city,
              neighborhood: userData.address.neighborhood,
              state: userData.address.state,
              country: userData.address.country,
            },
          },
        },
      });

      // Assign a random plan to the user
      const randomPlan = faker.helpers.arrayElement(dbPlans);
      const subscription = await prisma.subscription.create({
        data: {
          userId: createdUser.id,
          planId: randomPlan.id,
          startSubDate: faker.date.past(),
          cancelationDate: faker.date.future(),
          status: 'ACTIVE',
        },
      });

      // Create a payment for the subscription
      await prisma.payment.create({
        data: {
          subscriptionId: subscription.id,
          amount: randomPlan.price,
          paymentDate: faker.date.recent(),
          nextPaymentDate: faker.date.recent(),
          paymentMethod: 'Credit Card',
          transactionId: faker.random.alphaNumeric(10),
          status: 'COMPLETED',
        },
      });
    }

    console.log('Seeding completed.');
  } catch (error) {
    console.error(error);
  } finally {
    // await prisma.$disconnect();
    process.exit(0);
  }
}

main();
