import { BadRequestException } from '@nestjs/common';
import { BarbershopService } from './barbershop.service';

const REFUSE =
  'Este horário já aconteceu ou tem registro ligado. Cancele (ou marque falta) em vez de excluir.';

describe('deleteAppointment', () => {
  function build(appointment: Record<string, unknown>) {
    const deleted: number[] = [];
    const threadsDeleted: number[] = [];
    const prisma = {
      appointment: {
        findFirst: async () => appointment,
        delete: async ({ where }: { where: { id: number } }) => {
          deleted.push(where.id);
        },
      },
      customer: { findUnique: async () => ({ email: null }) },
      appointmentService: { findMany: async () => [] },
      chatMessage: { deleteMany: async () => ({ count: 0 }) },
      chatThread: {
        deleteMany: async ({ where }: { where: { id: { in: number[] } } }) => {
          threadsDeleted.push(...where.id.in);
          return { count: where.id.in.length };
        },
      },
      $transaction: async (fn: (tx: unknown) => Promise<void>) => fn(prisma),
    };
    const service = Object.create(BarbershopService.prototype) as BarbershopService;
    Object.assign(service, {
      prisma,
      logger: { error: () => undefined },
      ensureBarbershopAccess: async () => undefined,
      sendAppointmentEmail: async () => undefined,
      checkWaitlistOnCancellation: () => Promise.resolve(),
    });
    return { service, deleted, threadsDeleted };
  }

  const open = {
    id: 9,
    barbershopId: 3,
    customerId: 4,
    barberId: 5,
    status: 'CONFIRMED',
    startAt: new Date('2030-01-01T15:00:00Z'),
    depositPaid: false,
    depositPaidAt: null,
    prepaidAt: null,
    contactEmail: null,
    sale: null,
    professionalReview: null,
    customerRatings: [],
    tips: [],
    noShowFee: null,
    chatThreads: [],
  };

  it('não exclui horário com avaliação', async () => {
    const { service, deleted } = build({
      ...open,
      status: 'COMPLETED',
      professionalReview: { id: 1 },
    });
    await expect(service.deleteAppointment(1, 3, 9)).rejects.toThrow(new BadRequestException(REFUSE));
    expect(deleted).toEqual([]);
  });

  it('não exclui horário com caixinha', async () => {
    const { service, deleted } = build({ ...open, tips: [{ id: 2 }] });
    await expect(service.deleteAppointment(1, 3, 9)).rejects.toThrow(new BadRequestException(REFUSE));
    expect(deleted).toEqual([]);
  });

  it('exclui horário marcado que não tem registro, e a conversa comum sai antes', async () => {
    const { service, deleted, threadsDeleted } = build({
      ...open,
      chatThreads: [{ id: 8, retainUntil: null, closedAt: null }],
    });
    await service.deleteAppointment(1, 3, 9);
    expect(threadsDeleted).toEqual([8]);
    expect(deleted).toEqual([9]);
  });

  it('não exclui horário com conversa denunciada', async () => {
    const { service, deleted } = build({
      ...open,
      chatThreads: [{ id: 8, retainUntil: new Date('2030-01-01'), closedAt: null }],
    });
    await expect(service.deleteAppointment(1, 3, 9)).rejects.toBeInstanceOf(BadRequestException);
    expect(deleted).toEqual([]);
  });
});
