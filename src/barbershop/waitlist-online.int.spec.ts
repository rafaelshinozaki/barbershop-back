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
  const closures = new ClosureService(prisma, barbershops);

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

    await prisma.customer.updateMany({
      where: { networkId, phone },
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
});
