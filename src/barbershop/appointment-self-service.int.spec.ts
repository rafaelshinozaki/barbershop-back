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
});
