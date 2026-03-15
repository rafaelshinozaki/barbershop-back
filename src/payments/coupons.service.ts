import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { addMonths, isAfter, isBefore } from 'date-fns';

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

    const applicablePlansJson = data.applicablePlans 
      ? JSON.stringify(data.applicablePlans) 
      : null;

    const coupon = await this.prisma.coupon.create({
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
    });

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

    if (!coupon) {
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
          (endDate.getTime() - sub.startSubDate.getTime()) / 
          (1000 * 60 * 60 * 24 * 30)
        );
        return total + months;
      }, 0);

      if (totalMonths < coupon.minSubscriptionMonths) {
        return { 
          isValid: false, 
          error: `Cupom requer mínimo de ${coupon.minSubscriptionMonths} meses de assinatura` 
        };
      }
    }

    // Calcular desconto
    let discountAmount = 0;
    let finalAmount = originalAmount;

    switch (coupon.type) {
      case COUPON_TYPE.PERCENTAGE:
        discountAmount = (originalAmount * Number(coupon.value)) / 100;
        finalAmount = originalAmount - discountAmount;
        break;

      case COUPON_TYPE.FIXED_AMOUNT:
        discountAmount = Number(coupon.value);
        finalAmount = Math.max(0, originalAmount - discountAmount);
        break;

      case COUPON_TYPE.FREE_MONTH:
        // Para o próximo mês gratuito, o desconto é o valor da mensalidade
        discountAmount = originalAmount;
        finalAmount = 0;
        break;

      case COUPON_TYPE.FREE_SUBSCRIPTION:
        // Para assinatura gratuita, o desconto é o valor total
        discountAmount = originalAmount;
        finalAmount = 0;
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

  async applyCoupon(
    couponId: number,
    userId: number,
    paymentId: number,
  ) {
    this.logger.log(`Applying coupon ${couponId} to payment ${paymentId}`);

    // Registrar uso do cupom pelo usuário
    await this.prisma.userCoupon.upsert({
      where: {
        userId_couponId: {
          userId,
          couponId,
        },
      },
      update: {
        usedAt: new Date(),
      },
      create: {
        userId,
        couponId,
        usedAt: new Date(),
      },
    });

    // Incrementar contador de usos do cupom
    await this.prisma.coupon.update({
      where: { id: couponId },
      data: {
        usedCount: {
          increment: 1,
        },
      },
    });

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
    const userCoupons = await this.prisma.userCoupon.findMany({
      where: { userId },
      include: {
        coupon: true,
      },
    });

    return userCoupons.map(uc => uc.coupon);
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

  async updateCoupon(id: number, data: Partial<Prisma.CouponUpdateInput>) {
    const coupon = await this.prisma.coupon.update({
      where: { id },
      data,
    });

    this.logger.log(`Coupon ${id} updated`);
    return coupon;
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