import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { isAfter, isBefore } from 'date-fns';

export enum COUPON_TYPE {
  PERCENTAGE = 'PERCENTAGE',
  FIXED_AMOUNT = 'FIXED_AMOUNT',
  FREE_MONTH = 'FREE_MONTH',
  FREE_SUBSCRIPTION = 'FREE_SUBSCRIPTION',
}

export interface CouponValidationResult {
  isValid: boolean;
  error?: string;
  coupon?: any;
  discountAmount?: number;
  originalAmount?: number;
}

/** Quanto tempo a cobrança criada segura o uso do cupom */
export const COUPON_RESERVATION_MS = 60 * 60 * 1000;
export const COUPON_VALUE_MESSAGE =
  'Cupom de porcentagem vai de 1 a 100, e o de valor fixo precisa de valor maior que zero.';

/** Porcentagem de 1 a 100 e valor fixo positivo (negativo aumentava o preço) */
export function couponValueOk(type: string, value: number) {
  if (!Number.isFinite(value)) return false;
  if (type === COUPON_TYPE.PERCENTAGE) return value >= 1 && value <= 100;
  if (type === COUPON_TYPE.FIXED_AMOUNT) return value > 0;
  return value >= 0;
}

/** Lista vazia = vale pra todos os planos (null); "[]" travaria o cupom pra nenhum. */
function plansToJson(plans: number[] | null | undefined): string | null | undefined {
  if (plans === undefined) return undefined;
  return plans && plans.length ? JSON.stringify(plans) : null;
}

@Injectable()
export class CouponsService {
  private readonly logger = new Logger(CouponsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createCoupon(data: {
    code: string;
    name: string;
    description?: string;
    type: COUPON_TYPE;
    value: number;
    maxUses?: number;
    validFrom?: Date;
    validUntil?: Date;
    minSubscriptionMonths?: number;
    applicablePlans?: number[];
  }) {
    this.logger.log(`Creating coupon with code: ${data.code}`);
    if (!couponValueOk(data.type, Number(data.value))) {
      throw new BadRequestException(COUPON_VALUE_MESSAGE);
    }

    const applicablePlansJson = plansToJson(data.applicablePlans) ?? null;

    const coupon = await this.withUniqueCode(() =>
      this.prisma.coupon.create({
        data: {
          code: data.code.toUpperCase(),
          name: data.name,
          description: data.description,
          type: data.type,
          value: new Prisma.Decimal(data.value),
          maxUses: data.maxUses,
          validFrom: data.validFrom || new Date(),
          validUntil: data.validUntil,
          minSubscriptionMonths: data.minSubscriptionMonths,
          applicablePlans: applicablePlansJson,
        },
      }),
    );

    this.logger.log(`Coupon created with ID: ${coupon.id}`);
    return coupon;
  }

  async validateCoupon(
    code: string,
    userId: number,
    planId: number,
    originalAmount: number,
  ): Promise<CouponValidationResult> {
    this.logger.log(`Validating coupon: ${code} for user: ${userId}`);

    const coupon = await this.prisma.coupon.findUnique({
      where: { code: code.toUpperCase() },
    });

    // Cupom apagado no backoffice (soft delete) não vale mais
    if (!coupon || coupon.deleted_at) {
      return { isValid: false, error: 'Cupom não encontrado' };
    }

    if (!coupon.isActive) {
      return { isValid: false, error: 'Cupom inativo' };
    }

    // Verificar validade temporal
    const now = new Date();
    if (isBefore(now, coupon.validFrom)) {
      return { isValid: false, error: 'Cupom ainda não está válido' };
    }

    if (coupon.validUntil && isAfter(now, coupon.validUntil)) {
      return { isValid: false, error: 'Cupom expirado' };
    }

    if (!couponValueOk(coupon.type, Number(coupon.value))) {
      return { isValid: false, error: 'Cupom inválido' };
    }

    // Verificar limite de usos (as cobranças em aberto de outras pessoas
    // seguram um uso cada)
    if (
      coupon.maxUses &&
      coupon.usedCount + (await this.heldByOthers(this.prisma, coupon.id, userId)) >= coupon.maxUses
    ) {
      return { isValid: false, error: 'Cupom esgotado' };
    }

    // Verificar se o usuário já usou este cupom
    const userCoupon = await this.prisma.userCoupon.findUnique({
      where: {
        userId_couponId: {
          userId,
          couponId: coupon.id,
        },
      },
    });

    if (userCoupon && userCoupon.usedAt) {
      return { isValid: false, error: 'Cupom já foi utilizado por este usuário' };
    }

    // Cupom entregue a uma conta (convite de amigo): o código não vale
    // para outra pessoa. Cupom público não tem essa reserva.
    if (!userCoupon) {
      const reserved = await this.prisma.userCoupon.findFirst({
        where: { couponId: coupon.id, usedAt: null },
        select: { id: true },
      });
      if (reserved) {
        return { isValid: false, error: 'Este cupom não é da sua conta' };
      }
    }

    // Verificar planos aplicáveis
    if (coupon.applicablePlans) {
      const applicablePlans = JSON.parse(coupon.applicablePlans);
      if (!applicablePlans.includes(planId)) {
        return { isValid: false, error: 'Cupom não é válido para este plano' };
      }
    }

    // Verificar meses mínimos de assinatura
    if (coupon.minSubscriptionMonths) {
      const userSubscriptions = await this.prisma.subscription.findMany({
        where: { userId },
        orderBy: { startSubDate: 'desc' },
      });

      if (userSubscriptions.length === 0) {
        return { isValid: false, error: 'Cupom requer assinatura prévia' };
      }

      const totalMonths = userSubscriptions.reduce((total, sub) => {
        const endDate = sub.cancelationDate || new Date();
        const months = Math.floor(
          (endDate.getTime() - sub.startSubDate.getTime()) / (1000 * 60 * 60 * 24 * 30),
        );
        return total + months;
      }, 0);

      if (totalMonths < coupon.minSubscriptionMonths) {
        return {
          isValid: false,
          error: `Cupom requer mínimo de ${coupon.minSubscriptionMonths} meses de assinatura`,
        };
      }
    }

    // Calcular desconto
    let discountAmount = 0;

    switch (coupon.type) {
      case COUPON_TYPE.PERCENTAGE:
        discountAmount = (originalAmount * Number(coupon.value)) / 100;
        break;

      case COUPON_TYPE.FIXED_AMOUNT:
        discountAmount = Number(coupon.value);
        break;

      case COUPON_TYPE.FREE_MONTH: {
        // Um mês do plano: no anual, um doze avos do preço (antes o desconto
        // era o preço inteiro e o "1 mês grátis" virava o ano todo, item 350)
        const plan = await this.prisma.plan.findUnique({
          where: { id: planId },
          select: { billingCycle: true },
        });
        discountAmount =
          plan?.billingCycle === 'YEARLY'
            ? Math.round((originalAmount / 12) * 100) / 100
            : originalAmount;
        break;
      }

      case COUPON_TYPE.FREE_SUBSCRIPTION:
        // Para assinatura gratuita, o desconto é o valor total
        discountAmount = originalAmount;
        break;

      default:
        return { isValid: false, error: 'Tipo de cupom inválido' };
    }

    return {
      isValid: true,
      coupon,
      discountAmount,
      originalAmount,
    };
  }

  /** Usos que as cobranças em aberto de outras pessoas seguram */
  private heldByOthers(client: Prisma.TransactionClient, couponId: number, userId: number) {
    return client.couponReservation.count({
      where: { couponId, userId: { not: userId }, expiresAt: { gt: new Date() } },
    });
  }

  /**
   * Reserva o uso do cupom para a cobrança criada (com prazo). A cobrança
   * anterior da mesma pessoa com o mesmo cupom perde a reserva: devolve os
   * ids dela para quem chamou cancelar no Stripe.
   */
  async reserve(couponId: number, userId: number, paymentIntentId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'coupon:' + couponId}))`;
      const coupon = await tx.coupon.findUnique({
        where: { id: couponId },
        select: { maxUses: true, usedCount: true },
      });
      if (!coupon) throw new BadRequestException('Cupom não encontrado');
      const used = await tx.userCoupon.findUnique({
        where: { userId_couponId: { userId, couponId } },
        select: { usedAt: true },
      });
      if (used?.usedAt) throw new BadRequestException('Cupom já foi utilizado por este usuário');
      if (
        coupon.maxUses &&
        coupon.usedCount + (await this.heldByOthers(tx, couponId, userId)) >= coupon.maxUses
      ) {
        throw new BadRequestException('Cupom esgotado');
      }
      const previous = await tx.couponReservation.findMany({
        where: { couponId, userId },
        select: { paymentIntentId: true },
      });
      await tx.couponReservation.deleteMany({ where: { couponId, userId } });
      await tx.couponReservation.create({
        data: {
          couponId,
          userId,
          paymentIntentId,
          expiresAt: new Date(Date.now() + COUPON_RESERVATION_MS),
        },
      });
      return previous.map((r) => r.paymentIntentId);
    });
  }

  /**
   * Registra o uso dentro da transação de quem ativa o plano, com trava por
   * cupom: checkouts ao mesmo tempo passavam todos pela validação (uso único
   * por pessoa, limite de usos) e o cupom valia várias vezes. Com cobrança,
   * só vale a que tem a reserva do cupom (outra aba ou cobrança guardada
   * não). Devolve false se o uso não cabe mais.
   */
  async claimUse(
    tx: Prisma.TransactionClient,
    couponId: number,
    userId: number,
    paymentIntentId?: string | null,
  ) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'coupon:' + couponId}))`;
    const coupon = await tx.coupon.findUnique({
      where: { id: couponId },
      select: { maxUses: true, usedCount: true },
    });
    if (!coupon) return false;
    let held = await this.heldByOthers(tx, couponId, userId);
    if (paymentIntentId) {
      const reservation = await tx.couponReservation.findUnique({ where: { paymentIntentId } });
      if (!reservation || reservation.couponId !== couponId || reservation.userId !== userId) {
        return false;
      }
      await tx.couponReservation.delete({ where: { id: reservation.id } });
      // Reserva dentro do prazo já estava contada no limite
      if (reservation.expiresAt > new Date()) held = -1;
    }
    if (coupon.maxUses && held >= 0 && coupon.usedCount + held >= coupon.maxUses) return false;
    const used = await tx.userCoupon.findUnique({
      where: { userId_couponId: { userId, couponId } },
      select: { usedAt: true },
    });
    if (used?.usedAt) return false;
    await tx.userCoupon.upsert({
      where: { userId_couponId: { userId, couponId } },
      update: { usedAt: new Date() },
      create: { userId, couponId, usedAt: new Date() },
    });
    await tx.coupon.update({ where: { id: couponId }, data: { usedCount: { increment: 1 } } });
    return true;
  }

  async getCouponsForUser(userId: number) {
    // Só os que ainda dá pra usar: já usado ou apagado no backoffice não
    // aparece como "seu cupom" no checkout
    const userCoupons = await this.prisma.userCoupon.findMany({
      where: { userId, usedAt: null, coupon: { deleted_at: null, isActive: true } },
      include: {
        coupon: true,
      },
    });

    return userCoupons.map((uc) => uc.coupon);
  }

  async getAllCoupons() {
    return await this.prisma.coupon.findMany({
      where: { deleted_at: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getCouponById(id: number) {
    const coupon = await this.prisma.coupon.findUnique({
      where: { id },
    });

    if (!coupon) {
      throw new NotFoundException('Cupom não encontrado');
    }

    return coupon;
  }

  async updateCoupon(
    id: number,
    data: Omit<Partial<Prisma.CouponUpdateInput>, 'applicablePlans'> & {
      applicablePlans?: number[] | null;
    },
  ) {
    const { applicablePlans, code, ...rest } = data;
    if (rest.value !== undefined || rest.type !== undefined) {
      const current = await this.prisma.coupon.findUnique({
        where: { id },
        select: { type: true, value: true },
      });
      const type = typeof rest.type === 'string' ? rest.type : current?.type ?? '';
      const value = rest.value !== undefined ? Number(rest.value) : Number(current?.value ?? 0);
      if (!couponValueOk(type, value)) throw new BadRequestException(COUPON_VALUE_MESSAGE);
    }
    const coupon = await this.withUniqueCode(() =>
      this.prisma.coupon.update({
        where: { id },
        data: {
          ...rest,
          // Mesmo formato do createCoupon: o código é sempre maiúsculo e os
          // planos ficam como JSON numa coluna String (antes ia o array cru
          // e o Prisma recusava a edição)
          ...(typeof code === 'string' ? { code: code.toUpperCase() } : {}),
          ...(applicablePlans !== undefined
            ? { applicablePlans: plansToJson(applicablePlans) }
            : {}),
        },
      }),
    );

    this.logger.log(`Coupon ${id} updated`);
    return coupon;
  }

  /** Código repetido vira um erro legível em vez do P2002 cru do Prisma. */
  private async withUniqueCode<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Já existe um cupom com esse código');
      }
      throw e;
    }
  }

  async deleteCoupon(id: number) {
    await this.prisma.coupon.update({
      where: { id },
      data: { deleted_at: new Date() },
    });

    this.logger.log(`Coupon ${id} soft deleted`);
  }

  async getCouponUsageStats(couponId: number) {
    const coupon = await this.prisma.coupon.findUnique({
      where: { id: couponId },
      include: {
        userCoupons: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                fullName: true,
              },
            },
          },
        },
        payments: {
          include: {
            subscription: {
              include: {
                plan: true,
              },
            },
          },
        },
      },
    });

    if (!coupon) {
      throw new NotFoundException('Cupom não encontrado');
    }

    return coupon;
  }
}
