import {
  reminderCoveredByConfirmation,
  AppointmentReminderService,
} from './appointment-reminder.service';
import { LOCALE } from '../email/language';

describe('reminderCoveredByConfirmation', () => {
  it('horário marcado dentro das 24 h não ganha um segundo e-mail', () => {
    const created = new Date('2030-03-04T18:00:00Z');
    const tomorrowMorning = new Date('2030-03-05T11:00:00Z');
    expect(reminderCoveredByConfirmation(created, tomorrowMorning)).toBe(true);
  });

  it('horário marcado com mais de 24 h de antecedência ainda recebe o lembrete', () => {
    const created = new Date('2030-03-01T12:00:00Z');
    const start = new Date('2030-03-04T12:00:00Z');
    expect(reminderCoveredByConfirmation(created, start)).toBe(false);
  });
});

describe('lembrete por WhatsApp no país da unidade', () => {
  const startAt = new Date('2026-10-21T14:00:00.000Z');

  function serviceFor(phone: string) {
    const whatsapp = jest.fn();
    const prisma = {
      appointment: {
        findMany: async () => [
          {
            id: 7,
            createdAt: new Date('2026-10-01T12:00:00Z'),
            startAt,
            linkVersion: 1,
            customer: { name: 'Ana', phone, email: null },
            barber: { name: 'Leo' },
            barbershop: {
              country: 'US',
              timezone: 'America/New_York',
              name: 'Shop',
              address: '1 Main',
              city: 'New York',
              state: 'NY',
              phone: '2125550100',
              ownerUserId: 1,
              network: { lateCancellationWindowHours: 2 },
            },
            services: [{ service: { name: 'Cut' } }],
          },
        ],
        updateMany: async () => ({ count: 1 }),
      },
    };
    const reminders = new AppointmentReminderService(
      prisma as never,
      { email: jest.fn(), whatsapp } as never,
      { isConfigured: () => true } as never,
    );
    return { reminders, whatsapp };
  }

  it('unidade dos EUA manda no DDI 1, em inglês e no horário de Nova York', async () => {
    const { reminders, whatsapp } = serviceFor('415 555 1234');
    await reminders.enqueueDueReminders();
    const job = whatsapp.mock.calls[0][0];
    expect(job.to).toBe('+14155551234');
    expect(job.lang).toBe('en');
    expect(job.params.date).toBe(
      startAt.toLocaleDateString(LOCALE.en, { timeZone: 'America/New_York' }),
    );
    expect(job.params.time).toBe(
      startAt.toLocaleTimeString(LOCALE.en, {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/New_York',
      }),
    );
  });

  it('telefone que não fecha com o país da unidade não vai para o WhatsApp', async () => {
    const { reminders, whatsapp } = serviceFor('11999990000');
    await reminders.enqueueDueReminders();
    expect(whatsapp).not.toHaveBeenCalled();
  });
});
