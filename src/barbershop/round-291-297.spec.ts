import { UnauthorizedException } from '@nestjs/common';
import { UserService } from '../auth/users/users.service';
import { pickSocialLink } from '../auth/social-link';
import { ClientAuthService } from '../client-auth/client-auth.service';
import { refundExceedsLimit } from '../backoffice/approval.service';
import { whatsappSenderVariants } from '../common/phone.util';
import {
  BarbershopService,
  REMOVED_CUSTOMER_NAME,
  RESOURCE_IN_USE_MESSAGE,
} from './barbershop.service';
import { claimFichaReviews } from './review-account';

describe('limite de estorno por moeda', () => {
  it('USD sem limite configurado pede confirmação; real continua em 500', () => {
    expect(refundExceedsLimit(200, 'USD', {})).toBe(true);
    expect(refundExceedsLimit(200, 'BRL', {})).toBe(false);
    expect(refundExceedsLimit(600, 'BRL', {})).toBe(true);
    const env = { BACKOFFICE_REFUND_APPROVAL_LIMITS: 'BRL:500,USD:100,EUR:90' };
    expect(refundExceedsLimit(80, 'usd', env)).toBe(false);
    expect(refundExceedsLimit(150, 'USD', env)).toBe(true);
    expect(refundExceedsLimit(100, 'JPY', env)).toBe(true);
  });
});

describe('login social com outro id no provedor', () => {
  const linkA = { id: 1, providerUserId: 'A', userId: 9, clientAccountId: 9 };

  it('não usa o vínculo que já tem outro id', () => {
    expect(() => pickSocialLink(null, linkA, 'B')).toThrow(UnauthorizedException);
    expect(pickSocialLink(null, { ...linkA, providerUserId: null }, 'B')).toEqual({
      ...linkA,
      providerUserId: null,
    });
    expect(pickSocialLink(linkA, null, 'A')?.userId).toBe(9);
  });

  it('a equipe não entra pelo vínculo de A', async () => {
    const findUnique = jest.fn();
    const service = Object.create(UserService.prototype) as UserService;
    Object.assign(service, {
      prisma: {
        linkedSocialAccount: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ ...linkA, providerEmail: 'a@b.co' }),
        },
        user: { findUnique },
      },
    });
    await expect(service.findOrCreateSocialUser('a@b.co', 'Nova', 'google', 'B')).rejects.toThrow(
      /senha/,
    );
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('o cliente não entra pelo vínculo de A', async () => {
    const findUnique = jest.fn();
    const service = Object.create(ClientAuthService.prototype) as ClientAuthService;
    Object.assign(service, {
      prisma: {
        clientLinkedSocialAccount: {
          findFirst: jest.fn().mockResolvedValue(null),
          findUnique: jest.fn().mockResolvedValue(linkA),
        },
        clientAccount: { findUnique },
      },
    });
    await expect(
      service.findOrCreateSocialAccount('a@b.co', 'Nova', 'google', 'B'),
    ).rejects.toThrow(/senha/);
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe('avaliação da ficha e da conta', () => {
  it('ligar a ficha grava a conta na avaliação que ainda não tem', async () => {
    const update = jest.fn(async () => ({}));
    await claimFichaReviews(
      {
        review: {
          findMany: async () => [{ id: 8, barbershopId: 2 }],
          findFirst: async () => null,
          update,
        },
      } as never,
      4,
      [5],
    );
    expect(update).toHaveBeenCalledWith({ where: { id: 8 }, data: { clientAccountId: 4 } });
  });

  it('logado edita a avaliação do link em vez de criar outra', async () => {
    const update = jest.fn(async ({ data }) => ({ id: 8, ...data }));
    const create = jest.fn();
    const service = Object.create(BarbershopService.prototype) as BarbershopService;
    Object.assign(service, {
      prisma: {
        appointment: { findFirst: async () => ({ id: 1 }) },
        customer: { findMany: async () => [{ id: 5 }] },
        review: {
          findFirst: async () => ({
            id: 8,
            comment: 'pelo link',
            reply: null,
            clientAccountId: null,
          }),
          update,
          create,
        },
      },
    });
    await service.createOrUpdateReview(4, 2, 5, 'de novo');
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 8 },
        data: expect.objectContaining({ clientAccount: { connect: { id: 4 } }, rating: 5 }),
      }),
    );
  });
});

function fichaSemConta(phone: string) {
  return jest.fn(async (args?: { select?: { clientAccountId?: boolean } }) => {
    if (args?.select?.clientAccountId) {
      return { clientAccountId: null, email: 'ana@x.com', phone };
    }
    return { id: 5, phone, blockedAt: null, networkId: 1, deletedAt: null };
  });
}

describe('clube só da ficha ligada ou do mesmo telefone', () => {
  function shop(phone: string, accountPhone: string) {
    const findMany = jest.fn();
    const created = Object.create(BarbershopService.prototype) as BarbershopService;
    Object.assign(created, {
      ensureBarbershopAccess: async () => ({ networkId: 1, accessLevel: 'owner' }),
      contactVisibility: async () => true,
      hideContact: (_can: unknown, row: unknown) => row,
      customerIdsByPhone: async () => [5],
      prisma: {
        customer: { findFirst: fichaSemConta(phone), update: jest.fn(async () => ({ id: 5 })) },
        waitlistEntry: { findMany: async () => [] },
        clientAccount: {
          findFirst: jest.fn(async () => ({ id: 9, phone: accountPhone })),
        },
        clientSubscription: {
          findMany,
          findFirst: async () => ({
            id: 3,
            clientAccountId: 9,
            status: 'ACTIVE',
            usedThisCycle: 0,
            sessionsPerCycle: 2,
            plan: { serviceId: 1 },
          }),
        },
      },
    });
    return { service: created, findMany };
  }

  it('outro telefone não vê o clube, não usa a sessão e o bloqueio não cancela', async () => {
    const { service, findMany } = shop('11911110000', '11922220000');
    await expect(service.getCustomerSubscriptions(1, 2, 5)).resolves.toEqual([]);
    await expect(
      (
        service as unknown as {
          prepareClubSession: (n: number, s: number, data: unknown) => Promise<unknown>;
        }
      ).prepareClubSession(1, 2, {
        customerId: 5,
        clientSubscriptionId: 3,
        items: [],
      }),
    ).rejects.toThrow('Esta assinatura não é deste cliente.');
    await service.setCustomerBlocked(1, 2, 5, true, 'abuso', { cancelSubscriptions: true });
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('recurso inativo', () => {
  it('não desativa com horário futuro, e o horário mantém o recurso inativo', async () => {
    const resourceUpdate = jest.fn();
    const count = jest.fn(async () => 1);
    const service = Object.create(BarbershopService.prototype) as BarbershopService;
    Object.assign(service, {
      ensureBarbershopAccess: async () => ({ accessLevel: 'owner' }),
      prisma: {
        resource: {
          findFirst: async () => ({ id: 4, isActive: true }),
          update: resourceUpdate,
        },
        appointment: { count },
      },
    });
    await expect(service.updateResource(1, 2, 4, { isActive: false })).rejects.toThrow(
      RESOURCE_IN_USE_MESSAGE,
    );
    expect(resourceUpdate).not.toHaveBeenCalled();

    const start = new Date(Date.now() + 86_400_000);
    const end = new Date(start.getTime() + 3_600_000);
    const later = new Date(start.getTime() + 7_200_000);
    const wheres: Array<Record<string, unknown>> = [];
    const appointmentUpdate = jest.fn(async () => ({
      id: 8,
      status: 'CONFIRMED',
      startAt: later,
      barberId: 3,
      customer: { email: null },
      contactEmail: null,
      services: [],
      barber: { name: 'Ana' },
    }));
    Object.assign(service, {
      ownBarberIdIfBarber: async () => null,
      lockSchedule: async () => undefined,
      ensureBarberAvailable: async () => undefined,
      ensureResourceAvailable: async () => undefined,
      checkWaitlistOnCancellation: async () => undefined,
      contactVisibility: async () => true,
      hideAppointmentContact: (_can: unknown, row: unknown) => row,
      logger: { error: () => undefined },
      prisma: {
        appointment: {
          findFirst: async () => ({
            id: 8,
            barberId: 3,
            resourceId: 4,
            startAt: start,
            endAt: end,
            status: 'CONFIRMED',
            prepaidAt: null,
            depositPaid: false,
          }),
          update: appointmentUpdate,
        },
        resource: {
          findFirst: async ({ where }: { where: Record<string, unknown> }) => {
            wheres.push(where);
            if (where.isActive === true) return null;
            return { id: where.id };
          },
        },
        $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
          fn({ appointment: { update: appointmentUpdate } }),
      },
    });
    await service.updateAppointment(1, 2, 8, { resourceId: 4, startAt: later });
    expect(wheres[0]).toEqual({ id: 4, barbershopId: 2 });
    expect(appointmentUpdate).toHaveBeenCalled();
    await expect(
      service.updateAppointment(1, 2, 8, { resourceId: 9, startAt: later }),
    ).rejects.toThrow('Recurso não encontrado');
    expect(wheres[1]).toEqual({ id: 9, barbershopId: 2, isActive: true });
  });
});

describe('ficha apagada', () => {
  it('tira o e-mail dos horários e o nome e o telefone da fila', async () => {
    const appointmentUpdate = jest.fn(async () => ({ count: 1 }));
    const walkInUpdate = jest.fn(async () => ({ count: 1 }));
    const service = Object.create(BarbershopService.prototype) as BarbershopService;
    const touch = () => jest.fn(async () => ({}));
    Object.assign(service, {
      ensureBarbershopAccess: async () => ({ networkId: 1 }),
      prisma: {
        customer: {
          findFirst: async () => ({ id: 5, deletedAt: null, networkId: 1 }),
          update: touch(),
        },
        appointment: { count: async () => 0, updateMany: appointmentUpdate },
        clientPackage: { count: async () => 0 },
        consentForm: { deleteMany: touch() },
        waitlistEntry: { deleteMany: touch() },
        noShowFee: { updateMany: touch() },
        customerReferral: { deleteMany: touch() },
        walkIn: { updateMany: walkInUpdate },
        $executeRaw: jest.fn(async () => 1),
        $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
      },
    });
    await service.deleteCustomer(1, 2, 5);
    expect(appointmentUpdate).toHaveBeenCalledWith({
      where: { customerId: 5 },
      data: { contactEmail: null },
    });
    expect(walkInUpdate).toHaveBeenCalledWith({
      where: { customerId: 5 },
      data: { customerName: REMOVED_CUSTOMER_NAME, customerPhone: null },
    });
  });
});

describe('WhatsApp da conta não desfaz o SAIR', () => {
  it('marcar receber não apaga a linha de quem respondeu SAIR', async () => {
    const rows = new Map<string, number | null>();
    for (const digits of whatsappSenderVariants('+5511988887777')) rows.set(digits, null);
    const service = Object.create(ClientAuthService.prototype) as ClientAuthService;
    Object.assign(service, {
      prisma: {
        clientAccount: { findUnique: async () => ({ phone: '11988887777' }) },
        customer: { findMany: async () => [] },
        whatsappOptOut: {
          findMany: async ({ where }: { where: { phoneDigits: { in: string[] } } }) =>
            where.phoneDigits.in
              .filter((digits) => rows.has(digits))
              .map((phoneDigits) => ({
                phoneDigits,
                clientAccountId: rows.get(phoneDigits) ?? null,
              })),
          createMany: jest.fn(),
          deleteMany: async ({
            where,
          }: {
            where: { phoneDigits: { in: string[] }; clientAccountId: number };
          }) => {
            let count = 0;
            for (const digits of where.phoneDigits.in) {
              if (rows.get(digits) === where.clientAccountId) {
                rows.delete(digits);
                count++;
              }
            }
            return { count };
          },
        },
      },
    });
    const prefs = await service.setWhatsappOptOut(7, false);
    expect(rows.size).toBeGreaterThan(0);
    expect(prefs.whatsappReplyOnly).toBe(true);
    expect(prefs.whatsappOptOut).toBe(false);
  });
});
