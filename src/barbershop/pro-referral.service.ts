import { randomInt } from 'crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ensureProfessional } from './professional';
import {
  proPriceCents,
  PRO_REFERRAL_MONTHS,
  PRO_REFERRAL_MAX_MONTHS,
  extendProUntil,
  isNewProAccount,
  isProActive,
  proPriceLabel,
} from './pro';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
  return Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}

export type ProReferralStatus = {
  code: string;
  priceCents: number;
  priceLabel: string;
  months: number;
  proUntil: string | null;
  proActive: boolean;
  invitedCount: number;
  claimed: boolean;
};

@Injectable()
export class ProReferralService {
  constructor(private readonly prisma: PrismaService) {}

  async status(userId: number): Promise<ProReferralStatus> {
    await ensureProfessional(this.prisma, userId);
    const code = await this.ensureCode(userId);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        proUntil: true,
        _count: { select: { proReferralsSent: true } },
        proReferralReceived: { select: { id: true } },
      },
    });
    return this.toStatus(
      code,
      user.proUntil,
      user._count.proReferralsSent,
      user.proReferralReceived != null,
    );
  }

  async claim(userId: number, rawCode: string) {
    const code = rawCode.trim().toUpperCase();
    if (!code) throw new BadRequestException('Informe o código de quem indicou.');
    const inviter = await this.prisma.user.findUnique({
      where: { proReferralCode: code },
      select: { id: true, professional: { select: { id: true } } },
    });
    if (!inviter) throw new BadRequestException('Código de indicação não encontrado.');
    if (inviter.id === userId)
      throw new BadRequestException('Você não pode usar o próprio código.');
    if (!inviter.professional) {
      throw new BadRequestException('Esse código ainda não é de um profissional.');
    }
    const now = new Date();
    const claimant = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true },
    });
    if (!claimant || !isNewProAccount(claimant.createdAt, now)) {
      throw new BadRequestException('Só uma conta nova pode usar um código de indicação.');
    }
    await ensureProfessional(this.prisma, userId);
    try {
      await this.prisma.$transaction(async (tx) => {
        // Trava os dois, do menor id para o maior, pra duas indicações
        // cruzadas ao mesmo tempo não passarem juntas.
        await this.lockProUntil(tx, [inviter.id, userId]);
        const crossed = await tx.proReferral.findFirst({
          where: { inviterUserId: userId, invitedUserId: inviter.id },
          select: { id: true },
        });
        if (crossed) {
          throw new BadRequestException('Vocês já se indicaram. Não dá para indicar de volta.');
        }
        const earned = await tx.proReferral.aggregate({
          where: { inviterUserId: inviter.id },
          _sum: { months: true },
        });
        if ((earned._sum.months ?? 0) + PRO_REFERRAL_MONTHS > PRO_REFERRAL_MAX_MONTHS) {
          throw new BadRequestException('Este código já atingiu o limite de meses de indicação.');
        }
        await tx.proReferral.create({
          data: { inviterUserId: inviter.id, invitedUserId: userId, months: PRO_REFERRAL_MONTHS },
        });
        await this.grant(tx, inviter.id, now);
        await this.grant(tx, userId, now);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('Esta conta já usou uma indicação.');
      }
      throw error;
    }
    return this.status(userId);
  }

  private toStatus(
    code: string,
    proUntil: Date | null,
    invitedCount: number,
    claimed: boolean,
  ): ProReferralStatus {
    return {
      code,
      priceCents: proPriceCents(),
      priceLabel: proPriceLabel(),
      months: PRO_REFERRAL_MONTHS,
      proUntil: proUntil?.toISOString() ?? null,
      proActive: isProActive(proUntil, new Date()),
      invitedCount,
      claimed,
    };
  }

  private async lockProUntil(tx: Prisma.TransactionClient, userIds: number[]) {
    for (const userId of [...userIds].sort((a, b) => a - b)) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pro-until:${userId}`}))`;
    }
  }

  /** Lê e grava o fim do Pro com a linha travada, pra dois usos ao mesmo tempo somarem os dois meses. */
  private async grant(tx: Prisma.TransactionClient, userId: number, now: Date) {
    const rows = await tx.$queryRaw<{ proUntil: Date | null }[]>`
      SELECT "proUntil" FROM "User" WHERE id = ${userId} FOR UPDATE
    `;
    await tx.user.update({
      where: { id: userId },
      data: { proUntil: extendProUntil(rows[0]?.proUntil, PRO_REFERRAL_MONTHS, now) },
    });
  }

  private async ensureCode(userId: number) {
    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { proReferralCode: true },
    });
    if (current?.proReferralCode) return current.proReferralCode;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const updated = await this.prisma.user.update({
          where: { id: userId },
          data: { proReferralCode: newCode() },
          select: { proReferralCode: true },
        });
        if (updated.proReferralCode) return updated.proReferralCode;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
          continue;
        throw error;
      }
    }
    throw new BadRequestException('Não foi possível criar o código de indicação.');
  }
}
