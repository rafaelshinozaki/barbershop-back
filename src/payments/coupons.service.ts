import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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

    // Verificar limite de usos
    if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
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

      case COUPON_TYPE.FREE_MONTH:
        // Para o próximo mês gratuito, o desconto é o valor da mensalidade
        discountAmount = originalAmount;
        break;

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

  /** Marca o cupom como usado por este usuário e soma um uso no cupom. */
  async registerUse(couponId: number, userId: number) {
    await this.prisma.userCoupon.upsert({
      where: { userId_couponId: { userId, couponId } },
      update: { usedAt: new Date() },
      create: { userId, couponId, usedAt: new Date() },
    });
    await this.prisma.coupon.update({
      where: { id: couponId },
      data: { usedCount: { increment: 1 } },
    });
  }

  async applyCoupon(couponId: number, userId: number, paymentId: number) {
    this.logger.log(`Applying coupon ${couponId} to payment ${paymentId}`);

    await this.registerUse(couponId, userId);

    // Atualizar pagamento com informações do cupom
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new NotFoundException('Pagamento não encontrado');
    }

    const coupon = await this.prisma.coupon.findUnique({
      where: { id: couponId },
    });

    let discountAmount = 0;
    let finalAmount = Number(payment.amount);

    switch (coupon.type) {
      case COUPON_TYPE.PERCENTAGE:
        discountAmount = (Number(payment.amount) * Number(coupon.value)) / 100;
        finalAmount = Number(payment.amount) - discountAmount;
        break;

      case COUPON_TYPE.FIXED_AMOUNT:
        discountAmount = Number(coupon.value);
        finalAmount = Math.max(0, Number(payment.amount) - discountAmount);
        break;

      case COUPON_TYPE.FREE_MONTH:
      case COUPON_TYPE.FREE_SUBSCRIPTION:
        discountAmount = Number(payment.amount);
        finalAmount = 0;
        break;
    }

    await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        appliedCouponId: couponId,
        originalAmount: payment.amount,
        amount: new Prisma.Decimal(finalAmount),
        discountAmount: new Prisma.Decimal(discountAmount),
      },
    });

    this.logger.log(`Coupon applied successfully. Final amount: ${finalAmount}`);
    return { finalAmount, discountAmount };
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
