import { randomInt } from 'crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ensureProfessional } from './professional';
import {
  proPriceCents,
  PRO_REFERRAL_MONTHS,
  extendProUntil,
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
    await ensureProfessional(this.prisma, userId);
    const now = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
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

  private async grant(tx: Prisma.TransactionClient, userId: number, now: Date) {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { proUntil: true } });
    await tx.user.update({
      where: { id: userId },
      data: { proUntil: extendProUntil(user?.proUntil, PRO_REFERRAL_MONTHS, now) },
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
