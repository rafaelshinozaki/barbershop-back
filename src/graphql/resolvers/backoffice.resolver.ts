import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { BackofficeService } from '../../backoffice/backoffice.service';
import { UserService } from '../../auth/users/users.service';
import {
  BackofficeStats,
  UserGrowthData,
  RoleDistribution,
  StatusDistribution,
  PlanDistribution,
  GeographicAnalysis,
  DemographicAnalysis,
  ProfessionalSegmentAnalysis,
  CompanyAnalysis,
  DetailedUser,
  DetailedUsersResponse,
  BackofficeDashboard,
  OverduePaymentDetail,
  AdminProcessAllRecurringPaymentsResponse,
  AdminProcessRecurringPaymentResponse,
  AdminRecurringPaymentsStats,
  UpcomingPaymentDetail,
  PaginatedCompletedPayments,
} from '../types/backoffice.type';
import {
  UsersDetailedFilters,
  BulkUserAction,
  UpdateUserByAdminInput,
  CompletedPaymentsFilters,
  OverduePaymentsFilters,
  SendEmailNotificationInput,
  EmailHistoryFilters,
  PaginatedEmailHistory,
} from '../dto/backoffice.dto';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { GraphQLRolesGuard } from '../../auth/guards/graphql-roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { Role } from '../../auth/interfaces/roles';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { SmartLogger } from '../../common/logger.util';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentsService } from '../../payments/payments.service';

@Resolver()
export class BackofficeResolver {
  private readonly logger = new SmartLogger('BackofficeResolver');

  constructor(
    private readonly backofficeService: BackofficeService,
    private readonly userService: UserService,
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
  ) {}

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.ADMIN, Role.ADMIN, Role.MANAGER)
  @Query(() => BackofficeStats)
  async backofficeStats() {
    return this.backofficeService.getStats();
  }

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.ADMIN, Role.ADMIN, Role.MANAGER)
  @Query(() => UserGrowthData)
  async userGrowthData() {
    return this.backofficeService.getUserGrowth();
  }

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.ADMIN, Role.ADMIN, Role.MANAGER)
  @Query(() => RoleDistribution)
  async roleDistribution() {
    return this.backofficeService.getRoleDistribution();
  }

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.ADMIN, Role.ADMIN, Role.MANAGER)
  @Query(() => StatusDistribution)
  async statusDistribution() {
    return this.backofficeService.getStatusDistribution();
  }

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.ADMIN, Role.ADMIN, Role.MANAGER)
  @Query(() => PlanDistribution)
  async planDistribution() {
    return this.backofficeService.getPlanDistribution();
  }

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.ADMIN, Role.ADMIN, Role.MANAGER)
  @Query(() => GeographicAnalysis)
  async geographicAnalysis() {
    return this.backofficeService.getGeographicAnalysis();
  }

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.ADMIN, Role.ADMIN, Role.MANAGER)
  @Query(() => DemographicAnalysis)
  async demographicAnalysis() {
    return this.backofficeService.getDemographicAnalysis();
  }

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.ADMIN, Role.ADMIN, Role.MANAGER)
  @Query(() => ProfessionalSegmentAnalysis)
  async professionalSegmentAnalysis() {
    this.logger.log('professionalSegmentAnalysis resolver called');
    try {
      const result = await this.backofficeService.getProfessionalSegmentAnalysis();
      this.logger.log('professionalSegmentAnalysis result:', result);
      return result;
    } catch (error) {
      this.logger.error('Error in professionalSegmentAnalysis resolver:', error);
      throw error;
    }
  }

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.ADMIN, Role.ADMIN, Role.MANAGER)
  @Query(() => CompanyAnalysis)
  async companyAnalysis() {
    return this.backofficeService.getCompanyAnalysis();
  }

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.ADMIN, Role.ADMIN, Role.MANAGER)
  @Query(() => DetailedUsersResponse)
  async usersDetailed(@Args('filters') filters: UsersDetailedFilters) {
    const filtersWithDefaults = {
      page: 1,
      limit: 20,
      ...filters,
    };
    return this.backofficeService.getUsersDetailed(filtersWithDefaults);
  }

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.ADMIN, Role.ADMIN, Role.MANAGER)
  @Query(() => BackofficeDashboard)
  async backofficeDashboard() {
    this.logger.log('backofficeDashboard called');

    try {
      const [stats, userGrowth, roleDistribution, statusDistribution, planDistribution] =
        await Promise.all([
          this.backofficeService.getStats(),
          this.backofficeService.getUserGrowth(),
          this.backofficeService.getRoleDistribution(),
          this.backofficeService.getStatusDistribution(),
          this.backofficeService.getPlanDistribution(),
        ]);

      this.logger.log('All dashboard data retrieved successfully');
      this.logger.logEssential('Stats', stats, ['totalUsers', 'activeUsers', 'newUsersThisMonth']);
      this.logger.logEssential('User growth', userGrowth, ['labels', 'data']);
      this.logger.logEssential('Role distribution', roleDistribution, ['labels', 'data']);

      return {
        stats,
        userGrowth,
        roleDistribution,
        statusDistribution,
        planDistribution,
      };
    } catch (error) {
      this.logger.error('Error in backofficeDashboard', error);
      throw error;
    }
  }

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.ADMIN, Role.ADMIN, Role.MANAGER)
  @Mutation(() => Boolean)
  async bulkUserAction(@Args('input') input: BulkUserAction) {
    switch (input.action) {
      case 'activate':
        await this.userService.setMultipleUsersActive(input.userIds, true);
        break;
      case 'deactivate':
        await this.userService.setMultipleUsersActive(input.userIds, false);
        break;
      case 'changePlan':
        if (input.plan) {
          await this.userService.changeMultipleUsersPlan(input.userIds, input.plan);
        }
        break;
      default:
        throw new Error(`Unknown action: ${input.action}`);
    }
    return true;
  }

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.ADMIN, Role.ADMIN, Role.MANAGER)
  @Mutation(() => Boolean)
  async setUserActive(
    @Args('userId', { type: () => Int }) userId: number,
    @Args('active') active: boolean,
  ) {
    await this.userService.setUserActive(userId, active);
    return true;
  }

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.ADMIN, Role.ADMIN, Role.MANAGER)
  @Mutation(() => Boolean)
  async changeUserPlan(
    @Args('userId', { type: () => Int }) userId: number,
    @Args('plan') plan: string,
  ) {
    await this.userService.changeUserPlan(userId, plan);
    return true;
  }

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.ADMIN, Role.ADMIN, Role.MANAGER)
  @Mutation(() => Boolean)
  async updateUser(@Args('input') input: UpdateUserByAdminInput) {
    const userDto: Partial<UserDTO> = {
      id: input.userId,
    };

    if (input.email !== undefined) userDto.email = input.email;
    if (input.fullName !== undefined) userDto.fullName = input.fullName;
    if (input.phone !== undefined) userDto.phone = input.phone;
    if (input.birthdate !== undefined) userDto.birthdate = new Date(input.birthdate);
    if (input.company !== undefined) userDto.company = input.company;
    if (input.professionalSegment !== undefined)
      userDto.professionalSegment = input.professionalSegment;
    if (input.gender !== undefined) userDto.gender = input.gender;
    if (input.isActive !== undefined) userDto.isActive = input.isActive;
    if (input.twoFactorEnabled !== undefined) userDto.twoFactorEnabled = input.twoFactorEnabled;

    await this.userService.updateUser(userDto as UserDTO);
    return true;
  }

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.ADMIN, Role.ADMIN, Role.MANAGER)
  @Mutation(() => Boolean)
  async removeUser(@Args('userId', { type: () => Int }) userId: number) {
    await this.userService.removeUser(userId);
    return true;
  }

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.ADMIN, Role.ADMIN, Role.MANAGER)
  @Mutation(() => Boolean)
  async sendEmailNotification(@Args('input') input: SendEmailNotificationInput) {
    await this.backofficeService.sendEmailNotification(input);
    return true;
  }

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.ADMIN, Role.ADMIN, Role.MANAGER)
  @Query(() => PaginatedEmailHistory)
  async emailHistory(@Args('filters') filters: EmailHistoryFilters) {
    return this.backofficeService.getEmailHistory(filters);
  }

  private calculateAge(birthdate: Date): number {
    const today = new Date();
    let age = today.getFullYear() - birthdate.getFullYear();
    const monthDiff = today.getMonth() - birthdate.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthdate.getDate())) {
      age--;
    }

    return age;
  }

  private getAgeRange(birthdate: Date): string {
    const age = this.calculateAge(birthdate);

    if (age < 18) return '18-24';
    if (age < 25) return '18-24';
    if (age < 35) return '25-34';
    if (age < 45) return '35-44';
    if (age < 55) return '45-54';
    if (age < 65) return '55-64';
    return '65+';
  }

  @Query(() => [AdminRecurringPaymentsStats])
  async allRecurringPaymentsStats(): Promise<AdminRecurringPaymentsStats[]> {
    this.logger.log('Fetching all recurring payments stats for admin');

    try {
      const overduePayments = await this.prisma.payment.findMany({
        where: {
          nextPaymentDate: {
            lte: new Date(),
          },
          status: 'COMPLETED',
        },
        include: {
          subscription: {
            include: {
              user: {
                select: {
                  id: true,
                  email: true,
                  fullName: true,
                  membership: true,
                },
              },
              plan: {
                select: {
                  id: true,
                  name: true,
                  price: true,
                  billingCycle: true,
                },
              },
            },
          },
        },
        orderBy: {
          nextPaymentDate: 'asc',
        },
      });

      const upcomingPayments = await this.prisma.payment.findMany({
        where: {
          nextPaymentDate: {
            gte: new Date(),
            lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Próximos 7 dias
          },
          status: 'COMPLETED',
        },
        include: {
          subscription: {
            include: {
              user: {
                select: {
                  id: true,
                  email: true,
                  fullName: true,
                  membership: true,
                },
              },
              plan: {
                select: {
                  id: true,
                  name: true,
                  price: true,
                  billingCycle: true,
                },
              },
            },
          },
        },
        orderBy: {
          nextPaymentDate: 'asc',
        },
      });

      return [
        {
          overdueCount: overduePayments.length,
          upcomingCount: upcomingPayments.length,
          lastCheck: new Date().toISOString(),
          timezone: 'America/Sao_Paulo',
          nextScheduledRun: '09:00 AM (diário)',
          overduePayments: overduePayments.map((payment) => ({
            id: payment.id,
            userId: payment.subscription.user.id,
            userEmail: payment.subscription.user.email,
            userName: payment.subscription.user.fullName,
            userMembership: payment.subscription.user.membership,
            hasStripeCustomer: false, // Será calculado se necessário
            planName: payment.subscription.plan.name,
            planPrice: Number(payment.subscription.plan.price),
            planBillingCycle: payment.subscription.plan.billingCycle,
            amount: Number(payment.amount),
            nextPaymentDate: payment.nextPaymentDate.toISOString(),
            daysOverdue: Math.floor(
              (new Date().getTime() - new Date(payment.nextPaymentDate).getTime()) /
                (1000 * 60 * 60 * 24),
            ),
          })),
          upcomingPayments: upcomingPayments.map((payment) => ({
            id: payment.id,
            userId: payment.subscription.user.id,
            userEmail: payment.subscription.user.email,
            userName: payment.subscription.user.fullName,
            userMembership: payment.subscription.user.membership,
            hasStripeCustomer: false, // Será calculado se necessário
            planName: payment.subscription.plan.name,
            planPrice: Number(payment.subscription.plan.price),
            planBillingCycle: payment.subscription.plan.billingCycle,
            amount: Number(payment.amount),
            nextPaymentDate: payment.nextPaymentDate.toISOString(),
            daysUntilPayment: Math.floor(
              (new Date(payment.nextPaymentDate).getTime() - new Date().getTime()) /
                (1000 * 60 * 60 * 24),
            ),
          })),
        },
      ];
    } catch (error) {
      this.logger.error('Error fetching all recurring payments stats:', error);
      throw new Error('Failed to fetch all recurring payments stats');
    }
  }

  @Query(() => [OverduePaymentDetail])
  async allOverduePayments(
    @Args('filters', { nullable: true }) filters?: OverduePaymentsFilters,
  ): Promise<OverduePaymentDetail[]> {
    this.logger.log('Fetching all overdue payments for admin with filters:', filters);

    try {
      // Buscar todos os pagamentos em atraso primeiro
      let payments = await this.prisma.payment.findMany({
        where: {
          nextPaymentDate: {
            lte: new Date(),
          },
          status: 'COMPLETED',
        },
        include: {
          subscription: {
            include: {
              user: {
                select: {
                  id: true,
                  email: true,
                  fullName: true,
                  membership: true,
                  stripeCustomerId: true,
                },
              },
              plan: {
                select: {
                  id: true,
                  name: true,
                  price: true,
                  billingCycle: true,
                },
              },
            },
          },
        },
        orderBy: {
          nextPaymentDate: 'asc',
        },
      });

      // Aplicar filtros no código se necessário
      if (filters) {
        payments = payments.filter((payment) => {
          // Filtro por usuário (nome ou email)
          if (filters.user) {
            const userMatch =
              payment.subscription.user.fullName
                ?.toLowerCase()
                .includes(filters.user.toLowerCase()) ||
              payment.subscription.user.email?.toLowerCase().includes(filters.user.toLowerCase());
            if (!userMatch) return false;
          }

          // Filtro por plano
          if (filters.plan) {
            const planMatch = payment.subscription.plan.name
              ?.toLowerCase()
              .includes(filters.plan.toLowerCase());
            if (!planMatch) return false;
          }

          // Filtro por próximo pagamento (mês/ano)
          if (filters.nextPaymentDateMonth) {
            const paymentDate = new Date(payment.nextPaymentDate);
            const [year, month] = filters.nextPaymentDateMonth.split('-');
            const filterYear = parseInt(year);
            const filterMonth = parseInt(month);

            if (
              paymentDate.getFullYear() !== filterYear ||
              paymentDate.getMonth() + 1 !== filterMonth
            ) {
              return false;
            }
          }

          // Filtro por método de pagamento
          if (filters.paymentMethod) {
            const methodMatch = payment.paymentMethod
              ?.toLowerCase()
              .includes(filters.paymentMethod.toLowerCase());
            if (!methodMatch) return false;
          }

          return true;
        });
      }

      return payments.map((payment) => ({
        id: payment.id,
        userId: payment.subscription.user.id,
        userEmail: payment.subscription.user.email,
        userName: payment.subscription.user.fullName,
        userMembership: payment.subscription.user.membership,
        hasStripeCustomer: !!payment.subscription.user.stripeCustomerId,
        planName: payment.subscription.plan.name,
        planPrice: Number(payment.subscription.plan.price),
        planBillingCycle: payment.subscription.plan.billingCycle,
        amount: Number(payment.amount),
        nextPaymentDate: payment.nextPaymentDate.toISOString(),
        daysOverdue: Math.floor(
          (new Date().getTime() - new Date(payment.nextPaymentDate).getTime()) /
            (1000 * 60 * 60 * 24),
        ),
      }));
    } catch (error) {
      this.logger.error('Error fetching all overdue payments:', error);
      throw new Error('Failed to fetch all overdue payments');
    }
  }

  @Mutation(() => AdminProcessAllRecurringPaymentsResponse)
  async processAllRecurringPaymentsAdmin(): Promise<AdminProcessAllRecurringPaymentsResponse> {
    this.logger.log('Processing all recurring payments for admin');

    try {
      await this.paymentsService.processRecurringPayments();
      return {
        success: true,
        message: 'Todos os pagamentos recorrentes foram processados',
        processedAt: new Date().toISOString(),
        processedCount: 0, // Será calculado pelo serviço
      };
    } catch (error) {
      this.logger.error('Error processing all recurring payments for admin:', error);
      return {
        success: false,
        message: error.message,
        processedAt: new Date().toISOString(),
        processedCount: 0,
      };
    }
  }

  @Mutation(() => AdminProcessRecurringPaymentResponse)
  async processRecurringPaymentAdmin(
    @Args('paymentId', { type: () => Int }) paymentId: number,
  ): Promise<AdminProcessRecurringPaymentResponse> {
    this.logger.log(`Processing recurring payment ${paymentId} for admin`);

    try {
      const result = await this.paymentsService.forceRecurringPayment(paymentId);
      return {
        success: result.success,
        message: result.message,
        processedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Error processing recurring payment ${paymentId} for admin:`, error);
      return {
        success: false,
        message: error.message,
        processedAt: new Date().toISOString(),
      };
    }
  }

  @Query(() => PaginatedCompletedPayments)
  async allCompletedPayments(
    @Args('filters') filters: CompletedPaymentsFilters,
  ): Promise<PaginatedCompletedPayments> {
    this.logger.log(
      `Fetching all completed payments for admin with filters:`,
      JSON.stringify(filters, null, 2),
    );

    try {
      const { page = 1, limit = 10 } = filters;
      const skip = (page - 1) * limit;

      this.logger.log(`Pagination: page=${page}, limit=${limit}, skip=${skip}`);

      // Construir where clause baseada nos filtros - versão simplificada
      const where: any = {
        status: 'COMPLETED',
      };

      this.logger.log('Using simplified where clause:', JSON.stringify(where, null, 2));

      // Log para debug
      this.logger.log('Filtro where para completed payments:', JSON.stringify(where, null, 2));

      // Comentando temporariamente todos os filtros para testar
      // Filtro por data do pagamento (mês/ano)
      // if (filters.paymentDateMonth) {
      //   this.logger.log(`Applying paymentDateMonth filter: ${filters.paymentDateMonth}`);
      //   const [year, month] = filters.paymentDateMonth.split('-');
      //   const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      //   const endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59);

      //   where.paymentDate = {
      //     gte: startDate,
      //     lte: endDate,
      //   };
      // }

      // Filtro por próximo pagamento (mês/ano)
      // if (filters.nextPaymentDateMonth) {
      //   this.logger.log(`Applying nextPaymentDateMonth filter: ${filters.nextPaymentDateMonth}`);
      //   const [year, month] = filters.nextPaymentDateMonth.split('-');
      //   const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      //   const endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59);

      //   where.nextPaymentDate = {
      //     gte: startDate,
      //     lte: endDate,
      //   };
      // }

      // Filtro por status
      // if (filters.status) {
      //   this.logger.log(`Applying status filter: ${filters.status}`);
      //   where.status = filters.status;
      // }

      // Filtro por método de pagamento
      // if (filters.paymentMethod) {
      //   this.logger.log(`Applying paymentMethod filter: ${filters.paymentMethod}`);
      //   where.paymentMethod = filters.paymentMethod;
      // }

      this.logger.log('Executing Prisma query with where clause:', JSON.stringify(where, null, 2));

      // Primeiro, vamos testar uma query mais simples
      this.logger.log('Testing simple query first...');

      try {
        const simplePayments = await this.prisma.payment.findMany({
          where: { status: 'COMPLETED' },
          take: 5,
          include: {
            subscription: {
              include: {
                user: true,
                plan: true,
              },
            },
          },
        });

        this.logger.log(`Simple query found ${simplePayments.length} payments`);

        // Vamos verificar se há planos na base de dados
        const plans = await this.prisma.plan.findMany();
        this.logger.log(`Available plans: ${plans.map((p) => p.name).join(', ')}`);

        if (filters.plan) {
          const planExists = plans.find((p) => p.name === filters.plan);
          this.logger.log(`Plan '${filters.plan}' exists: ${!!planExists}`);
        }
      } catch (simpleError) {
        this.logger.error('Error in simple query:', simpleError);
        throw new Error('Database connection issue');
      }

      let payments, total;
      try {
        // Vamos testar uma query ainda mais simples
        this.logger.log('Testing very simple query...');

        const testPayments = await this.prisma.payment.findMany({
          where: { status: 'COMPLETED' },
          take: 1,
        });

        this.logger.log(`Test query found ${testPayments.length} payments`);

        // Agora vamos testar a query principal
        [payments, total] = await Promise.all([
          this.prisma.payment.findMany({
            where,
            include: {
              subscription: {
                include: {
                  user: {
                    select: {
                      id: true,
                      email: true,
                      fullName: true,
                      membership: true,
                    },
                  },
                  plan: {
                    select: {
                      id: true,
                      name: true,
                      price: true,
                      billingCycle: true,
                    },
                  },
                },
              },
            },
            orderBy: {
              paymentDate: 'desc',
            },
            skip,
            take: limit,
          }),
          this.prisma.payment.count({ where }),
        ]);

        this.logger.log(
          `Query executed successfully. Found ${payments.length} payments, total: ${total}`,
        );
      } catch (queryError) {
        this.logger.error('Error in main query:', queryError.message);
        this.logger.error('Error stack:', queryError.stack?.substring(0, 500));
        throw new Error('Failed to fetch payments from database');
      }

      const totalPages = Math.ceil(total / limit);

      return {
        data: payments.map((payment) => ({
          id: payment.id,
          userId: payment.subscription.user.id,
          userEmail: payment.subscription.user.email,
          userName: payment.subscription.user.fullName,
          userMembership: payment.subscription.user.membership,
          planName: payment.subscription.plan.name,
          planPrice: Number(payment.subscription.plan.price),
          planBillingCycle: payment.subscription.plan.billingCycle,
          amount: Number(payment.amount),
          paymentDate: payment.paymentDate.toISOString(),
          nextPaymentDate: payment.nextPaymentDate.toISOString(),
          paymentMethod: payment.paymentMethod,
          transactionId: payment.transactionId,
          status: payment.status,
          createdAt: payment.createdAt.toISOString(),
          updatedAt: payment.updatedAt.toISOString(),
        })),
        total,
        page,
        limit,
        totalPages,
      };
    } catch (error) {
      this.logger.error('Error fetching all completed payments:', error.message);
      this.logger.error('Error stack:', error.stack?.substring(0, 500));
      throw new Error('Failed to fetch all completed payments');
    }
  }
}
