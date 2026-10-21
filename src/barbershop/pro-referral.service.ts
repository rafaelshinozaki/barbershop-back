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
import { releaseInviterMonths } from './pro-referral-release';

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
  /** Indicados que ainda não atenderam: o mês de quem indicou entra depois */
  pendingCount: number;
  claimed: boolean;
};

/** Documento ou telefone iguais (sem pontuação). Vazio ou "SOCIAL" não conta. */
export function sameIdentity(
  a: { phone: string | null; idDocNumber: string | null },
  b: { phone: string | null; idDocNumber: string | null },
) {
  const digits = (v: string | null) => (v ?? '').replace(/\D/g, '');
  const doc = (v: string | null) => (v ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  const docA = doc(a.idDocNumber);
  if (docA.length >= 5 && docA !== 'SOCIAL' && docA === doc(b.idDocNumber)) return true;
  const phoneA = digits(a.phone);
  return phoneA.length >= 8 && phoneA === digits(b.phone);
}

@Injectable()
export class ProReferralService {
  constructor(private readonly prisma: PrismaService) {}

  async status(userId: number): Promise<ProReferralStatus> {
    await ensureProfessional(this.prisma, userId);
    const code = await this.ensureCode(userId);
    await releaseInviterMonths(this.prisma, userId);
    const [user, pendingCount] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          proUntil: true,
          _count: { select: { proReferralsSent: true } },
          proReferralReceived: { select: { id: true } },
        },
      }),
      this.prisma.proReferral.count({ where: { inviterUserId: userId, inviterGrantedAt: null } }),
    ]);
    return this.toStatus(
      code,
      user.proUntil,
      user._count.proReferralsSent,
      pendingCount,
      user.proReferralReceived != null,
    );
  }

  async claim(userId: number, rawCode: string) {
    const code = rawCode.trim().toUpperCase();
    if (!code) throw new BadRequestException('Informe o código de quem indicou.');
    const inviter = await this.prisma.user.findUnique({
      where: { proReferralCode: code },
      select: {
        id: true,
        phone: true,
        idDocNumber: true,
        professional: { select: { id: true } },
      },
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
      select: { createdAt: true, phone: true, idDocNumber: true },
    });
    if (!claimant || !isNewProAccount(claimant.createdAt, now)) {
      throw new BadRequestException('Só uma conta nova pode usar um código de indicação.');
    }
    // Mesmo documento ou telefone de quem indicou: é a mesma pessoa
    if (sameIdentity(claimant, inviter)) {
      throw new BadRequestException('Você não pode usar o próprio código.');
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
        // Quem indicou ganha o mês quando a conta nova atender de verdade
        // (releaseInviterMonths); quem foi indicado ganha agora
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
    pendingCount: number,
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
      pendingCount,
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
