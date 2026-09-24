/**
 * Calendário, contra o Postgres de verdade: .ics do agendamento pelo link
 * assinado (cliente) e a agenda assinável da equipe (quem vê o quê, troca de
 * link, acesso conferido a cada leitura).
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from '../barbershop/barbershop.service';
import { createAppointmentToken } from '../barbershop/appointment-link';
import { CalendarService } from './calendar.service';
import { appointmentCalendarLinks } from './calendar-links';
import { buildCalendar } from './ics';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const inDays = (d: number, hh = 10) => {
  const x = new Date(Date.now() + d * 86_400_000);
  x.setUTCHours(hh + 3, 0, 0, 0);
  return x;
};
const unfold = (ics: string) => ics.replace(/\r\n /g, '');

describe('Calendário (integração)', () => {
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
  const calendar = new CalendarService(prisma, barbershops);

  let ownerId: number;
  let anaUserId: number;
  let networkId: number;
  let shopId: number;
  let ana: number;
  let beto: number;
  let customerId: number;
  let serviceId: number;
  const appts: Record<string, number> = {};

  const createUser = async (label: string, roleId: number) =>
    (
      await prisma.user.create({
        data: {
          email: `cal-${label}-${RUN}@test.local`,
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
  const appointment = async (barberId: number, day: number, status = 'CONFIRMED') =>
    (
      await prisma.appointment.create({
        data: {
          barbershopId: shopId,
          customerId,
          barberId,
          startAt: inDays(day),
          endAt: new Date(inDays(day).getTime() + 30 * 60000),
          status,
          notes: 'Degradê, sem máquina 0; traz foto',
          services: { create: [{ serviceId, unitPrice: new Decimal(50) }] },
        },
      })
    ).id;

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = await createUser('owner', roleId);
    anaUserId = await createUser('ana', roleId);
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede Cal ${RUN}` } })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: 'Barbearia Agenda',
          slug: `cal-${RUN}`,
          address: 'Rua das Flores, 10',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `cal-${RUN}@test.local`,
          timezone: 'America/Sao_Paulo',
          networkId,
          ownerUserId: ownerId,
        },
      })
    ).id;
    ana = (
      await prisma.barber.create({
        data: {
          barbershopId: shopId,
          userId: anaUserId,
          name: 'Ana',
          phone: '11911111111',
          staffType: 'barber',
        },
      })
    ).id;
    beto = (
      await prisma.barber.create({
        data: { barbershopId: shopId, name: 'Beto', phone: '11922222222' },
      })
    ).id;
    customerId = (
      await prisma.customer.create({
        data: { networkId, name: 'Carlos Cliente', phone: '11987654321' },
      })
    ).id;
    serviceId = (
      await prisma.barbershopService.create({
        data: { barbershopId: shopId, name: 'Corte', durationMinutes: 30, price: new Decimal(50) },
      })
    ).id;
    appts.anaNext = await appointment(ana, 3);
    appts.anaCancelled = await appointment(ana, 4, 'CANCELLED');
    appts.betoNext = await appointment(beto, 5);
  });

  afterAll(async () => {
    await prisma.calendarFeed.deleteMany({ where: { barbershopId: shopId } });
    await prisma.appointmentService.deleteMany({
      where: { appointment: { barbershopId: shopId } },
    });
    await prisma.appointment.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barber.deleteMany({ where: { barbershopId: shopId } });
    await prisma.customer.deleteMany({ where: { networkId } });
    await prisma.barbershopService.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  it('formato: texto escapado, linhas de até 75 bytes, CRLF', () => {
    const ics = buildCalendar([
      {
        uid: 'x@y',
        start: new Date('2026-10-01T13:00:00Z'),
        end: new Date('2026-10-01T13:30:00Z'),
        summary: 'Corte, barba; e "acabamento"',
        description: `Linha 1\nLinha 2 ${'ç'.repeat(80)}`,
      },
    ]);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    const flat = unfold(ics);
    expect(flat).toContain('SUMMARY:Corte\\, barba\\; e "acabamento"');
    expect(flat).toContain('DESCRIPTION:Linha 1\\nLinha 2 ');
    expect(flat).toContain('DTSTART:20261001T130000Z');
  });

  it('cliente: .ics pelo link assinado; cancelado sai como cancelamento; link adulterado não', async () => {
    const ics = unfold(await calendar.appointmentIcs(createAppointmentToken(appts.anaNext)));
    expect(ics).toContain(`UID:appointment-${appts.anaNext}@barbershop`);
    expect(ics).toContain('SUMMARY:Corte — Barbearia Agenda');
    expect(ics).toContain('LOCATION:Barbearia Agenda\\, Rua das Flores\\, 10\\, SP - SP');
    expect(ics).toContain('STATUS:CONFIRMED');
    expect(ics).toContain('/booking/manage?t=');

    const cancelled = unfold(
      await calendar.appointmentIcs(createAppointmentToken(appts.anaCancelled)),
    );
    expect(cancelled).toContain('METHOD:CANCEL');
    expect(cancelled).toContain('STATUS:CANCELLED');

    const [, sig] = createAppointmentToken(appts.anaNext).split('.');
    await expect(calendar.appointmentIcs(`${appts.betoNext}.${sig}`)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('links do e-mail: Google, Outlook e .ics (com a URL pública da API)', async () => {
    const appt = await prisma.appointment.findUniqueOrThrow({
      where: { id: appts.anaNext },
      include: {
        barbershop: true,
        barber: true,
        services: { include: { service: true } },
      },
    });
    const before = process.env.PUBLIC_API_URL;
    process.env.PUBLIC_API_URL = 'https://api.test/';
    try {
      const links = appointmentCalendarLinks(appt, 'tok.en');
      expect(links.GoogleCalendarURL).toMatch(
        /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/,
      );
      expect(links.GoogleCalendarURL).toContain('dates=');
      expect(links.OutlookCalendarURL).toMatch(/^https:\/\/outlook\.live\.com\//);
      expect(links.IcsURL).toBe('https://api.test/calendar/appointment.ics?t=tok.en');
      delete process.env.PUBLIC_API_URL;
      expect(appointmentCalendarLinks(appt, 'x').IcsURL).toBeNull();
    } finally {
      if (before) process.env.PUBLIC_API_URL = before;
    }
  });

  it('equipe: barbeira assina a própria agenda (sem contato do cliente); a da unidade não', async () => {
    await expect(calendar.createFeed(anaUserId, shopId, 'ALL')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const { path } = await calendar.createFeed(anaUserId, shopId, 'MINE');
    const token = path.match(/\/calendar\/feed\/(.+)\.ics$/)![1];
    // No banco só o hash
    const stored = await prisma.calendarFeed.findFirstOrThrow({ where: { userId: anaUserId } });
    expect(stored.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));

    const ics = unfold(await calendar.feedIcs(token));
    expect(ics).toContain('X-WR-CALNAME:Barbearia Agenda — minha agenda');
    expect(ics).toContain(`UID:appointment-${appts.anaNext}@barbershop`);
    expect(ics).not.toContain(`appointment-${appts.betoNext}@`); // do colega não
    expect(ics).not.toContain(`appointment-${appts.anaCancelled}@`); // cancelado some
    expect(ics).toContain('SUMMARY:Carlos Cliente — Corte');
    expect(ics).not.toContain('11987654321');
    expect(await calendar.listFeeds(anaUserId, shopId)).toEqual([
      expect.objectContaining({ scope: 'MINE', lastAccessAt: expect.any(Date) }),
    ]);

    // Trocou o link: o antigo para de funcionar
    const { path: path2 } = await calendar.createFeed(anaUserId, shopId, 'MINE');
    await expect(calendar.feedIcs(token)).rejects.toBeInstanceOf(NotFoundException);
    const token2 = path2.match(/\/calendar\/feed\/(.+)\.ics$/)![1];
    await calendar.feedIcs(token2);

    // Saiu da equipe: a agenda para de responder na hora
    await prisma.barber.update({ where: { id: ana }, data: { isActive: false } });
    await expect(calendar.feedIcs(token2)).rejects.toBeInstanceOf(NotFoundException);
    await prisma.barber.update({ where: { id: ana }, data: { isActive: true } });
  });

  it('dono: agenda da unidade inteira, com profissional e telefone', async () => {
    // Dono sem perfil de profissional não tem "minha agenda"
    await expect(calendar.createFeed(ownerId, shopId, 'MINE')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const { path } = await calendar.createFeed(ownerId, shopId, 'ALL');
    const ics = unfold(await calendar.feedIcs(path.match(/feed\/(.+)\.ics$/)![1]));
    expect(ics).toContain('X-WR-CALNAME:Barbearia Agenda');
    expect(ics).toContain(`appointment-${appts.anaNext}@`);
    expect(ics).toContain(`appointment-${appts.betoNext}@`);
    expect(ics).toContain('SUMMARY:Carlos Cliente — Beto');
    expect(ics).toContain('Telefone: 11987654321');
    expect(ics).toContain('Obs.: Degradê\\, sem máquina 0\\; traz foto');

    await calendar.deleteFeed(ownerId, shopId, 'ALL');
    await expect(calendar.feedIcs(path.match(/feed\/(.+)\.ics$/)![1])).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(calendar.feedIcs('qualquer-coisa')).rejects.toBeInstanceOf(NotFoundException);
  });
});
