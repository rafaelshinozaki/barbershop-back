// src\plan\plan.service.ts
import { Injectable, NotFoundException, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanDTO } from './dto/plan.dto';
import { Prisma } from '@prisma/client';
import { StripeService } from '../stripe/stripe.service';
import { PLANO_STATUS } from '../common/contants';

/** Ciclos que a renovação e a Stripe entendem igual */
export const BILLING_CYCLES = ['MONTHLY', 'YEARLY'];
export const BILLING_CYCLE_MESSAGE = 'Ciclo de cobrança inválido: use MONTHLY ou YEARLY.';

function billingCycleOf(value: string | undefined | null) {
  const cycle = String(value ?? '')
    .trim()
    .toUpperCase();
  if (!BILLING_CYCLES.includes(cycle)) throw new BadRequestException(BILLING_CYCLE_MESSAGE);
  return cycle;
}

function parsePlanIds(raw: string | null): number[] {
  try {
    const ids = JSON.parse(raw ?? '[]');
    return Array.isArray(ids) ? ids.filter((n) => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
}

@Injectable()
export class PlanService {
  private readonly logger = new Logger(PlanService.name);

  constructor(private prisma: PrismaService, private stripeService: StripeService) {}

  async createPlan(planData: PlanDTO) {
    this.logger.log(`Creating plan with name: ${planData.name}`);
    const billingCycle = billingCycleOf(planData.billingCycle);

    // Criar produto no Stripe
    let stripeProduct: any;
    let stripePrice: any;

    try {
      stripeProduct = await this.stripeService.createProduct(
        planData.name,
        planData.description || undefined,
      );

      // Determinar o intervalo de cobrança
      const recurring = this.getRecurringInterval(billingCycle);

      stripePrice = await this.stripeService.createPrice(
        stripeProduct.id,
        Math.round(Number(planData.price) * 100), // Converter para centavos
        'brl',
        recurring,
      );

      this.logger.log(`Created Stripe product: ${stripeProduct.id} and price: ${stripePrice.id}`);
    } catch (error) {
      this.logger.error('Failed to create Stripe product/price:', error);
      throw new BadRequestException('Não foi possível criar o plano na Stripe');
    }

    const prismaPlanData: Prisma.PlanCreateInput = {
      name: planData.name,
      description: planData.description,
      price: planData.price,
      billingCycle,
      features: planData.features,
      stripePriceId: stripePrice.id,
    };

    return await this.prisma.plan.create({
      data: prismaPlanData,
    });
  }

  async updatePlan(planId: number, planData: Partial<PlanDTO>) {
    this.logger.log(`Updating plan with ID: ${planId}`);

    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan || plan.deleted_at) throw new NotFoundException('Plano não encontrado');

    const price = planData.price != null ? Number(planData.price) : Number(plan.price);
    const billingCycle =
      planData.billingCycle != null ? billingCycleOf(planData.billingCycle) : plan.billingCycle;
    let stripePriceId = planData.stripePriceId ?? plan.stripePriceId;
    const billingChanged = price !== Number(plan.price) || billingCycle !== plan.billingCycle;

    // Preço ou ciclo mudou: preço novo no Stripe, no mesmo produto do plano
    // (preço no Stripe não muda; quem já assina continua no preço antigo)
    if (billingChanged) {
      try {
        const productId =
          (plan.stripePriceId &&
            (await this.stripeService.getPriceProductId(plan.stripePriceId))) ||
          (
            await this.stripeService.createProduct(
              planData.name ?? plan.name,
              plan.description ?? undefined,
            )
          ).id;
        const newPrice = await this.stripeService.createPrice(
          productId,
          Math.round(price * 100),
          'brl',
          this.getRecurringInterval(billingCycle),
        );
        stripePriceId = newPrice.id;
        this.logger.log(`Created new Stripe price: ${newPrice.id} for plan ${planId}`);
      } catch (error) {
        this.logger.error('Failed to create new Stripe price:', error);
        throw new BadRequestException('Não foi possível criar o preço novo na Stripe');
      }
    }

    // Quem já assina continua no preço e no ciclo que contratou: a renovação
    // feita por nós lê o plano da assinatura, então o plano com assinantes
    // não muda de preço. Ele sai da lista (como removido) e uma versão nova
    // entra para quem assinar a partir de agora (item 351)
    if (billingChanged && (await this.inUse(planId)) > 0) {
      return this.prisma.$transaction(async (tx) => {
        await tx.plan.update({ where: { id: planId }, data: { deleted_at: new Date() } });
        const next = await tx.plan.create({
          data: {
            name: planData.name ?? plan.name,
            description: planData.description ?? plan.description,
            price,
            billingCycle,
            features: planData.features ?? plan.features,
            stripePriceId,
          },
        });
        // Cupom só para este plano passa a valer também para a versão nova
        const coupons = await tx.coupon.findMany({
          where: { applicablePlans: { not: null } },
          select: { id: true, applicablePlans: true },
        });
        for (const c of coupons) {
          const ids = parsePlanIds(c.applicablePlans);
          if (ids.includes(planId) && !ids.includes(next.id)) {
            await tx.coupon.update({
              where: { id: c.id },
              data: { applicablePlans: JSON.stringify([...ids, next.id]) },
            });
          }
        }
        this.logger.log(`Plano ${planId} com assinantes: versão nova ${next.id} com o preço novo`);
        return next;
      });
    }

    return this.prisma.plan.update({
      where: { id: planId },
      data: {
        name: planData.name ?? undefined,
        description: planData.description ?? undefined,
        price,
        billingCycle,
        features: planData.features ?? undefined,
        stripePriceId,
      },
    });
  }

  /** Assinaturas ativas no plano, ou com troca agendada para ele */
  private inUse(planId: number) {
    return this.prisma.subscription.count({
      where: {
        status: PLANO_STATUS.ACTIVE,
        OR: [{ planId }, { pendingPlanId: planId }],
      },
    });
  }

  /**
   * Tira o plano da lista (não apaga: assinaturas antigas e pagamentos
   * continuam apontando para ele). Com assinatura ativa, ou troca agendada
   * para ele na renovação, não sai.
   */
  async removePlan(planId: number) {
    this.logger.log(`Removing plan with ID: ${planId}`);

    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan || plan.deleted_at) throw new NotFoundException('Plano não encontrado');

    const activeSubscriptions = await this.prisma.subscription.count({
      where: { planId, status: PLANO_STATUS.ACTIVE },
    });
    if (activeSubscriptions > 0) {
      throw new BadRequestException(
        `O plano tem ${activeSubscriptions} assinatura(s) ativa(s) e não pode ser removido`,
      );
    }
    const scheduled = await this.prisma.subscription.count({
      where: { pendingPlanId: planId, status: PLANO_STATUS.ACTIVE },
    });
    if (scheduled > 0) {
      throw new BadRequestException(
        `O plano tem ${scheduled} troca(s) agendada(s) para ele e não pode ser removido`,
      );
    }

    return this.prisma.plan.update({ where: { id: planId }, data: { deleted_at: new Date() } });
  }

  async findAllPlans(): Promise<PlanDTO[]> {
    const plans = await this.prisma.plan.findMany({
      where: { deleted_at: null },
      orderBy: { price: 'asc' },
    });
    return plans.map((plan) => this.convertToDto(plan));
  }

  async findPlanById(planId: number): Promise<PlanDTO> {
    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
    });

    if (!plan) {
      throw new NotFoundException(`Plan with ID ${planId} not found`);
    }

    return this.convertToDto(plan);
  }

  async syncWithStripe() {
    this.logger.log('Syncing plans with Stripe...');

    const plans = await this.prisma.plan.findMany({
      where: { deleted_at: null },
    });

    for (const plan of plans) {
      if (!plan.stripePriceId) {
        try {
          // Criar produto no Stripe
          const stripeProduct = await this.stripeService.createProduct(
            plan.name,
            plan.description || undefined,
          );

          // Criar preço no Stripe
          const recurring = this.getRecurringInterval(plan.billingCycle);
          const stripePrice = await this.stripeService.createPrice(
            stripeProduct.id,
            Math.round(Number(plan.price) * 100),
            'brl',
            recurring,
          );

          // Atualizar plano com o ID do preço do Stripe
          await this.prisma.plan.update({
            where: { id: plan.id },
            data: { stripePriceId: stripePrice.id },
          });

          this.logger.log(`Synced plan ${plan.name} with Stripe price ${stripePrice.id}`);
        } catch (error) {
          this.logger.error(`Failed to sync plan ${plan.name} with Stripe:`, error);
        }
      }
    }
  }

  private getRecurringInterval(billingCycle: string) {
    switch (billingCycle.toUpperCase()) {
      case 'MONTHLY':
        return { interval: 'month' as const };
      case 'YEARLY':
        return { interval: 'year' as const };
      case 'WEEKLY':
        return { interval: 'week' as const };
      case 'DAILY':
        return { interval: 'day' as const };
      default:
        return { interval: 'month' as const };
    }
  }

  private convertToDto(plan: any): PlanDTO {
    return {
      id: plan.id,
      name: plan.name,
      description: plan.description,
      price: plan.price,
      billingCycle: plan.billingCycle,
      features: plan.features,
      stripePriceId: plan.stripePriceId,
    };
  }
}
