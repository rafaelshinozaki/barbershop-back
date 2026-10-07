/**
 * Histórico de alterações contra o Postgres de verdade: o gatilho grava
 * antes → depois, o autor vem do contexto do request (escrita solta, em
 * transação interativa e em lote), sem autor vira "sistema", telefone sai
 * mascarado e observação oculta, e o dono vê a equipe da plataforma sem nome.
 */
import { ForbiddenException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { requestContext, type ChangeActor } from '../common/request-context';
import { BarbershopService } from './barbershop.service';
import { ChangeLogService } from './change-log.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('Histórico de alterações (integração)', () => {
  const prisma = new PrismaService();
  const stub = {} as never;
  const barbershops = new BarbershopService(
    prisma,
    stub,
    stub,
    { isConfigured: () => false } as never,
    stub,
    { email: async () => undefined, whatsapp: async () => undefined } as never,
    { notify: () => undefined } as never,
  );
  const changeLog = new ChangeLogService(prisma, barbershops);

  let ownerId: number;
  let strangerId: number;
  let networkId: number;
  let shopId: number;
  let serviceId: number;
  let customerId: number;
  let barberId: number;
  let anaUserId: number;
  let beto: { userId: number; barberId: number };
  let receptionUserId: number;

  const createUser = async (label: string, roleId: number) =>
    (
      await prisma.user.create({
        data: {
          email: `chl-${label}-${RUN}@test.local`,
          password: 'x',
          fullName: `Cayo ${label}`,
          idDocNumber: `${RUN}${label}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'male',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      })
    ).id;

  const as = <T>(actor: ChangeActor | undefined, fn: () => Promise<T>) =>
    requestContext.run({ requestId: `req-${RUN}`, actor }, async () => await fn());
  const owner = (): ChangeActor => ({
    type: 'user',
    id: ownerId,
    name: 'Cayo owner',
    role: 'BarbershopOwner',
    origin: 'app',
  });
  const rows = (entityType: string, entityId: number) =>
    prisma.changeLog.findMany({
      where: { entityType, entityId: String(entityId) },
      orderBy: { id: 'asc' },
    });

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = await createUser('owner', roleId);
    strangerId = await createUser('stranger', roleId);
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede Hist ${RUN}` } })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: 'Green Hist',
          slug: `chl-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `chl-${RUN}@test.local`,
          timezone: 'America/Sao_Paulo',
          networkId,
          ownerUserId: ownerId,
        },
      })
    ).id;
    serviceId = (
      await prisma.barbershopService.create({
        data: {
          barbershopId: shopId,
          name: 'Corte masculino',
          durationMinutes: 30,
          price: new Decimal(40),
        },
      })
    ).id;
    customerId = (
      await prisma.customer.create({
        data: { networkId, name: 'João Hist', phone: '11987654321' },
      })
    ).id;
    anaUserId = await createUser('ana', roleId);
    barberId = (
      await prisma.barber.create({
        data: { barbershopId: shopId, name: 'Ana Hist', phone: '11911111111', userId: anaUserId },
      })
    ).id;
    const betoUserId = await createUser('beto', roleId);
    beto = {
      userId: betoUserId,
      barberId: (
        await prisma.barber.create({
          data: {
            barbershopId: shopId,
            name: 'Beto Hist',
            phone: '11922222222',
            staffType: 'basic',
            userId: betoUserId,
          },
        })
      ).id,
    };
    receptionUserId = await createUser('recepcao', roleId);
    await prisma.barber.create({
      data: {
        barbershopId: shopId,
        name: 'Rita Hist',
        phone: '11933333333',
        staffType: 'reception',
        userId: receptionUserId,
      },
    });
  });

  afterAll(async () => {
    await prisma.changeLog.deleteMany({
      where: { OR: [{ barbershopId: shopId }, { networkId }] },
    });
    await prisma.appointment.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barberSchedule.deleteMany({ where: { barberId } });
    await prisma.barber.deleteMany({ where: { barbershopId: shopId } });
    await prisma.customer.deleteMany({ where: { networkId } });
    await prisma.barbershopService.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.user.deleteMany({
      where: { id: { in: [ownerId, strangerId, anaUserId, beto.userId, receptionUserId] } },
    });
    await prisma.changeLog.deleteMany({
      where: { OR: [{ barbershopId: shopId }, { networkId }] },
    });
    await prisma.$disconnect();
  });

  it('escrita solta com alguém logado: antes → depois e quem fez', async () => {
    await as(owner(), () =>
      prisma.barbershopService.update({
        where: { id: serviceId },
        data: { price: new Decimal(45) },
      }),
    );
    const [row] = await rows('BarbershopService', serviceId).then((r) =>
      r.filter((x) => x.action === 'update'),
    );
    expect(row).toMatchObject({
      barbershopId: shopId,
      networkId,
      entityName: 'Corte masculino',
      actorType: 'user',
      actorId: ownerId,
      actorName: 'Cayo owner',
      actorRole: 'BarbershopOwner',
      origin: 'app',
      requestId: `req-${RUN}`,
    });
    expect(row.changes).toEqual({ price: [40, 45] });
  });

  it('transação interativa: telefone mascarado, observação oculta', async () => {
    await as(owner(), () =>
      prisma.$transaction(async (tx) => {
        await tx.customer.update({
          where: { id: customerId },
          data: { phone: '11900001234', notes: 'alergia a lâmina' },
        });
      }),
    );
    const updates = (await rows('Customer', customerId)).filter((r) => r.action === 'update');
    expect(updates.at(-1)).toMatchObject({
      networkId,
      barbershopId: null,
      actorName: 'Cayo owner',
    });
    expect(updates.at(-1)?.changes).toEqual({
      phone: ['••••4321', '••••1234'],
      notes: [null, '•••'],
    });
    expect(JSON.stringify(updates)).not.toContain('lâmina');
  });

  it('transação em lote devolve só os resultados da aplicação', async () => {
    const [service, count] = (await as(owner(), () =>
      prisma.$transaction([
        prisma.barbershopService.update({
          where: { id: serviceId },
          data: { durationMinutes: 40 },
        }),
        prisma.barbershopService.count({ where: { barbershopId: shopId } }),
      ]),
    )) as [{ durationMinutes: number }, number];
    expect(service.durationMinutes).toBe(40);
    expect(count).toBe(1);
    const last = (await rows('BarbershopService', serviceId)).at(-1);
    expect(last).toMatchObject({ actorName: 'Cayo owner', changes: { durationMinutes: [30, 40] } });
  });

  it('sem ninguém logado (job, script) fica como sistema; campo não acompanhado não grava', async () => {
    await prisma.barbershopService.update({ where: { id: serviceId }, data: { isActive: false } });
    await prisma.barbershopService.update({ where: { id: serviceId }, data: { displayOrder: 7 } });
    const updates = (await rows('BarbershopService', serviceId)).filter(
      (r) => r.action === 'update',
    );
    expect(updates.at(-1)).toMatchObject({
      actorType: 'system',
      actorId: null,
      origin: 'system',
      changes: { isActive: [true, false] },
    });
    expect(updates).toHaveLength(3);
  });

  it('escala: a linha leva a unidade e o nome do profissional', async () => {
    await as(owner(), () =>
      prisma.barberSchedule.create({
        data: { barberId, dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
      }),
    );
    const found = await prisma.changeLog.findFirst({
      where: { entityType: 'BarberSchedule', barbershopId: shopId },
      orderBy: { id: 'desc' },
    });
    expect(found).toMatchObject({
      action: 'create',
      entityName: 'Ana Hist',
      actorName: 'Cayo owner',
    });
  });

  it('o dono vê a lista; a equipe da plataforma aparece sem nome, com o motivo', async () => {
    await as(
      {
        type: 'staff',
        id: 999,
        name: 'Funcionário X',
        role: 'SystemManager',
        origin: 'backoffice',
        reason: 'pedido do dono',
      },
      () =>
        prisma.barbershop.update({
          where: { id: shopId },
          data: { description: 'Nova descrição' },
        }),
    );
    const page = await changeLog.list(ownerId, shopId, {});
    expect(page.total).toBeGreaterThanOrEqual(5);
    const platform = page.items.find((i) => i.entityType === 'Barbershop');
    expect(platform).toMatchObject({
      actorKind: 'platform',
      actorName: null,
      actorId: null,
      reason: 'pedido do dono',
      entityName: 'Green Hist',
      changes: [{ field: 'description', before: null, after: 'Nova descrição' }],
    });
    // Cliente é da rede: entra no histórico da unidade
    expect(page.items.some((i) => i.entityType === 'Customer')).toBe(true);
    expect(JSON.stringify(page)).not.toContain('Funcionário X');

    const onlyServices = await changeLog.list(ownerId, shopId, { entityType: 'BarbershopService' });
    expect(onlyServices.items.every((i) => i.entityType === 'BarbershopService')).toBe(true);
    const byOwner = await changeLog.list(ownerId, shopId, { actorId: ownerId });
    expect(byOwner.items.every((i) => i.actorId === ownerId)).toBe(true);
    const byOwnerKind = await changeLog.list(ownerId, shopId, {
      actorId: ownerId,
      actorKind: 'user',
    });
    expect(byOwnerKind.total).toBe(byOwner.total);
    expect(
      (await changeLog.list(ownerId, shopId, { actorId: ownerId, actorKind: 'client' })).total,
    ).toBe(0);
    expect(await changeLog.actors(ownerId, shopId)).toEqual([
      { id: ownerId, name: 'Cayo owner', kind: 'user' },
    ]);
  });

  it('o profissional vê só a própria agenda; agendamento passado adiante aparece para os dois', async () => {
    const appointment = await as(owner(), () =>
      prisma.appointment.create({
        data: {
          barbershopId: shopId,
          customerId,
          barberId,
          startAt: new Date('2030-01-07T12:00:00Z'),
          endAt: new Date('2030-01-07T12:30:00Z'),
        },
      }),
    );
    await as(owner(), () =>
      prisma.appointment.update({
        where: { id: appointment.id },
        data: { barberId: beto.barberId },
      }),
    );
    const lines = await rows('Appointment', appointment.id);
    expect(lines.map((l) => l.barberIds)).toEqual([
      [barberId],
      [barberId, beto.barberId].sort((a, b) => a - b),
    ]);

    // Ana (barbeiro): o agendamento criado e passado adiante, a escala e o
    // próprio cadastro; nada de serviço, cliente ou da unidade
    const ana = await changeLog.list(anaUserId, shopId, { limit: 100 });
    const anaTypes = new Set(ana.items.map((i) => i.entityType));
    expect([...anaTypes].sort()).toEqual(['Appointment', 'Barber', 'BarberSchedule']);
    expect(ana.items.filter((i) => i.entityType === 'Appointment')).toHaveLength(2);
    expect(
      ana.items.some((i) => i.entityType === 'Barber' && i.entityId === String(beto.barberId)),
    ).toBe(false);
    expect(await changeLog.actors(anaUserId, shopId)).toEqual([
      { id: ownerId, name: 'Cayo owner', kind: 'user' },
    ]);

    // Beto (básico): só a passagem do agendamento pra ele e o próprio cadastro
    const betoPage = await changeLog.list(beto.userId, shopId, {});
    expect(betoPage.items.map((i) => `${i.entityType}:${i.action}`).sort()).toEqual([
      'Appointment:update',
      'Barber:create',
    ]);
    const moved = betoPage.items.find((i) => i.entityType === 'Appointment');
    expect(moved?.changes).toEqual([{ field: 'barberId', before: 'Ana Hist', after: 'Beto Hist' }]);
    // O filtro por tipo não abre o que está fora da agenda dele
    expect((await changeLog.list(beto.userId, shopId, { entityType: 'Customer' })).total).toBe(0);
  });

  it('a recepção não lê o histórico', async () => {
    await expect(changeLog.list(receptionUserId, shopId, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('quem não é da unidade não lê o histórico', async () => {
    await expect(changeLog.list(strangerId, shopId, {})).rejects.toBeInstanceOf(ForbiddenException);
  });
});
