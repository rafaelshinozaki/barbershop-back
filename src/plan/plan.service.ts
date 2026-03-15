// src\plan\plan.service.ts
import { Injectable, NotFoundException, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanDTO } from './dto/plan.dto';
import { Prisma } from '@prisma/client';
import { StripeService } from '../stripe/stripe.service';

@Injectable()
export class PlanService {
  private readonly logger = new Logger(PlanService.name);

  constructor(private prisma: PrismaService, private stripeService: StripeService) {}

  async createPlan(planData: PlanDTO) {
    this.logger.log(`Creating plan with name: ${planData.name}`);

    // Criar produto no Stripe
    let stripeProduct: any;
    let stripePrice: any;

    try {
      stripeProduct = await this.stripeService.createProduct(
        planData.name,
        planData.description || undefined,
      );

      // Determinar o intervalo de cobrança
      const recurring = this.getRecurringInterval(planData.billingCycle);

      stripePrice = await this.stripeService.createPrice(
        stripeProduct.id,
        Math.round(Number(planData.price) * 100), // Converter para centavos
        'brl',
        recurring,
      );

      this.logger.log(`Created Stripe product: ${stripeProduct.id} and price: ${stripePrice.id}`);
    } catch (error) {
      this.logger.error('Failed to create Stripe product/price:', error);
      throw new BadRequestException('Failed to create plan in Stripe');
    }

    const prismaPlanData: Prisma.PlanCreateInput = {
      name: planData.name,
      description: planData.description,
      price: planData.price,
      billingCycle: planData.billingCycle,
      features: planData.features,
      stripePriceId: stripePrice.id,
    };

    return await this.prisma.plan.create({
      data: prismaPlanData,
    });
  }

  async updatePlan(planId: number, planData: PlanDTO) {
    this.logger.log(`Updating plan with ID: ${planId}`);

    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
    });

    if (!plan) {
      this.logger.warn(`Plan with ID: ${planId} not found`);
      throw new NotFoundException('Plan not found');
    }

    // Se o preço mudou, criar um novo preço no Stripe
    if (planData.price && Number(planData.price) !== Number(plan.price)) {
      try {
        const recurring = this.getRecurringInterval(planData.billingCycle || plan.billingCycle);

        const newStripePrice = await this.stripeService.createPrice(
          'prod_' + planId, // Assumindo que o produto já existe
          Math.round(Number(planData.price) * 100),
          'brl',
          recurring,
        );

        planData.stripePriceId = newStripePrice.id;
        this.logger.log(`Created new Stripe price: ${newStripePrice.id} for plan ${planId}`);
      } catch (error) {
        this.logger.error('Failed to create new Stripe price:', error);
        throw new BadRequestException('Failed to update plan price in Stripe');
      }
    }

    return await this.prisma.plan.update({
      where: { id: planId },
      data: planData,
    });
  }

  async removePlan(planId: number) {
    this.logger.log(`Removing plan with ID: ${planId}`);

    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
    });

    if (!plan) {
      this.logger.warn(`Plan with ID: ${planId} not found`);
      throw new NotFoundException('Plan not found');
    }

    // Verificar se há assinaturas ativas para este plano
    const activeSubscriptions = await this.prisma.subscription.count({
      where: {
        planId,
        status: 'ACTIVE',
      },
    });

    if (activeSubscriptions > 0) {
      throw new BadRequestException(
        `Cannot delete plan with ${activeSubscriptions} active subscriptions`,
      );
    }

    return await this.prisma.plan.delete({
      where: { id: planId },
    });
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
