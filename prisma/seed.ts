import { PrismaClient } from '@prisma/client';
import { Sex, faker } from '@faker-js/faker';
import * as bcrypt from 'bcryptjs';
import { BR_LOCATIONS, cpf, seedDemoData } from './seed-demo';

const prisma = new PrismaClient();

const roles = [
  'SystemManager',
  'SystemAdmin',
  'BarbershopOwner',
  'BarbershopManager',
  'BarbershopEmployee',
];

const plans = [
  {
    name: 'Basic',
    description: 'Ideal pra quem está começando',
    price: 9.99,
    billingCycle: 'MONTHLY',
    features:
      'Cadastro de clientes, Fila de espera, Agenda de atendimentos, Até 3 barbeiros, 1 barbearia',
  },
  {
    name: 'Basic',
    description: 'Ideal pra quem está começando',
    price: 99.99,
    billingCycle: 'YEARLY',
    features:
      'Cadastro de clientes, Fila de espera, Agenda de atendimentos, Até 3 barbeiros, 1 barbearia',
  },
  {
    name: 'Standard',
    description: 'Pra quem já vende produtos e controla estoque',
    price: 19.99,
    billingCycle: 'MONTHLY',
    features:
      'Tudo do Basic, Catálogo de produtos, Controle de estoque, Até 10 barbeiros, Até 3 barbearias',
  },
  {
    name: 'Standard',
    description: 'Pra quem já vende produtos e controla estoque',
    price: 189.99,
    billingCycle: 'YEARLY',
    features:
      'Tudo do Basic, Catálogo de produtos, Controle de estoque, Até 10 barbeiros, Até 3 barbearias',
  },
  {
    name: 'Premium',
    description: 'Rede completa, com gestão financeira e fidelização',
    price: 29.99,
    billingCycle: 'MONTHLY',
    features:
      'Tudo do Standard, Fluxo de caixa, Relatórios avançados, Pacotes de sessão e ficha de anamnese, Assinatura recorrente do cliente, Barbeiros e barbearias ilimitados',
  },
  {
    name: 'Premium',
    description: 'Rede completa, com gestão financeira e fidelização',
    price: 284.99,
    billingCycle: 'YEARLY',
    features:
      'Tudo do Standard, Fluxo de caixa, Relatórios avançados, Pacotes de sessão e ficha de anamnese, Assinatura recorrente do cliente, Barbeiros e barbearias ilimitados',
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
    email: faker.internet.email(firstName, lastName, 'barbershop.com'),
    provider: 'local',
    phone: faker.phone.number('+55129########'),
    gender: faker.helpers.arrayElement([Sex.Male, Sex.Female]),
    birthdate: faker.date.birthdate(),
    idDocNumber: cpf(faker.phone.number('#########')),
    password: await bcrypt.hash('pwned', 10),
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
    // Endereço com códigos ISO/cidade reais — o front casa País/Estado/Cidade
    // pelos dados do country-state-city ("BR", "SP", "São Paulo").
    address: (() => {
      const loc = faker.helpers.arrayElement(BR_LOCATIONS);
      return {
        zipcode: loc.zipcode,
        street: `Rua ${faker.name.lastName()}, ${faker.datatype.number({ min: 10, max: 2000 })}`,
        city: loc.city,
        neighborhood: loc.neighborhood,
        state: loc.state,
        country: 'BR',
        complement1: faker.helpers.maybe(
          () => `Apto ${faker.datatype.number({ min: 11, max: 204 })}`,
          { probability: 0.4 },
        ),
        complement2: undefined as string | undefined,
      };
    })(),
    notificationPreference: {
      newsEmail: faker.helpers.arrayElement([true, false]),
      newsInApp: faker.helpers.arrayElement([true, false]),
      promotionsEmail: faker.helpers.arrayElement([true, false]),
      promotionsInApp: faker.helpers.arrayElement([true, false]),
      instabilityEmail: faker.helpers.arrayElement([true, false]),
      instabilityInApp: faker.helpers.arrayElement([true, false]),
      securityEmail: faker.helpers.arrayElement([true, false]),
      securityInApp: faker.helpers.arrayElement([true, false]),
    },
  };
}

// SEED_RESET=true reproduces the old behavior (wipe everything, then recreate
// from scratch with fresh random data) - only ever intended for a disposable
// local/dev database. Without it, the script is idempotent: it only creates
// what's missing and never touches or deletes existing rows, so it's safe to
// run repeatedly (e.g. on every deploy) against a database that already has
// real data.
const RESET_DB = process.env.SEED_RESET === 'true';

async function main() {
  try {
    console.log(`Starting seed script (SEED_RESET=${RESET_DB})...`);

    if (RESET_DB) {
      // Apaga todas as tabelas (menos o histórico de migrations) de uma vez —
      // a lista manual antiga ficava desatualizada a cada model novo e
      // quebrava por FK.
      console.log('Cleaning database...');
      const tables = await prisma.$queryRaw<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
      const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    }

    // Create plans (find-or-create: Plan has no unique constraint to upsert on)
    console.log('Creating plans...');
    for (const plan of plans) {
      const existing = await prisma.plan.findFirst({
        where: { name: plan.name, billingCycle: plan.billingCycle },
      });
      if (!existing) {
        await prisma.plan.create({ data: plan });
      }
    }

    // Create roles (find-or-create: Role.name has no unique constraint to upsert on)
    const rs: { id: number; name: string }[] = [];
    console.log('Creating roles...');
    for (const role of roles) {
      let r = await prisma.role.findFirst({ where: { name: role } });
      if (!r) {
        r = await prisma.role.create({ data: { name: role } });
      }
      rs.push(r);
    }

    // Create seed users with specific roles
    const seedUsers = [
      {
        email: 'rafael.sinosaki@barbershop.com',
        fullName: 'Rafael Sinosaki',
        role: 'SystemAdmin',
      },
      {
        email: 'jacqueline.mariane@barbershop.com',
        fullName: 'Jacqueline Mariane',
        role: 'SystemManager',
      },
      {
        email: 'cayo.carlos@barbershop.com',
        fullName: 'Cayo Carlos',
        role: 'BarbershopOwner',
      },
      {
        email: 'bianca.silverio@barbershop.com',
        fullName: 'Bianca Silverio',
        role: 'BarbershopManager',
      },
      {
        email: 'minion.cayo@barbershop.com',
        fullName: 'Minion Cayo',
        role: 'BarbershopEmployee',
      },
    ];

    const sharedUserData = {
      provider: 'local' as const,
      password: bcrypt.hashSync('pwned', 10),
      phone: faker.phone.number('+55129########'),
      gender: faker.helpers.arrayElement([Sex.Male, Sex.Female]),
      birthdate: faker.date.birthdate(),
      idDocNumber: Math.floor(10000000000 + Math.random() * 90000000000).toString(),
      readTerms: true,
      isActive: true,
      userSystemConfig: { create: userSystemConfig.create },
      notificationPreference: {
        create: {
          newsEmail: faker.helpers.arrayElement([true, false]),
          newsInApp: faker.helpers.arrayElement([true, false]),
          promotionsEmail: faker.helpers.arrayElement([true, false]),
          promotionsInApp: faker.helpers.arrayElement([true, false]),
          instabilityEmail: faker.helpers.arrayElement([true, false]),
          instabilityInApp: faker.helpers.arrayElement([true, false]),
          securityEmail: faker.helpers.arrayElement([true, false]),
          securityInApp: faker.helpers.arrayElement([true, false]),
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
          complement1: faker.address.secondaryAddress(),
          complement2: faker.helpers.maybe(() => 'Próximo ao mercado', { probability: 0.3 }),
        },
      },
    };

    const createdSeedUsers: { email: string; id: number }[] = [];
    for (const u of seedUsers) {
      const existing = await prisma.user.findUnique({
        where: { email_provider: { email: u.email, provider: 'local' } },
      });
      if (existing) {
        console.log(`${u.fullName} (${u.role}) already exists, skipping...`);
        createdSeedUsers.push({ email: u.email, id: existing.id });
        continue;
      }
      console.log(`Creating ${u.fullName} (${u.role})...`);
      const user = await prisma.user.create({
        data: {
          ...sharedUserData,
          email: u.email,
          fullName: u.fullName,
          roleId: rs.find((r) => r.name === u.role)!.id,
        },
      });
      createdSeedUsers.push({ email: u.email, id: user.id });
    }

    // Create Network, Barbershop and link Bianca as manager for Cayo's barbershop
    // (skipped entirely if the barbershop already exists, since its slug is unique)
    const cayo = createdSeedUsers.find((u) => u.email === 'cayo.carlos@barbershop.com');
    const bianca = createdSeedUsers.find((u) => u.email === 'bianca.silverio@barbershop.com');
    const existingBarbershop = await prisma.barbershop.findUnique({
      where: { slug: 'green-barbershop' },
    });
    if (cayo && bianca && !existingBarbershop) {
      console.log('Creating Green Barbershop (Cayo owns, Bianca is manager)...');
      const network = await prisma.network.create({
        data: { ownerUserId: cayo.id },
      });
      const barbershop = await prisma.barbershop.create({
        data: {
          name: 'Green Barbershop',
          slug: 'green-barbershop',
          address: 'Rua Raimundo Barbosa Nogueira',
          complement1: 'Sala 2',
          complement2: 'Próximo ao shopping',
          city: 'São José dos Campos',
          state: 'SP',
          country: 'BR',
          postalCode: '12245-000',
          phone: '(12) 99757-2011',
          email: 'rafaelsinosak@barbershop.com',
          networkId: network.id,
          ownerUserId: cayo.id,
        },
      });
      await prisma.barber.create({
        data: {
          barbershopId: barbershop.id,
          userId: cayo.id,
          staffType: 'barber',
          name: 'Cayo Carlos',
          phone: '(12) 99757-2011',
          email: 'cayo.carlos@barbershop.com',
          specialization: 'Proprietário',
          isActive: true,
        },
      });
      await prisma.barber.create({
        data: {
          barbershopId: barbershop.id,
          userId: bianca.id,
          staffType: 'manager',
          name: 'Bianca Silverio',
          phone: faker.phone.number('(12) 9####-####'),
          email: 'bianca.silverio@barbershop.com',
          isActive: true,
        },
      });
      const minion = createdSeedUsers.find((u) => u.email === 'minion.cayo@barbershop.com');
      if (minion) {
        await prisma.barber.create({
          data: {
            barbershopId: barbershop.id,
            userId: minion.id,
            staffType: 'barber',
            name: 'Minion Cayo',
            phone: faker.phone.number('(12) 9####-####'),
            email: 'minion.cayo@barbershop.com',
            specialization: 'Corte masculino',
            isActive: true,
          },
        });
      }
      await prisma.customer.create({
        data: {
          networkId: network.id,
          name: 'João Silva',
          phone: '(12) 98765-4321',
          email: 'joao.silva@email.com',
          isActive: true,
        },
      });
      await prisma.barbershopService.create({
        data: {
          barbershopId: barbershop.id,
          name: 'Corte masculino',
          icon: '✂️',
          category: 'HAIR',
          durationMinutes: 30,
          price: 35,
          isActive: true,
        },
      });
      console.log(`  Barbershop ID: ${barbershop.id} - acesse /barbershops/${barbershop.id}/appointments`);
    } else if (existingBarbershop) {
      console.log('Green Barbershop already exists, skipping...');
    }

    await seedDemoData(prisma);

    if (!RESET_DB) {
      console.log('Seeding completed (SEED_RESET not set - skipped random demo users).');
      return;
    }

    // Create users and subscriptions
    // Random fake data - only meaningful with a fresh database (SEED_RESET=true),
    // since each run generates new random users rather than reusing existing ones.
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
          roleId: rs.filter((r) => r.name === (['BarbershopOwner', 'BarbershopManager', 'BarbershopEmployee'][i % 3]))[0].id,
          password: userData.password,
          gender: userData.gender,
          phone: userData.phone,
          idDocNumber: userData.idDocNumber,
          birthdate: userData.birthdate,
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
          notificationPreference: {
            create: {
              newsEmail: faker.helpers.arrayElement([true, false]),
              newsInApp: faker.helpers.arrayElement([true, false]),
              promotionsEmail: faker.helpers.arrayElement([true, false]),
              promotionsInApp: faker.helpers.arrayElement([true, false]),
              instabilityEmail: faker.helpers.arrayElement([true, false]),
              instabilityInApp: faker.helpers.arrayElement([true, false]),
              securityEmail: faker.helpers.arrayElement([true, false]),
              securityInApp: faker.helpers.arrayElement([true, false]),
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
              complement1: userData.address.complement1,
              complement2: userData.address.complement2,
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
