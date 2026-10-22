/**
 * Lista de espera online, contra o Postgres de verdade: o cliente entra pela
 * tela de agendamento (dia cheio), recebe a confirmação com o link de sair,
 * é avisado no e-mail que informou quando o horário abre, e sai pelo link.
 */
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';
import { createWaitlistLeaveToken } from './appointment-link';
import { ClosureService } from './closure.service';
import { WAITLIST_OFFER_MINUTES } from './barbershop.service';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

function mondayAhead(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7) + 7);
  return d.toISOString().slice(0, 10);
}
const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-03:00`);
const settle = () => new Promise((r) => setTimeout(r, 50));
// O aviso de horário novo roda em segundo plano: espera a entrada mudar
async function waitFor(check: () => Promise<boolean>, ms = 5000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

describe('Lista de espera online (integração)', () => {
  const prisma = new PrismaService();
  const emails: any[] = [];
  const stub = {} as never;
  const barbershops = new BarbershopService(
    prisma,
    stub,
    stub,
    { isConfigured: () => false } as never,
    stub,
    { email: async (job: any) => void emails.push(job), whatsapp: async () => undefined } as never,
    { notify: () => undefined } as never,
  );
  const monday = mondayAhead();
  const closures = new ClosureService(prisma, barbershops, {
    releaseUnpaidHold: async () => false,
  } as never);

  let ownerId: number;
  let staffUserId: number;
  let networkId: number;
  let shopId: number;
  let ana: number;
  let beto: number;
  let serviceId: number;
  let customerId: number;

  const createUser = async (label: string, roleId: number) =>
    (
      await prisma.user.create({
        data: {
          email: `wl-${label}-${RUN}@test.local`,
          isActive: true,
          password: 'x',
          fullName: `Teste ${label}`,
          idDocNumber: `${RUN}${label}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'male',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      })
    ).id;
  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = await createUser('owner', roleId);
    staffUserId = await createUser('staff', roleId);
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede WL ${RUN}` } })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: 'Barbearia Espera',
          slug: `wl-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `wl-${RUN}@test.local`,
          timezone: 'America/Sao_Paulo',
          networkId,
          ownerUserId: ownerId,
        },
      })
    ).id;
    ana = (
      await prisma.barber.create({
        data: { barbershopId: shopId, name: 'Ana', phone: '11911111111', userId: staffUserId },
      })
    ).id;
    beto = (
      await prisma.barber.create({
        data: { barbershopId: shopId, name: 'Beto', phone: '11922222222' },
      })
    ).id;
    serviceId = (
      await prisma.barbershopService.create({
        data: { barbershopId: shopId, name: 'Corte', durationMinutes: 30, price: new Decimal(50) },
      })
    ).id;
    customerId = (
      await prisma.customer.create({
        data: {
          networkId,
          name: 'Carlos Fixo',
          phone: `5${RUN.slice(-10)}`,
          email: `fixo-${RUN}@test.local`,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.waitlistEntry.deleteMany({ where: { barbershopId: shopId } });
    await prisma.walkInService.deleteMany({ where: { walkIn: { barbershopId: shopId } } });
    await prisma.walkIn.deleteMany({ where: { barbershopId: shopId } });
    await prisma.appointmentService.deleteMany({
      where: { appointment: { barbershopId: shopId } },
    });
    await prisma.appointment.deleteMany({ where: { barbershopId: shopId } });
    await prisma.customer.deleteMany({ where: { networkId } });
    await prisma.barber.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershopService.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  const join = (over: Record<string, unknown> = {}) =>
    barbershops.joinPublicWaitlist({
      barbershopId: shopId,
      barberId: ana,
      serviceIds: [serviceId],
      date: monday,
      customerName: 'Nina Espera',
      customerPhone: `5${RUN.slice(-9)}7`,
      customerEmail: `Nina-${RUN}@test.local`,
      ...over,
    });

  it('entra pelo agendamento, é avisada no e-mail informado com o link de agendar, e sai pelo link', async () => {
    const first = await join();
    expect(first.alreadyWaiting).toBe(false);
    const entry = await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: first.entryId } });
    expect(entry).toMatchObject({
      source: 'online',
      status: 'WAITING',
      barberId: ana,
      serviceId,
      contactEmail: `nina-${RUN}@test.local`,
    });
    await settle();
    const joined = emails.find((e) => e.template === 'waitlist_joined');
    expect(joined.to).toBe(`nina-${RUN}@test.local`);
    expect(joined.context.BarberName).toBe('Ana');
    expect(joined.context.LeaveUrl).toContain('/waitlist/leave?t=');

    // De novo, mesmo dia e profissional: não duplica nem manda outro e-mail
    emails.length = 0;
    expect((await join()).alreadyWaiting).toBe(true);
    await settle();
    expect(emails).toHaveLength(0);

    // Abriu um horário da Ana nesse dia: aviso no e-mail informado, com o link já no dia
    const appt = await barbershops.createAppointment(ownerId, shopId, {
      customerId,
      barberId: ana,
      startAt: at(monday, '10:00'),
      endAt: at(monday, '10:30'),
      services: [{ serviceId, unitPrice: 50 }],
    });
    emails.length = 0;
    await barbershops.updateAppointment(ownerId, shopId, appt!.id, { status: 'CANCELLED' });
    // O aviso do cancelamento sai em segundo plano
    expect(
      await waitFor(async () => emails.some((e) => e.template === 'waitlist_slot_available')),
    ).toBe(true);
    const slot = emails.find((e) => e.template === 'waitlist_slot_available');
    expect(slot.to).toBe(`nina-${RUN}@test.local`);
    expect(slot.context.BookUrl).toContain(`/u/wl-${RUN}?date=${monday}`);
    expect(slot.context.BookUrl).toContain(`services=${serviceId}`);
    expect(slot.context.BookUrl).toContain(`barber=${ana}`);
    expect(
      (await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: first.entryId } })).status,
    ).toBe('NOTIFIED');

    // Outro dia, qualquer profissional; sai pelo link do e-mail
    const other = await join({ barberId: null, date: addDays(monday, 1) });
    expect(await barbershops.leaveWaitlist(createWaitlistLeaveToken(other.entryId))).toBe(
      'Barbearia Espera',
    );
    expect(
      (await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: other.entryId } })).status,
    ).toBe('CANCELLED');
    // Clicar de novo não quebra; link adulterado não vale
    await barbershops.leaveWaitlist(createWaitlistLeaveToken(other.entryId));
    await expect(barbershops.leaveWaitlist(`${other.entryId}.x`)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      barbershops.leaveWaitlist(createWaitlistLeaveToken(first.entryId + 999_999)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('valida dia, e-mail e profissional; bloqueado não entra; no máximo 5 dias aguardando', async () => {
    await expect(join({ date: '2020-01-01' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(join({ date: addDays(monday, 90) })).rejects.toBeInstanceOf(BadRequestException);
    await expect(join({ date: 'amanhã' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(join({ customerEmail: 'sem-arroba' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(join({ barberId: 999_999_999 })).rejects.toBeInstanceOf(NotFoundException);
    await expect(join({ serviceIds: [999_999_999] })).rejects.toBeInstanceOf(NotFoundException);

    const phone = `5${RUN.slice(-9)}8`;
    for (let i = 2; i <= 6; i++) {
      await join({
        customerPhone: phone,
        customerEmail: `cota-${i}-${RUN}@test.local`,
        date: addDays(monday, i),
      });
    }
    await expect(
      join({
        customerPhone: phone,
        customerEmail: `cota-7-${RUN}@test.local`,
        date: addDays(monday, 7),
      }),
    ).rejects.toThrow('lista de espera de 5 dias');

    // O mesmo e-mail em 24 horas, trocando o telefone: no máximo 5 entradas
    const target = `alvo-${RUN}@test.local`;
    for (let i = 0; i < 5; i++) {
      await join({
        customerPhone: `5${RUN.slice(-8)}6${i}`,
        customerEmail: target,
        barberId: null,
      });
    }
    await expect(
      join({ customerPhone: `5${RUN.slice(-8)}69`, customerEmail: target, barberId: null }),
    ).rejects.toThrow('várias listas de espera hoje');

    // A ficha guarda o telefone no formato internacional (+55...)
    await prisma.customer.updateMany({
      where: { networkId, phone: { endsWith: phone } },
      data: { blockedAt: new Date(), blockedReason: 'teste' },
    });
    await expect(join({ customerPhone: phone, date: addDays(monday, 8) })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('abriu horário novo (folga desfeita, dia reaberto): avisa quem espera; mudança que não abre nada não avisa', async () => {
    const statusOf = async (id: number) =>
      (await prisma.waitlistEntry.findUniqueOrThrow({ where: { id } })).status;
    const phone = `5${RUN.slice(-9)}9`;

    // Ana de folga o dia todo: o cliente entra na lista; a folga é desfeita
    const offDay = addDays(monday, 14);
    const off = await prisma.barberTimeOff.create({
      data: {
        barberId: ana,
        startAt: at(offDay, '00:00'),
        endAt: at(addDays(offDay, 1), '00:00'),
        reason: 'PERSONAL',
      },
    });
    const waiting = await join({
      customerPhone: phone,
      customerEmail: `abre-${RUN}@test.local`,
      date: offDay,
    });
    // Um dia que já tinha horário livre, posto pela equipe
    const staffEntry = await barbershops.createWaitlistEntry(ownerId, shopId, {
      customerId,
      barberId: beto,
      date: new Date(`${addDays(monday, 15)}T00:00:00Z`),
    });

    // Mudança que não abre horário: ninguém é avisado
    emails.length = 0;
    await barbershops.withWaitlistOpening(shopId, {}, async () => undefined);
    await new Promise((r) => setTimeout(r, 400));
    expect(await statusOf(waiting.entryId)).toBe('WAITING');
    expect(await statusOf(staffEntry.id)).toBe('WAITING');

    await barbershops.deleteBarberTimeOff(ownerId, off.id);
    expect(await waitFor(async () => (await statusOf(waiting.entryId)) === 'NOTIFIED')).toBe(true);
    expect(
      await waitFor(async () => emails.some((e) => e.template === 'waitlist_slot_available')),
    ).toBe(true);
    const notice = emails.find((e) => e.template === 'waitlist_slot_available');
    expect(notice.to).toBe(`abre-${RUN}@test.local`);
    expect(notice.context.BookUrl).toContain(`date=${offDay}`);
    // O dia da equipe não mudou: continua aguardando
    expect(await statusOf(staffEntry.id)).toBe('WAITING');

    // Quem foi avisado não agendou: o horário oferecido vai pra quem entrou depois
    const offered = (
      await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: waiting.entryId } })
    ).offeredStartAt;
    expect(offered).not.toBeNull();
    const laterCustomer = await prisma.customer.create({
      data: {
        networkId,
        name: 'Depois',
        phone: `3${RUN.slice(-9)}8`,
        email: `depois-${RUN}@test.local`,
      },
    });
    const later = await barbershops.createWaitlistEntry(ownerId, shopId, {
      customerId: laterCustomer.id,
      barberId: ana,
      date: new Date(`${offDay}T00:00:00Z`),
    });
    await prisma.waitlistEntry.update({
      where: { id: waiting.entryId },
      data: { notifiedAt: new Date(Date.now() - (WAITLIST_OFFER_MINUTES + 1) * 60_000) },
    });
    expect(await barbershops.passExpiredWaitlistOffers()).toBe(1);
    expect(await statusOf(later.id)).toBe('NOTIFIED');
    expect(
      (await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: later.id } })).offeredStartAt,
    ).toEqual(offered);

    // Fechamento removido: o dia reabre e avisa quem espera nele
    const closedDay = addDays(monday, 16);
    await prisma.barbershopClosure.create({
      data: { barbershopId: shopId, date: closedDay, reason: 'Reforma' },
    });
    const onClosed = await join({
      customerPhone: phone,
      customerEmail: `abre-${RUN}@test.local`,
      date: closedDay,
      barberId: null,
    });
    emails.length = 0;
    await closures.remove(ownerId, shopId, closedDay);
    expect(await waitFor(async () => (await statusOf(onClosed.entryId)) === 'NOTIFIED')).toBe(true);
    await barbershops.cancelWaitlistEntry(ownerId, shopId, staffEntry.id);
  });
  it('avisado que não agenda no prazo: o horário livre vai pro próximo; excluir também avisa', async () => {
    const day = addDays(monday, 21);
    const date = new Date(`${day}T00:00:00Z`);
    const person = async (label: string, n: number) =>
      (
        await prisma.customer.create({
          data: {
            networkId,
            name: `Fila ${label}`,
            phone: `4${RUN.slice(-9)}${n}`,
            email: `fila-${label}-${RUN}@test.local`,
          },
        })
      ).id;
    const [first, second, third] = [
      await person('um', 1),
      await person('dois', 2),
      await person('tres', 3),
    ];
    const entry = async (customer: number) =>
      (
        await barbershops.createWaitlistEntry(ownerId, shopId, {
          customerId: customer,
          barberId: ana,
          date,
        })
      ).id;
    const e1 = await entry(first);
    const e2 = await entry(second);
    const e3 = await entry(third);
    const get = (id: number) => prisma.waitlistEntry.findUniqueOrThrow({ where: { id } });
    const expire = (id: number) =>
      prisma.waitlistEntry.update({
        where: { id },
        data: { notifiedAt: new Date(Date.now() - (WAITLIST_OFFER_MINUTES + 1) * 60_000) },
      });

    // Excluir o horário (não só cancelar) libera a vaga e avisa o primeiro
    const appt = await barbershops.createAppointment(ownerId, shopId, {
      customerId,
      barberId: ana,
      startAt: at(day, '11:00'),
      endAt: at(day, '11:30'),
      services: [{ serviceId, unitPrice: 50 }],
    });
    emails.length = 0;
    await barbershops.deleteAppointment(ownerId, shopId, appt!.id);
    expect(await waitFor(async () => (await get(e1)).status === 'NOTIFIED')).toBe(true);
    expect(await get(e1)).toMatchObject({
      offeredStartAt: at(day, '11:00'),
      offeredBarberId: ana,
      offeredServiceIds: [serviceId],
    });
    expect((await get(e2)).status).toBe('WAITING');

    // Ainda no prazo: ninguém mais é avisado
    expect(await barbershops.passExpiredWaitlistOffers()).toBe(0);
    expect((await get(e2)).status).toBe('WAITING');

    // Prazo vencido e horário livre: vai pro segundo, e só uma vez
    await expire(e1);
    emails.length = 0;
    expect(await barbershops.passExpiredWaitlistOffers()).toBe(1);
    expect((await get(e2)).status).toBe('NOTIFIED');
    expect((await get(e1)).offeredStartAt).toBeNull();
    // Quem não pegou a vaga volta a esperar os próximos horários do dia (item 224)
    expect((await get(e1)).status).toBe('WAITING');
    expect(emails.find((e) => e.template === 'waitlist_slot_available')?.to).toBe(
      `fila-dois-${RUN}@test.local`,
    );
    expect(await barbershops.passExpiredWaitlistOffers()).toBe(0);

    // O horário foi agendado: vencido o prazo do segundo, o terceiro não é avisado
    await barbershops.createAppointment(ownerId, shopId, {
      customerId: second,
      barberId: ana,
      startAt: at(day, '11:00'),
      endAt: at(day, '11:30'),
      services: [{ serviceId, unitPrice: 50 }],
    });
    await expire(e2);
    expect(await barbershops.passExpiredWaitlistOffers()).toBe(0);
    expect((await get(e3)).status).toBe('WAITING');
    expect((await get(e2)).offeredStartAt).toBeNull();
    // Outra pessoa pegou o horário: o avisado volta a esperar
    expect((await get(e2)).status).toBe('WAITING');
  });

  it('quem já foi avisado sai pelo link, a vaga passa na hora e o prazo não devolve a entrada', async () => {
    const day = addDays(monday, 35);
    const date = new Date(`${day}T00:00:00Z`);
    const person = async (label: string, n: number) =>
      (
        await prisma.customer.create({
          data: {
            networkId,
            name: `Sai ${label}`,
            phone: `6${RUN.slice(-9)}${n}`,
            email: `sai-${label}-${RUN}@test.local`,
          },
        })
      ).id;
    const [firstId, secondId] = [await person('um', 1), await person('dois', 2)];
    const entry = async (customer: number) =>
      (
        await barbershops.createWaitlistEntry(ownerId, shopId, {
          customerId: customer,
          barberId: ana,
          date,
        })
      ).id;
    const first = await entry(firstId);
    const second = await entry(secondId);
    const get = (id: number) => prisma.waitlistEntry.findUniqueOrThrow({ where: { id } });

    const appt = await barbershops.createAppointment(ownerId, shopId, {
      customerId,
      barberId: ana,
      startAt: at(day, '14:00'),
      endAt: at(day, '14:30'),
      services: [{ serviceId, unitPrice: 50 }],
    });
    await barbershops.updateAppointment(ownerId, shopId, appt!.id, { status: 'CANCELLED' });
    expect(await waitFor(async () => (await get(first)).status === 'NOTIFIED')).toBe(true);
    const offered = (await get(first)).offeredStartAt;

    expect(await barbershops.leaveWaitlist(createWaitlistLeaveToken(first))).toBe(
      'Barbearia Espera',
    );
    expect((await get(first)).status).toBe('CANCELLED');
    expect(await waitFor(async () => (await get(second)).status === 'NOTIFIED')).toBe(true);
    expect((await get(second)).offeredStartAt).toEqual(offered);

    await prisma.waitlistEntry.update({
      where: { id: second },
      data: { notifiedAt: new Date(Date.now() - (WAITLIST_OFFER_MINUTES + 1) * 60_000) },
    });
    await barbershops.passExpiredWaitlistOffers();
    expect((await get(first)).status).toBe('CANCELLED');
    expect((await get(second)).status).toBe('WAITING');
  });

  it('fecha o que ficou para trás: dia passado, quem já agendou, unidade pausada (item 185)', async () => {
    const get = (id: number) => prisma.waitlistEntry.findUniqueOrThrow({ where: { id } });
    const person = async (label: string, n: number) =>
      (
        await prisma.customer.create({
          data: {
            networkId,
            name: `Velha ${label}`,
            phone: `3${RUN.slice(-9)}${n}`,
            email: `velha-${label}-${RUN}@test.local`,
          },
        })
      ).id;
    const [old, booked] = [await person('passada', 1), await person('agendou', 2)];

    // A equipe também só põe na lista de hoje até 60 dias
    await expect(
      barbershops.createWaitlistEntry(ownerId, shopId, {
        customerId: old,
        date: new Date('2020-01-01T00:00:00Z'),
      }),
    ).rejects.toThrow('Escolha um dia entre hoje');
    await expect(
      barbershops.createWaitlistEntry(ownerId, shopId, {
        customerId: old,
        date: new Date(`${addDays(monday, 90)}T00:00:00Z`),
      }),
    ).rejects.toThrow('Escolha um dia entre hoje');

    // Dia que passou: vence; e não conta mais no limite de 5 por cliente
    const phone = `5${RUN.slice(-9)}5`;
    const first = await join({ customerPhone: phone, customerEmail: `limite-${RUN}@test.local` });
    const entry = await get(first.entryId);
    await prisma.waitlistEntry.createMany({
      data: [1, 2, 3, 4, 5].map((n) => ({
        barbershopId: shopId,
        customerId: entry.customerId,
        date: new Date(`2020-01-0${n}T00:00:00Z`),
        source: 'online',
      })),
    });
    const past = await prisma.waitlistEntry.create({
      data: { barbershopId: shopId, customerId: old, date: new Date('2020-02-01T00:00:00Z') },
    });
    await join({
      customerPhone: phone,
      customerEmail: `limite-2-${RUN}@test.local`,
      date: addDays(monday, 2),
    });

    // Quem já tem horário no dia: fecha e não é avisado de novo
    const day = addDays(monday, 28);
    const waiting = await barbershops.createWaitlistEntry(ownerId, shopId, {
      customerId: booked,
      barberId: ana,
      date: new Date(`${day}T00:00:00Z`),
    });
    await barbershops.createAppointment(ownerId, shopId, {
      customerId: booked,
      barberId: beto,
      startAt: at(day, '09:00'),
      endAt: at(day, '09:30'),
      services: [{ serviceId, unitPrice: 50 }],
    });
    const freed = await barbershops.createAppointment(ownerId, shopId, {
      customerId,
      barberId: ana,
      startAt: at(day, '15:00'),
      endAt: at(day, '15:30'),
      services: [{ serviceId, unitPrice: 50 }],
    });
    emails.length = 0;
    await barbershops.updateAppointment(ownerId, shopId, freed!.id, { status: 'CANCELLED' });
    expect(await waitFor(async () => (await get(waiting.id)).status === 'BOOKED')).toBe(true);
    expect(emails.some((e) => e.template === 'waitlist_slot_available')).toBe(false);

    const closed = await barbershops.closeStaleWaitlistEntries();
    expect(closed.expired).toBeGreaterThanOrEqual(6);
    expect((await get(past.id)).status).toBe('EXPIRED');
    expect((await get(first.entryId)).status).toBe('WAITING');

    // Unidade pausada: cancelar não avisa ninguém
    const later = addDays(monday, 29);
    const other = await barbershops.createWaitlistEntry(ownerId, shopId, {
      customerId: old,
      barberId: ana,
      date: new Date(`${later}T00:00:00Z`),
    });
    const slot = await barbershops.createAppointment(ownerId, shopId, {
      customerId,
      barberId: ana,
      startAt: at(later, '10:00'),
      endAt: at(later, '10:30'),
      services: [{ serviceId, unitPrice: 50 }],
    });
    await prisma.barbershop.update({ where: { id: shopId }, data: { isActive: false } });
    try {
      await barbershops.updateAppointment(ownerId, shopId, slot!.id, { status: 'CANCELLED' });
      await new Promise((r) => setTimeout(r, 500));
      expect((await get(other.id)).status).toBe('WAITING');
    } finally {
      await prisma.barbershop.update({ where: { id: shopId }, data: { isActive: true } });
    }
  });

  it('fila de chegada: barbeiro só na própria fila e sem o telefone escondido (item 187)', async () => {
    await expect(
      barbershops.createWalkIn(staffUserId, shopId, {
        barberId: beto,
        customerName: 'Fila do colega',
        services: [{ serviceId }],
      } as never),
    ).rejects.toThrow('sua própria fila');
    const stranger = await prisma.customer.create({
      data: { networkId, name: 'Desconhecido', phone: `2${RUN.slice(-9)}1` },
    });
    const walkIn = await barbershops.createWalkIn(ownerId, shopId, {
      barberId: ana,
      customerId: stranger.id,
      customerName: 'Desconhecido',
      customerPhone: '11977776666',
      services: [{ serviceId }],
    } as never);
    expect(walkIn.customerPhone).toBe('11977776666');
    const updated = await barbershops.updateWalkInStatus(
      staffUserId,
      shopId,
      walkIn.id,
      'IN_PROGRESS',
    );
    expect(updated.status).toBe('IN_PROGRESS');
    expect(updated.customerPhone).toBeNull();
  });
});
