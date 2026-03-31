import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { PlanService } from '../../plan/plan.service';
import { Plan, Subscription, CreateSubscriptionResponse } from '../types/plan.type';
import { Payment } from '../types/payment.type';
import { CreatePlanInput, UpdatePlanInput, CreateSubscriptionInput } from '../dto/plan.dto';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { GraphQLRolesGuard } from '../../auth/guards/graphql-roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { Role } from '../../auth/interfaces/roles';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeService } from '../../stripe/stripe.service';
import { PLANO_STATUS } from '../../common/contants';

@Resolver(() => Plan)
export class PlanResolver {
  constructor(
    private readonly planService: PlanService,
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
  ) {}

  @Query(() => [Plan])
  async getAllPlans() {
    const plans = await this.prisma.plan.findMany({
      where: { deleted_at: null },
      orderBy: { price: 'asc' },
    });
    return plans.map((plan) => ({
      ...plan,
      createdAt: plan.createdAt?.toISOString() || new Date().toISOString(),
      updatedAt: plan.updatedAt?.toISOString() || new Date().toISOString(),
    }));
  }

  @Query(() => Plan, { nullable: true })
  async getPlanById(@Args('id', { type: () => Int }) id: number) {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
    });

    if (!plan) {
      return null;
    }

    return {
      ...plan,
      createdAt: plan.createdAt?.toISOString() || new Date().toISOString(),
      updatedAt: plan.updatedAt?.toISOString() || new Date().toISOString(),
    };
  }

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  @Mutation(() => Plan)
  async createPlan(@Args('input') input: CreatePlanInput) {
    // Convert CreatePlanInput to PlanDTO format expected by service
    const planData = {
      id: 0, // Will be set by the database
      name: input.name,
      description: input.description,
      price: input.price,
      billingCycle: input.billingCycle,
      features: input.features,
      stripePriceId: input.stripePriceId,
    };
    return this.planService.createPlan(planData);
  }

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  @Mutation(() => Plan)
  async updatePlan(
    @Args('id', { type: () => Int }) id: number,
    @Args('input') input: UpdatePlanInput,
  ) {
    // Convert UpdatePlanInput to PlanDTO format expected by service
    const planData = {
      id: id,
      name: input.name,
      description: input.description,
      price: input.price,
      billingCycle: input.billingCycle,
      features: input.features,
      stripePriceId: input.stripePriceId,
    };
    return this.planService.updatePlan(id, planData);
  }

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  @Mutation(() => Boolean)
  async removePlan(@Args('id', { type: () => Int }) id: number) {
    await this.planService.removePlan(id);
    return true;
  }

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  @Mutation(() => Boolean)
  async syncPlansWithStripe() {
    await this.planService.syncWithStripe();
    return true;
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => [Subscription])
  async mySubscriptions(@CurrentUser() user: UserDTO) {
    const subscriptions = await this.prisma.subscription.findMany({
      where: { userId: user.id },
      include: { plan: true },
    });

    return subscriptions.map((subscription) => ({
      ...subscription,
      startSubDate: subscription.startSubDate.toISOString(),
      cancelationDate: subscription.cancelationDate?.toISOString(),
      createdAt: subscription.createdAt.toISOString(),
      updatedAt: subscription.updatedAt.toISOString(),
      plan: {
        ...subscription.plan,
        price: Number(subscription.plan.price),
        createdAt: subscription.plan.createdAt?.toISOString() || new Date().toISOString(),
        updatedAt: subscription.plan.updatedAt?.toISOString() || new Date().toISOString(),
      },
    }));
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => [Payment])
  async myPayments(@CurrentUser() user: UserDTO) {
    const payments = await this.prisma.payment.findMany({
      where: {
        subscription: {
          userId: user.id,
        },
      },
      include: {
        subscription: {
          include: {
            plan: true,
          },
        },
      },
    });

    return payments.map((payment) => ({
      id: payment.id,
      subscriptionId: payment.subscriptionId,
      amount: Number(payment.amount),
      paymentDate: payment.paymentDate.toISOString(),
      nextPaymentDate: payment.nextPaymentDate.toISOString(),
      paymentMethod: payment.paymentMethod,
      transactionId: payment.transactionId,
      status: payment.status,
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.updatedAt.toISOString(),
    }));
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => CreateSubscriptionResponse)
  async createSubscription(
    @Args('input') input: CreateSubscriptionInput,
    @CurrentUser() user: UserDTO,
  ) {
    try {
      // Buscar o plano
      const plan = await this.prisma.plan.findUnique({
        where: { id: input.planId },
      });

      if (!plan) {
        throw new Error('Plano não encontrado');
      }

      // Verificar se o plano tem um stripePriceId válido
      if (!plan.stripePriceId) {
        throw new Error(
          'Plano não está configurado corretamente no Stripe. Entre em contato com o suporte.',
        );
      }

      // Verificar se o usuário já tem uma assinatura ativa e cancelar automaticamente
      const existingSubscription = await this.prisma.subscription.findFirst({
        where: {
          userId: user.id,
          status: PLANO_STATUS.ACTIVE,
        },
      });

      if (existingSubscription) {
        // Cancelar assinatura anterior no Stripe se tiver stripeSubscriptionId
        if (existingSubscription.stripeSubscriptionId) {
          try {
            await this.stripeService.cancelSubscription(existingSubscription.stripeSubscriptionId);
          } catch (stripeError) {
            console.warn('Erro ao cancelar assinatura no Stripe:', stripeError);
            // Continuar mesmo se falhar no Stripe, pois vamos cancelar no banco
          }
        }

        // Atualizar status no banco
        await this.prisma.subscription.update({
          where: { id: existingSubscription.id },
          data: {
            status: PLANO_STATUS.INACTIVE,
            cancelationDate: new Date(),
          },
        });
      }

      // Buscar ou criar customer no Stripe
      let stripeCustomerId = user.stripeCustomerId;
      if (!stripeCustomerId) {
        const customer = await this.stripeService.createCustomer(
          user.email,
          user.fullName || user.email,
        );
        stripeCustomerId = customer.id;

        // Atualizar usuário com stripeCustomerId
        await this.prisma.user.update({
          where: { id: user.id },
          data: { stripeCustomerId },
        });
      }

      // Criar assinatura no Stripe
      const stripeSubscription = await this.stripeService.createSubscription(
        stripeCustomerId,
        plan.stripePriceId,
        {
          userId: user.id.toString(),
          planId: plan.id.toString(),
        },
      );

      // Criar assinatura no banco
      const subscription = await this.prisma.subscription.create({
        data: {
          userId: user.id,
          planId: plan.id,
          startSubDate: new Date(),
          status: PLANO_STATUS.ACTIVE,
          stripeCustomerId,
          stripeSubscriptionId: stripeSubscription.id,
        },
        include: {
          plan: true,
        },
      });

      return {
        success: true,
        subscription: {
          ...subscription,
          startSubDate: subscription.startSubDate.toISOString(),
          cancelationDate: subscription.cancelationDate?.toISOString(),
          createdAt: subscription.createdAt.toISOString(),
          updatedAt: subscription.updatedAt.toISOString(),
          plan: {
            ...subscription.plan,
            price: Number(subscription.plan.price),
            createdAt: subscription.plan.createdAt?.toISOString() || new Date().toISOString(),
            updatedAt: subscription.plan.updatedAt?.toISOString() || new Date().toISOString(),
          },
        },
        clientSecret:
          typeof stripeSubscription.latest_invoice === 'object' &&
          stripeSubscription.latest_invoice?.payment_intent
            ? (stripeSubscription.latest_invoice.payment_intent as any).client_secret
            : undefined,
      };
    } catch (error) {
      throw new Error(`Erro ao criar assinatura: ${error.message}`);
    }
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  async cancelSubscription(@CurrentUser() user: UserDTO) {
    try {
      // Buscar assinatura ativa do usuário
      const subscription = await this.prisma.subscription.findFirst({
        where: {
          userId: user.id,
          status: PLANO_STATUS.ACTIVE,
        },
      });

      if (!subscription) {
        throw new Error('Nenhuma assinatura ativa encontrada');
      }

      // Cancelar no Stripe se tiver stripeSubscriptionId
      if (subscription.stripeSubscriptionId) {
        await this.stripeService.cancelSubscription(subscription.stripeSubscriptionId);
      }

      // Atualizar status no banco
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: PLANO_STATUS.INACTIVE,
          cancelationDate: new Date(),
        },
      });

      return true;
    } catch (error) {
      throw new Error(`Erro ao cancelar assinatura: ${error.message}`);
    }
  }
}
