/**
 * Boas-vindas por cargo contra o banco: os passos do dono se marcam sozinhos
 * com os dados, a recepção só marca os próprios passos, o vínculo antigo não
 * mostra o card, "Dispensar" vale de vez, e o dono sem unidade vê "cadastre".
 */
import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { OnboardingService } from './onboarding.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('Boas-vindas por cargo (integração)', () => {
  const prisma = new PrismaService();
  const onboarding = new OnboardingService(prisma);
  const users: number[] = [];
  let shopId: number;
  let ownerId: number;
  let receptionId: number;
  let veteranId: number;
  let networkId: number;

  const roleId = async (name: string) =>
    (
      (await prisma.role.findFirst({ where: { name } })) ??
      (await prisma.role.create({ data: { name } }))
    ).id;
  const createUser = async (label: string, role: string) => {
    const id = (
      await prisma.user.create({
        data: {
          email: `onb-${label}-${RUN}@test.local`,
          password: 'x',
          fullName: `Onb ${label}`,
          idDocNumber: `${RUN}${label}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'male',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId: await roleId(role),
        },
      })
    ).id;
    users.push(id);
    return id;
  };

  beforeAll(async () => {
    ownerId = await createUser('owner', 'BarbershopOwner');
    receptionId = await createUser('recepcao', 'BarbershopEmployee');
    veteranId = await createUser('veterano', 'BarbershopEmployee');
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede Onb ${RUN}` } })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: 'Onb Barber',
          slug: `onb-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `onb-${RUN}@test.local`,
          timezone: 'America/Sao_Paulo',
          ownerUserId: ownerId,
          networkId,
        },
      })
    ).id;
    await prisma.barber.create({
      data: {
        barbershopId: shopId,
        name: 'Rita Onb',
        phone: '11911111111',
        staffType: 'reception',
        userId: receptionId,
      },
    });
    await prisma.barber.create({
      data: {
        barbershopId: shopId,
        name: 'Velho Onb',
        phone: '11922222222',
        userId: veteranId,
        createdAt: new Date(Date.now() - 40 * 86_400_000),
      },
    });
  });

  afterAll(async () => {
    await prisma.onboardingProgress.deleteMany({ where: { userId: { in: users } } });
    await prisma.barber.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershopService.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  it('dono: passos conferidos pelos dados e marcados à mão', async () => {
    const before = await onboarding.forUser(ownerId);
    expect(before).toMatchObject({ barbershopId: shopId, role: 'owner' });
    const done = (o: typeof before) => Object.fromEntries(o!.steps.map((s) => [s.id, s.done]));
    // Já tem equipe (recepção e o veterano), ainda sem serviço
    expect(done(before)).toMatchObject({ services: false, team: true, publicPage: false });

    await prisma.barbershopService.create({
      data: { barbershopId: shopId, name: 'Corte', durationMinutes: 30, price: new Decimal(40) },
    });
    await onboarding.markStep(ownerId, shopId, 'publicPage');
    expect(done(await onboarding.forUser(ownerId))).toMatchObject({
      services: true,
      publicPage: true,
    });
    // Passo automático não se marca à mão
    await expect(onboarding.markStep(ownerId, shopId, 'firstAppointment')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('recepção: os passos dela; não marca passo de outro cargo', async () => {
    const o = await onboarding.forUser(receptionId);
    expect(o?.role).toBe('reception');
    expect(o?.steps.map((s) => s.id)).toEqual(['agenda', 'newCustomer', 'cashier', 'waitlist']);
    await onboarding.markStep(receptionId, shopId, 'agenda');
    expect((await onboarding.forUser(receptionId))?.steps[0]).toMatchObject({
      id: 'agenda',
      done: true,
    });
    await expect(onboarding.markStep(receptionId, shopId, 'reports')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('quem está na unidade há mais de 30 dias não vê o card', async () => {
    expect(await onboarding.forUser(veteranId)).toBeNull();
  });

  it('"Dispensar" esconde de vez', async () => {
    await onboarding.dismiss(receptionId, shopId);
    expect(await onboarding.forUser(receptionId)).toBeNull();
  });

  it('dono sem unidade vê "cadastre seu negócio"; equipe sem unidade não vê nada', async () => {
    const newOwner = await createUser('novo', 'BarbershopOwner');
    expect(await onboarding.forUser(newOwner)).toMatchObject({
      barbershopId: null,
      role: 'newOwner',
      steps: [{ id: 'createShop', done: false }],
    });
    const loose = await createUser('solto', 'BarbershopEmployee');
    expect(await onboarding.forUser(loose)).toBeNull();
  });
});
