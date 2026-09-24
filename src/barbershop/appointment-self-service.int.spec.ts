/**
 * Cliente cancela ou remarca o próprio horário pelo link do e-mail (como no
 * Booksy), contra o Postgres de verdade: confirmação com o link, prazo da
 * política de cancelamento, link adulterado, conflito de horário e
 * lembrete de novo depois de remarcar.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';
import { createAppointmentToken } from './appointment-link';

// O link é assinado com o segredo do servidor; o job de testes do CI não tem .env
process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

// Uma semana pra frente: longe da janela de 24h da política
const DAY = (() => {
  const d = new Date(Date.now() + 7 * 86400_000);
  return d.toISOString().slice(0, 10);
})();
const DOW = new Date(`${DAY}T12:00:00Z`).getUTCDay();
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00-03:00`).toISOString();

describe('Cliente gerencia o horário pelo link do e-mail (integração)', () => {
  const prisma = new PrismaService();
  const stub = {} as never;
  const emails: Array<{ template: string; to: string; context: any }> = [];
  const service = new BarbershopService(
    prisma,
    stub,
    stub,
    { isConfigured: () => false } as never,
    stub,
    {
      email: async (job: { template: string; to: string; context: any }) => void emails.push(job),
      whatsapp: async () => undefined,
    } as never,
    { notify: () => undefined } as never,
  );
  const waitForEmail = async (template: string) => {
    for (let i = 0; i < 50; i++) {
      const found = emails.find((e) => e.template === template);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`e-mail ${template} não saiu`);
  };

  let ownerId: number;
  let networkId: number;
  let shopId: number;
  let barberId: number;
  let serviceId: number;

  const book = (hhmm: string, phone: string) =>
    service.createPublicAppointment({
      barbershopId: shopId,
      barberId,
      serviceId,
      startAt: at(hhmm),
      customerName: 'Cliente Link',
      customerPhone: phone,
      customerEmail: `cliente-${phone}@test.local`,
    });

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = (
      await prisma.user.create({
        data: {
          email: `self-owner-${RUN}@test.local`,
          password: 'x',
          fullName: 'Dono Link',
          idDocNumber: `self${RUN}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'male',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      })
    ).id;
    networkId = (
      await prisma.network.create({
        data: { ownerUserId: ownerId, name: `Rede Link ${RUN}`, lateCancellationWindowHours: 24 },
      })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: 'Barbearia Link',
          slug: `link-${RUN}`,
          address: 'Rua 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `link-${RUN}@test.local`,
          timezone: 'America/Sao_Paulo',
          networkId,
          ownerUserId: ownerId,
        },
      })
    ).id;
    barberId = (
      await prisma.barber.create({
        data: { barbershopId: shopId, name: 'Barbeiro Link', phone: '11988887777' },
      })
    ).id;
    await prisma.barberSchedule.create({
      data: { barberId, dayOfWeek: DOW, startTime: '09:00', endTime: '18:00', isActive: true },
    });
    serviceId = (
      await prisma.barbershopService.create({
        data: { barbershopId: shopId, name: 'Corte', durationMinutes: 30, price: new Decimal(50) },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.appointmentService.deleteMany({
      where: { appointment: { barbershopId: shopId } },
    });
    await prisma.appointment.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barberSchedule.deleteMany({ where: { barberId } });
    await prisma.barber.deleteMany({ where: { barbershopId: shopId } });
    await prisma.customer.deleteMany({ where: { networkId } });
    await prisma.clientAccount.deleteMany({ where: { email: { endsWith: `-${RUN}@test.local` } } });
    await prisma.barbershopService.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE id = ${ownerId}`;
    await prisma.$disconnect();
  });

  it('agendar pela página pública manda a confirmação com o link; o link abre o horário', async () => {
    const appt = await book('10:00', `11${RUN}1`.slice(0, 14));
    const email = await waitForEmail('appointment_confirmation');
    expect(email.to).toBe(`cliente-${`11${RUN}1`.slice(0, 14)}@test.local`);
    expect(email.context.CancellationWindowHours).toBe(24);
    const token = decodeURIComponent(email.context.ManageURL.split('/booking/manage?t=')[1]);
    expect(token).toBe(createAppointmentToken(appt!.id));

    const managed = await service.getManagedAppointment(token);
    expect(managed).toMatchObject({
      id: appt!.id,
      status: 'CONFIRMED',
      canChange: true,
      barberName: 'Barbeiro Link',
      serviceName: 'Corte',
      cancellationWindowHours: 24,
    });
  });

  it('link adulterado ou de outro agendamento não abre nada', async () => {
    const appt = await book('11:00', `11${RUN}2`.slice(0, 14));
    const [, signature] = createAppointmentToken(appt!.id).split('.');
    // Mesma assinatura com outro id
    await expect(
      service.getManagedAppointment(`${appt!.id + 1}.${signature}`),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getManagedAppointment('qualquer-coisa')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.cancelManagedAppointment(`${appt!.id}.${'x'.repeat(32)}`),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('remarca pra um horário livre, sai de novo o lembrete e o antigo fica livre', async () => {
    const appt = await book('12:00', `11${RUN}3`.slice(0, 14));
    const token = createAppointmentToken(appt!.id);
    await prisma.appointment.update({
      where: { id: appt!.id },
      data: { reminderSentAt: new Date() },
    });
    // Ocupado por outro cliente: não deixa
    await book('14:00', `11${RUN}4`.slice(0, 14));
    await expect(service.rescheduleManagedAppointment(token, at('14:00'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // Fora do expediente: não deixa
    await expect(service.rescheduleManagedAppointment(token, at('19:00'))).rejects.toBeInstanceOf(
      BadRequestException,
    );

    await service.rescheduleManagedAppointment(token, at('15:00'));
    const moved = await prisma.appointment.findUniqueOrThrow({ where: { id: appt!.id } });
    expect(moved.startAt.toISOString()).toBe(at('15:00'));
    expect(moved.endAt.getTime() - moved.startAt.getTime()).toBe(30 * 60000);
    expect(moved.reminderSentAt).toBeNull();
    expect((await waitForEmail('appointment_rescheduled')).context.ManageURL).toContain(
      encodeURIComponent(token),
    );
    // O horário antigo voltou pra lista
    const slots = await service.getPublicAvailableSlots(shopId, barberId, serviceId, DAY);
    expect(slots).toContain(at('12:00'));
    expect(slots).not.toContain(at('15:00'));
  });

  it('cancela pelo link; cancelado não cancela de novo nem remarca', async () => {
    const appt = await book('16:00', `11${RUN}5`.slice(0, 14));
    const token = createAppointmentToken(appt!.id);
    await service.cancelManagedAppointment(token);
    const managed = await service.getManagedAppointment(token);
    expect(managed.status).toBe('CANCELLED');
    expect(managed.canChange).toBe(false);
    await expect(service.cancelManagedAppointment(token)).rejects.toThrow('já foi cancelado');
    await expect(service.rescheduleManagedAppointment(token, at('17:00'))).rejects.toThrow(
      'já foi cancelado',
    );
  });

  it('dentro da janela da política de cancelamento só falando com a barbearia', async () => {
    const appt = await book('17:00', `11${RUN}6`.slice(0, 14));
    const token = createAppointmentToken(appt!.id);
    // Política de 10 dias: o horário (daqui a uma semana) já está dentro dela
    await prisma.network.update({
      where: { id: networkId },
      data: { lateCancellationWindowHours: 240 },
    });
    try {
      expect((await service.getManagedAppointment(token)).canChange).toBe(false);
      await expect(service.cancelManagedAppointment(token)).rejects.toThrow('prazo');
      await expect(service.rescheduleManagedAppointment(token, at('09:00'))).rejects.toThrow(
        'prazo',
      );
      const still = await prisma.appointment.findUniqueOrThrow({ where: { id: appt!.id } });
      expect(still.status).toBe('CONFIRMED');
    } finally {
      await prisma.network.update({
        where: { id: networkId },
        data: { lateCancellationWindowHours: 24 },
      });
    }
  });

  it('conta do cliente: próximos horários com o link de gerenciar, só os dele e só os que valem', async () => {
    const account = await prisma.clientAccount.create({
      data: {
        email: `conta-${RUN}@test.local`,
        name: 'Cliente Conta',
        emailVerifiedAt: new Date(),
      },
    });
    const other = await prisma.clientAccount.create({
      data: { email: `outra-${RUN}@test.local`, name: 'Outra', emailVerifiedAt: new Date() },
    });
    const phone = `7${RUN.slice(-12)}`;
    const mine = await book('09:00', phone);
    const phone2 = `8${RUN.slice(-12)}`;
    const cancelled = await book('09:30', phone2);
    await prisma.customer.updateMany({
      where: { networkId, phone: { in: [phone, phone2] } },
      data: { clientAccountId: account.id },
    });
    await service.cancelManagedAppointment(createAppointmentToken(cancelled!.id));

    const upcoming = await service.getClientUpcomingAppointments(account.id);
    expect(upcoming.map((u) => u.id)).toEqual([mine!.id]);
    expect(upcoming[0]).toMatchObject({
      manageToken: createAppointmentToken(mine!.id),
      canChange: true,
      barbershopSlug: `link-${RUN}`,
    });
    expect(await service.getClientUpcomingAppointments(other.id)).toEqual([]);
  });

  it('horário marcado, remarcado ou cancelado pela equipe: o cliente recebe o aviso', async () => {
    const withEmail = await prisma.customer.create({
      data: {
        networkId,
        name: 'Por Telefone',
        phone: `5${RUN.slice(-12)}`,
        email: `fone-${RUN}@test.local`,
      },
    });
    const noEmail = await prisma.customer.create({
      data: { networkId, name: 'Sem Email', phone: `6${RUN.slice(-12)}` },
    });
    const sentTo = (template: string, to: string) =>
      emails.filter((e) => e.template === template && e.to === to).length;
    const create = (customerId: number, hhmm: string) =>
      service.createAppointment(ownerId, shopId, {
        customerId,
        barberId,
        startAt: new Date(at(hhmm)),
        endAt: new Date(new Date(at(hhmm)).getTime() + 30 * 60000),
        services: [{ serviceId, unitPrice: 50 }],
      });

    const appt = await create(withEmail.id, '13:00');
    await waitForEmail('appointment_confirmation');
    await new Promise((r) => setTimeout(r, 100));
    expect(sentTo('appointment_confirmation', `fone-${RUN}@test.local`)).toBe(1);

    // Só a observação mudou: nada
    await service.updateAppointment(ownerId, shopId, appt!.id, { notes: 'traz a foto' });
    await service.updateAppointment(ownerId, shopId, appt!.id, {
      startAt: new Date(at('13:30')),
      endAt: new Date(new Date(at('13:30')).getTime() + 30 * 60000),
    });
    await service.updateAppointment(ownerId, shopId, appt!.id, { status: 'CANCELLED' });
    await new Promise((r) => setTimeout(r, 150));
    expect(sentTo('appointment_rescheduled', `fone-${RUN}@test.local`)).toBe(1);
    expect(sentTo('appointment_cancelled', `fone-${RUN}@test.local`)).toBe(1);
    const cancelled = emails.find((e) => e.template === 'appointment_cancelled')!;
    expect(cancelled.context.BookURL).toContain(`/u/link-${RUN}`);

    // Cliente sem e-mail: nada sai, e o agendamento funciona igual
    const before = emails.length;
    await create(noEmail.id, '14:30');
    await new Promise((r) => setTimeout(r, 100));
    expect(emails.length).toBe(before);
  });
});
