import { BadRequestException } from '@nestjs/common';
import { ProReferralService } from './pro-referral.service';
import { PRO_REFERRAL_MAX_MONTHS } from './pro';

describe('ProReferralService.claim', () => {
  const now = new Date();
  const inviter = { id: 10, professional: { id: 1 } };

  function service(overrides?: {
    createdAt?: Date;
    crossed?: boolean;
    earnedMonths?: number;
    proUntil?: Date | null;
  }) {
    const updates: Array<{ id: number; proUntil: Date }> = [];
    const tx = {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn(async () => [{ proUntil: overrides?.proUntil ?? null }]),
      proReferral: {
        findFirst: jest.fn(async () => (overrides?.crossed ? { id: 1 } : null)),
        aggregate: jest.fn(async () => ({ _sum: { months: overrides?.earnedMonths ?? 0 } })),
        create: jest.fn(async () => ({ id: 1 })),
      },
      user: {
        update: jest.fn(async ({ where, data }: { where: { id: number }; data: { proUntil: Date } }) => {
          updates.push({ id: where.id, proUntil: data.proUntil });
          return data;
        }),
      },
    };
    const prisma = {
      user: {
        findUnique: jest.fn(async ({ where }: { where: { proReferralCode?: string; id?: number } }) => {
          if (where.proReferralCode) return inviter;
          return { createdAt: overrides?.createdAt ?? now, proReferralCode: 'EXISTING' };
        }),
        findUniqueOrThrow: jest.fn(async () => ({
          proUntil: null,
          _count: { proReferralsSent: 1 },
          proReferralReceived: { id: 1 },
        })),
        update: jest.fn(),
      },
      professional: {
        findUnique: jest.fn(async () => ({ id: 2, userId: 2 })),
      },
      $transaction: jest.fn(async (fn: (db: typeof tx) => Promise<void>) => fn(tx)),
    };
    const referrals = new ProReferralService(prisma as never);
    return { referrals, tx, updates, prisma };
  }

  it('recusa conta antiga', async () => {
    const { referrals, prisma } = service({
      createdAt: new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000),
    });
    await expect(referrals.claim(2, 'abc')).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('recusa indicação cruzada', async () => {
    const { referrals, tx } = service({ crossed: true });
    await expect(referrals.claim(2, 'abc')).rejects.toThrow(
      'Vocês já se indicaram. Não dá para indicar de volta.',
    );
    expect(tx.proReferral.create).not.toHaveBeenCalled();
  });

  it('recusa quando o indicador já atingiu o teto', async () => {
    const { referrals, tx } = service({ earnedMonths: PRO_REFERRAL_MAX_MONTHS });
    await expect(referrals.claim(2, 'abc')).rejects.toThrow(
      'Este código já atingiu o limite de meses de indicação.',
    );
    expect(tx.proReferral.create).not.toHaveBeenCalled();
  });

  it('soma o mês em cima do Pro lido com a linha travada', async () => {
    const current = new Date('2026-12-01T00:00:00.000Z');
    const { referrals, tx, updates } = service({ proUntil: current });
    await referrals.claim(2, ' abc ');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(tx.proReferral.create).toHaveBeenCalledWith({
      data: { inviterUserId: 10, invitedUserId: 2, months: 1 },
    });
    expect(updates.map((row) => row.id)).toEqual([10, 2]);
    expect(updates[0].proUntil.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});
