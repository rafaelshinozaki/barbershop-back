import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserService } from '../auth/users/users.service';
import { Decimal } from '@prisma/client/runtime/library';
import { TreatmentCategory } from '@prisma/client';
import {
  planIncludesModule,
  getModulesForPlanName,
  getPlanLimits,
  BarbershopModule,
} from './barbershop-plan.constants';
import { PLANO_STATUS } from '../common/contants';
import { S3Service } from '../aws/s3.service';

@Injectable()
export class BarbershopService {
  private readonly logger = new Logger(BarbershopService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly s3Service: S3Service,
  ) {}

  /**
   * Retorna o plano efetivo da barbearia (baseado na assinatura do dono).
   * O dono (ownerUserId) assina o plano; todos (dono + funcionários) acessam os módulos do plano.
   */
  async getBarbershopPlan(barbershopId: number) {
    const barbershop = await this.prisma.barbershop.findUnique({
      where: { id: barbershopId },
      include: {
        ownerUser: {
          include: {
            subscriptions: {
              where: { status: PLANO_STATUS.ACTIVE },
              orderBy: { startSubDate: 'desc' },
              take: 1,
              include: { plan: true },
            },
          },
        },
        network: {
          include: {
            ownerUser: {
              include: {
                subscriptions: {
                  where: { status: PLANO_STATUS.ACTIVE },
                  orderBy: { startSubDate: 'desc' },
                  take: 1,
                  include: { plan: true },
                },
              },
            },
          },
        },
      },
    });
    const ownerUser = barbershop?.ownerUser ?? barbershop?.network?.ownerUser;
    if (!ownerUser) return null;
    const subscription = ownerUser.subscriptions[0];
    return subscription?.plan ?? null;
  }

  /**
   * Verifica se um módulo está disponível para a barbearia conforme o plano do dono.
   */
  async canAccessModule(
    barbershopId: number,
    module: BarbershopModule,
  ): Promise<boolean> {
    const plan = await this.getBarbershopPlan(barbershopId);
    // Sem assinatura ativa = tratado como plano Basic, não como zero acesso —
    // precisa ficar consistente com getAvailableModules().
    return planIncludesModule(plan?.name ?? '', module);
  }

  /** Lança ForbiddenException se o plano da barbearia não incluir o módulo. */
  private async ensureModuleAccess(barbershopId: number, module: BarbershopModule) {
    const allowed = await this.canAccessModule(barbershopId, module);
    if (!allowed) {
      throw new ForbiddenException(
        `Este recurso não está disponível no seu plano atual. Faça upgrade para acessá-lo.`,
      );
    }
  }

  /** Retorna os módulos disponíveis para a barbearia conforme o plano do dono. */
  async getAvailableModules(barbershopId: number): Promise<string[]> {
    const plan = await this.getBarbershopPlan(barbershopId);
    return getModulesForPlanName(plan?.name ?? '');
  }

  /** Retorna os limites numéricos (unidades, profissionais) do plano do dono. */
  async getPlanLimitsForBarbershop(barbershopId: number) {
    const plan = await this.getBarbershopPlan(barbershopId);
    return getPlanLimits(plan?.name ?? '');
  }

  /** Retorna os limites numéricos do plano de um usuário dono de rede (para criar unidade nova). */
  private async getPlanLimitsForOwner(ownerUserId: number) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { userId: ownerUserId, status: PLANO_STATUS.ACTIVE },
      orderBy: { startSubDate: 'desc' },
      include: { plan: true },
    });
    return getPlanLimits(subscription?.plan?.name ?? '');
  }

  /** Lança BadRequestException se a unidade já estiver no limite de profissionais do plano. */
  async ensureBarberLimitNotExceeded(barbershopId: number) {
    const limits = await this.getPlanLimitsForBarbershop(barbershopId);
    const currentCount = await this.prisma.barber.count({
      where: { barbershopId, isActive: true },
    });
    if (currentCount >= limits.maxBarbersPerShop) {
      throw new BadRequestException(
        `Seu plano permite no máximo ${limits.maxBarbersPerShop} profissional(is) por unidade. Faça upgrade para adicionar mais.`,
      );
    }
  }

  private async ensureBarbershopAccess(userId: number, barbershopId: number) {
    const barbershop = await this.prisma.barbershop.findFirst({
      where: { id: barbershopId },
      include: { network: true },
    });
    if (!barbershop) {
      throw new ForbiddenException('Barbearia não encontrada');
    }
    const ownsViaBarbershop = barbershop.ownerUserId === userId;
    const ownsViaNetwork = barbershop.network?.ownerUserId === userId;
    const isBarberInShop = await this.prisma.barber.findFirst({
      where: { barbershopId, userId },
    });
    if (!ownsViaBarbershop && !ownsViaNetwork && !isBarberInShop) {
      throw new ForbiddenException('Você não tem acesso a esta barbearia');
    }
    return barbershop;
  }

  /** Verifica acesso à barbearia (usado por EmployeeInviteService). */
  async verifyBarbershopAccess(userId: number, barbershopId: number) {
    return this.ensureBarbershopAccess(userId, barbershopId);
  }

  /** Encontra ou cria a rede do usuário (uma rede por dono). */
  private async findOrCreateNetwork(userId: number) {
    let network = await this.prisma.network.findFirst({
      where: { ownerUserId: userId },
    });
    if (!network) {
      network = await this.prisma.network.create({
        data: { ownerUserId: userId },
      });
    }
    return network;
  }

  // ============ NETWORK (FRANQUIA) ============

  async getMyNetwork(userId: number) {
    return this.prisma.network.findFirst({
      where: { ownerUserId: userId },
    });
  }

  async updateNetwork(
    userId: number,
    data: Partial<{
      name: string;
      logoUrl: string;
      logoKey: string;
      currency: string;
      city: string;
      description: string;
      mission: string;
      foundationYear: number;
      loyaltyEnabled: boolean;
      loyaltyPointsPerCurrencyUnit: number;
      loyaltyPointValue: number;
    }>,
  ) {
    const network = await this.getMyNetwork(userId);
    if (!network) throw new NotFoundException('Franquia não encontrada');
    const updateData: Record<string, unknown> = { ...data };
    if (data.logoUrl !== undefined) updateData.logoKey = null;
    return this.prisma.network.update({
      where: { id: network.id },
      data: updateData,
    });
  }

  /** Dashboard stats agregados para dono da franquia */
  async getNetworkDashboardStats(userId: number) {
    const barbershops = await this.getMyBarbershops(userId);
    const barbershopIds = barbershops.map((b) => b.id);
    if (barbershopIds.length === 0) {
      return {
        totalBarbers: 0,
        totalBarbershops: 0,
        totalServicesDone: 0,
        totalProductsSold: 0,
        revenueThisMonth: 0,
        currency: 'BRL',
        monthlyRevenue: [],
        recentEvents: [],
      };
    }

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Total barbers (funcionários)
    const totalBarbers = await this.prisma.barber.count({
      where: {
        barbershopId: { in: barbershopIds },
        isActive: true,
      },
    });

    // Serviços realizados (ServiceHistory)
    const totalServicesDone = await this.prisma.serviceHistory.count({
      where: { barbershopId: { in: barbershopIds } },
    });

    // Produtos vendidos (SaleItem onde itemType = PRODUCT)
    const productsSoldResult = await this.prisma.saleItem.aggregate({
      where: {
        itemType: 'PRODUCT',
        sale: { barbershopId: { in: barbershopIds } },
      },
      _sum: { quantity: true },
    });
    const totalProductsSold = productsSoldResult._sum.quantity ?? 0;

    // Faturamento do mês vigente (vendas pagas)
    const revenueThisMonthResult = await this.prisma.sale.aggregate({
      where: {
        barbershopId: { in: barbershopIds },
        paymentStatus: 'PAID',
        createdAt: { gte: startOfMonth },
      },
      _sum: { total: true },
    });
    const revenueThisMonth = Number(revenueThisMonthResult._sum.total ?? 0);

    // Comparativo mensal (últimos 6 meses)
    const monthlyRevenue: {
      month: string;
      monthIndex: number;
      year: number;
      total: number;
    }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
      const r = await this.prisma.sale.aggregate({
        where: {
          barbershopId: { in: barbershopIds },
          paymentStatus: 'PAID',
          createdAt: { gte: start, lte: end },
        },
        _sum: { total: true },
      });
      monthlyRevenue.push({
        month: start.toLocaleDateString('en-US', { month: 'short' }),
        monthIndex: start.getMonth(),
        year: start.getFullYear(),
        total: Number(r._sum.total ?? 0),
      });
    }

    // Últimos eventos (appointments + sales, ordenados por data)
    const [recentAppointments, recentSales] = await Promise.all([
      this.prisma.appointment.findMany({
        where: { barbershopId: { in: barbershopIds } },
        orderBy: { startAt: 'desc' },
        take: 10,
        include: {
          barbershop: { select: { name: true } },
          customer: { select: { name: true } },
          barber: { select: { name: true } },
        },
      }),
      this.prisma.sale.findMany({
        where: {
          barbershopId: { in: barbershopIds },
          paymentStatus: 'PAID',
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          barbershop: { select: { name: true } },
          barber: { select: { name: true } },
        },
      }),
    ]);

    const events: Array<{
      id: string;
      type: string;
      date: Date;
      title: string;
      subtitle?: string;
      value?: number;
      customerName?: string;
      saleId?: number;
    }> = [];

    recentAppointments.forEach((a) => {
      const customerName = a.customer?.name ?? '-';
      events.push({
        id: `apt-${a.id}`,
        type: 'appointment',
        date: a.startAt,
        title: `Agendamento: ${customerName}`,
        subtitle: `${a.barbershop.name} • ${a.barber?.name ?? '-'}`,
        customerName,
      });
    });
    recentSales.forEach((s) => {
      events.push({
        id: `sale-${s.id}`,
        type: 'sale',
        date: s.createdAt,
        title: `Venda #${s.id}`,
        subtitle: `${s.barbershop.name} • ${s.barber?.name ?? '-'}`,
        value: Number(s.total),
        saleId: s.id,
      });
    });

    events.sort((a, b) => b.date.getTime() - a.date.getTime());
    const recentEvents = events.slice(0, 15).map((e) => ({
      ...e,
      date: e.date.toISOString(),
    }));

    return {
      totalBarbers,
      totalBarbershops: barbershops.length,
      totalServicesDone,
      totalProductsSold,
      revenueThisMonth,
      currency: barbershops[0].currency,
      monthlyRevenue,
      recentEvents,
    };
  }

  // ============ BARBERSHOP ============

  async createBarbershop(
    userId: number,
    data: {
      name: string;
      slug: string;
      address: string;
      complement1?: string;
      complement2?: string;
      city: string;
      state: string;
      country: string;
      postalCode: string;
      phone: string;
      email: string;
      timezone?: string;
      currency?: string;
      businessHours?: string;
    },
  ) {
    const existing = await this.prisma.barbershop.findUnique({
      where: { slug: data.slug },
    });
    if (existing) {
      throw new BadRequestException('Já existe uma barbearia com este slug');
    }
    const network = await this.findOrCreateNetwork(userId);
    const limits = await this.getPlanLimitsForOwner(userId);
    const currentCount = await this.prisma.barbershop.count({ where: { networkId: network.id } });
    if (currentCount >= limits.maxBarbershops) {
      throw new BadRequestException(
        `Seu plano permite no máximo ${limits.maxBarbershops} unidade(s). Faça upgrade para cadastrar mais.`,
      );
    }
    const barbershop = await this.prisma.barbershop.create({
      data: {
        ...data,
        timezone: data.timezone ?? 'America/Sao_Paulo',
        currency: data.currency ?? network.currency,
        networkId: network.id,
        ownerUserId: userId,
      },
    });

    const owner = await this.prisma.user.findUnique({ where: { id: userId } });
    if (owner) {
      const alreadyLinked = await this.prisma.barber.findUnique({ where: { userId } });
      await this.prisma.barber.create({
        data: {
          barbershopId: barbershop.id,
          userId: alreadyLinked ? undefined : userId,
          name: owner.fullName,
          phone: owner.phone ?? data.phone,
          email: owner.email,
          staffType: 'barber',
          specialization: 'Proprietário',
        },
      });
    }

    return barbershop;
  }

  async getUserBarbershops(userId: number) {
    return this.getMyBarbershops(userId);
  }

  async getMyBarbershops(userId: number) {
    // Inclui barbearias onde o usuário é dono (direto ou via rede) OU é
    // membro da equipe (Barber) — antes só considerava posse, então
    // managers/employees (ex.: staffType 'manager'/'barber') não viam a
    // barbearia onde trabalham em lugar nenhum da UI, mesmo já tendo acesso
    // de fato via ensureBarbershopAccess (que já checa os três casos).
    return this.prisma.barbershop.findMany({
      where: {
        OR: [
          { ownerUserId: userId },
          { network: { ownerUserId: userId } },
          { barbers: { some: { userId } } },
        ],
      },
      orderBy: { name: 'asc' },
    });
  }

  async getBarbershop(userId: number, id: number) {
    await this.ensureBarbershopAccess(userId, id);
    const barbershop = await this.prisma.barbershop.findUnique({
      where: { id },
    });
    if (!barbershop) throw new NotFoundException('Barbearia não encontrada');
    return barbershop;
  }

  async updateBarbershop(
    userId: number,
    id: number,
    data: Partial<{
      name: string;
      address: string;
      complement1: string;
      complement2: string;
      city: string;
      state: string;
      country: string;
      postalCode: string;
      phone: string;
      email: string;
      timezone: string;
      currency: string;
      businessHours: string;
      isActive: boolean;
    }>,
  ) {
    await this.ensureBarbershopAccess(userId, id);
    return this.prisma.barbershop.update({
      where: { id },
      data,
    });
  }

  async deleteBarbershop(userId: number, id: number) {
    await this.ensureBarbershopAccess(userId, id);
    await this.prisma.barbershop.delete({ where: { id } });
  }

  // ============ CUSTOMER ============

  async createCustomer(
    userId: number,
    barbershopId: number,
    data: {
      name: string;
      phone?: string;
      email?: string;
      birthDate?: Date;
      notes?: string;
    },
  ) {
    const phone = data.phone?.trim();
    const email = data.email?.trim();
    if (!phone && !email) {
      throw new BadRequestException(
        'Informe pelo menos telefone ou email para cadastrar o cliente.',
      );
    }
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId);
    return this.prisma.customer.create({
      data: {
        networkId: barbershop.networkId,
        ...data,
        phone: phone || '(sem telefone)',
        email: email || null,
      },
    });
  }

  async getCustomers(
    userId: number,
    barbershopId: number,
    filters?: { isActive?: boolean; search?: string; limit?: number; offset?: number },
  ) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId);
    const where: any = { networkId: barbershop.networkId };
    if (filters?.isActive !== undefined) where.isActive = filters.isActive;
    if (filters?.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { phone: { contains: filters.search } },
        { email: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.customer.findMany({
      where,
      orderBy: { name: 'asc' },
      take: filters?.limit ?? 50,
      skip: filters?.offset ?? 0,
    });
  }

  async getCustomer(userId: number, barbershopId: number, customerId: number) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId);
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, networkId: barbershop.networkId },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado');
    return customer;
  }

  async updateCustomer(
    userId: number,
    barbershopId: number,
    customerId: number,
    data: Partial<{ name: string; phone: string; email: string; birthDate: Date; notes: string; isActive: boolean }>,
  ) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId);
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, networkId: barbershop.networkId },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado');
    return this.prisma.customer.update({
      where: { id: customerId },
      data,
    });
  }

  async deleteCustomer(userId: number, barbershopId: number, customerId: number) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId);
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, networkId: barbershop.networkId },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado');
    await this.prisma.customer.delete({ where: { id: customerId } });
  }

  // ============ BARBER ============

  async createBarber(
    userId: number,
    barbershopId: number,
    data: {
      name: string;
      phone: string;
      email?: string;
      avatarUrl?: string;
      specialization?: string;
      specialties?: TreatmentCategory[];
      hireDate?: Date;
    },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    await this.ensureBarberLimitNotExceeded(barbershopId);

    const phone = data.phone.trim();
    const existingByPhone = await this.prisma.barber.findFirst({
      where: { barbershopId, phone, isActive: true },
    });
    if (existingByPhone) {
      throw new BadRequestException('Já existe um funcionário com este telefone nesta barbearia');
    }

    if (data.email) {
      const email = data.email.toLowerCase().trim();
      const existingByEmail = await this.prisma.barber.findFirst({
        where: { barbershopId, email, isActive: true },
      });
      if (existingByEmail) {
        throw new BadRequestException('Já existe um funcionário com este email nesta barbearia');
      }
    }

    return this.prisma.barber.create({
      data: { barbershopId, ...data },
    });
  }

  async getBarbers(userId: number, barbershopId: number, activeOnly?: boolean) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const where: any = { barbershopId };
    if (activeOnly) where.isActive = true;
    return this.prisma.barber.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { schedules: true },
    });
  }

  async updateBarber(
    userId: number,
    barbershopId: number,
    barberId: number,
    data: Partial<{ name: string; phone: string; email: string; avatarUrl: string; specialization: string; specialties: TreatmentCategory[]; isActive: boolean }>,
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const barber = await this.prisma.barber.findFirst({
      where: { id: barberId, barbershopId },
    });
    if (!barber) throw new NotFoundException('Barbeiro não encontrado');
    return this.prisma.barber.update({ where: { id: barberId }, data });
  }

  async deleteBarber(userId: number, barbershopId: number, barberId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const barber = await this.prisma.barber.findFirst({
      where: { id: barberId, barbershopId },
    });
    if (!barber) throw new NotFoundException('Barbeiro não encontrado');
    await this.prisma.barber.update({
      where: { id: barberId },
      data: { isActive: false },
    });
  }

  async reactivateBarber(userId: number, barbershopId: number, barberId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const barber = await this.prisma.barber.findFirst({
      where: { id: barberId, barbershopId },
    });
    if (!barber) throw new NotFoundException('Barbeiro não encontrado');
    return this.prisma.barber.update({
      where: { id: barberId },
      data: { isActive: true },
    });
  }

  async requestBarberPasswordReset(userId: number, barbershopId: number, barberId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const barber = await this.prisma.barber.findFirst({
      where: { id: barberId, barbershopId },
      include: { user: true },
    });
    if (!barber) throw new NotFoundException('Barbeiro não encontrado');
    const email = barber.user?.email ?? barber.email;
    if (!email) throw new BadRequestException('Barbeiro não possui email cadastrado');
    const user = await this.prisma.user.findFirst({
      where: { email, provider: 'local' },
    });
    if (!user) throw new BadRequestException('O funcionário ainda não criou a conta. Peça que aceite o convite por email primeiro.');
    await this.userService.forgotPass({ email });
    return true;
  }

  // ============ SERVICES (BarbershopService) ============

  async createService(
    userId: number,
    barbershopId: number,
    data: {
      name: string;
      description?: string;
      durationMinutes: number;
      price: number | Decimal;
      category: TreatmentCategory;
      depositAmount?: number | Decimal | null;
      displayOrder?: number;
    },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const { depositAmount, ...rest } = data;
    return this.prisma.barbershopService.create({
      data: {
        barbershopId,
        ...rest,
        price: new Decimal(data.price),
        depositAmount: depositAmount != null ? new Decimal(depositAmount) : null,
        displayOrder: data.displayOrder ?? 0,
      },
    });
  }

  async getServices(userId: number, barbershopId: number, activeOnly?: boolean) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const where: any = { barbershopId };
    if (activeOnly) where.isActive = true;
    return this.prisma.barbershopService.findMany({
      where,
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async updateService(
    userId: number,
    barbershopId: number,
    serviceId: number,
    data: Partial<{
      name: string;
      description: string;
      durationMinutes: number;
      price: number | Decimal;
      category: TreatmentCategory;
      depositAmount: number | Decimal | null;
      isActive: boolean;
      displayOrder: number;
    }>,
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const price = data.price !== undefined ? new Decimal(data.price) : undefined;
    const depositAmount =
      data.depositAmount !== undefined
        ? data.depositAmount != null
          ? new Decimal(data.depositAmount)
          : null
        : undefined;
    return this.prisma.barbershopService.update({
      where: { id: serviceId },
      data: { ...data, price, depositAmount },
    });
  }

  async deleteService(userId: number, barbershopId: number, serviceId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    await this.prisma.barbershopService.delete({ where: { id: serviceId } });
  }

  // ============ PRODUCT CATEGORIES ============

  async getProductCategories(userId: number, barbershopId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    return this.prisma.productCategory.findMany({
      where: { barbershopId },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async createProductCategory(
    userId: number,
    barbershopId: number,
    data: { name: string; icon?: string; color?: string; displayOrder?: number },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    return this.prisma.productCategory.create({
      data: {
        barbershopId,
        name: data.name.trim(),
        icon: data.icon || null,
        color: data.color || null,
        displayOrder: data.displayOrder ?? 0,
      },
    });
  }

  async updateProductCategory(
    userId: number,
    barbershopId: number,
    categoryId: number,
    data: Partial<{ name: string; icon?: string; color?: string; displayOrder?: number }>,
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    return this.prisma.productCategory.update({
      where: { id: categoryId },
      data: {
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.icon !== undefined && { icon: data.icon || null }),
        ...(data.color !== undefined && { color: data.color || null }),
        ...(data.displayOrder !== undefined && { displayOrder: data.displayOrder }),
      },
    });
  }

  async deleteProductCategory(userId: number, barbershopId: number, categoryId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    await this.prisma.productCategory.delete({ where: { id: categoryId } });
  }

  // ============ PRODUCTS ============

  async createProduct(
    userId: number,
    barbershopId: number,
    data: {
      name: string;
      categoryId?: number;
      sku?: string;
      description?: string;
      salePrice: number | Decimal;
      costPrice?: number | Decimal;
      unit?: string;
      icon?: string;
    },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    return this.prisma.barbershopProduct.create({
      data: {
        barbershopId,
        ...data,
        categoryId: data.categoryId ?? null,
        salePrice: new Decimal(data.salePrice),
        costPrice: data.costPrice ? new Decimal(data.costPrice) : null,
        unit: data.unit ?? 'UNIT',
      },
    });
  }

  async getProducts(userId: number, barbershopId: number, activeOnly?: boolean) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const where: any = { barbershopId };
    if (activeOnly) where.isActive = true;
    return this.prisma.barbershopProduct.findMany({
      where,
      include: { category: true },
      orderBy: { name: 'asc' },
    });
  }

  async updateProduct(
    userId: number,
    barbershopId: number,
    productId: number,
    data: Partial<{
      name: string;
      categoryId: number;
      sku: string;
      description: string;
      salePrice: number | Decimal;
      costPrice: number | Decimal;
      unit: string;
      isActive: boolean;
      icon: string;
    }>,
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const salePrice = data.salePrice !== undefined ? new Decimal(data.salePrice) : undefined;
    const costPrice = data.costPrice !== undefined ? new Decimal(data.costPrice) : undefined;
    const updateData: any = { ...data, salePrice, costPrice };
    if (data.categoryId !== undefined) updateData.categoryId = data.categoryId || null;
    return this.prisma.barbershopProduct.update({
      where: { id: productId },
      data: updateData,
    });
  }

  async deleteProduct(userId: number, barbershopId: number, productId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    await this.prisma.barbershopProduct.delete({ where: { id: productId } });
  }

  // ============ INVENTORY ============

  async getInventory(userId: number, barbershopId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    await this.ensureModuleAccess(barbershopId, 'inventory');
    return this.prisma.inventoryItem.findMany({
      where: { barbershopId },
      include: { product: { include: { category: true } } },
      orderBy: { product: { name: 'asc' } },
    });
  }

  /**
   * Ajuste manual de estoque (compra, contagem, perda...). Diferente da
   * baixa automática de venda (ver createSale), aqui bloqueamos o saldo
   * ficar negativo — é entrada manual, então um erro de digitação não deve
   * silenciosamente deixar o estoque errado.
   */
  async adjustInventory(
    userId: number,
    barbershopId: number,
    data: { productId: number; quantityChange: number; movementType?: string; notes?: string },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    await this.ensureModuleAccess(barbershopId, 'inventory');
    const product = await this.prisma.barbershopProduct.findFirst({
      where: { id: data.productId, barbershopId },
    });
    if (!product) {
      throw new NotFoundException('Produto não encontrado nesta barbearia');
    }
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.inventoryItem.findUnique({
        where: { barbershopId_productId: { barbershopId, productId: data.productId } },
      });
      const quantityBefore = existing ? Number(existing.quantity) : 0;
      const quantityAfter = quantityBefore + data.quantityChange;
      if (quantityAfter < 0) {
        throw new BadRequestException('Estoque não pode ficar negativo');
      }
      const item = existing
        ? await tx.inventoryItem.update({
            where: { id: existing.id },
            data: { quantity: quantityAfter, unit: product.unit },
          })
        : await tx.inventoryItem.create({
            data: {
              barbershopId,
              productId: data.productId,
              quantity: quantityAfter,
              unit: product.unit,
            },
          });
      await tx.inventoryMovement.create({
        data: {
          inventoryItemId: item.id,
          movementType: data.movementType ?? 'ADJUSTMENT',
          quantityChange: data.quantityChange,
          quantityBefore,
          quantityAfter,
          referenceType: 'MANUAL',
          notes: data.notes,
        },
      });
      return tx.inventoryItem.findUnique({
        where: { id: item.id },
        include: { product: { include: { category: true } } },
      });
    });
  }

  async updateInventoryItem(
    userId: number,
    barbershopId: number,
    productId: number,
    data: { minQuantity?: number; location?: string },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    await this.ensureModuleAccess(barbershopId, 'inventory');
    const product = await this.prisma.barbershopProduct.findFirst({
      where: { id: productId, barbershopId },
    });
    if (!product) {
      throw new NotFoundException('Produto não encontrado nesta barbearia');
    }
    return this.prisma.inventoryItem.upsert({
      where: { barbershopId_productId: { barbershopId, productId } },
      create: {
        barbershopId,
        productId,
        quantity: 0,
        unit: product.unit,
        minQuantity: data.minQuantity,
        location: data.location,
      },
      update: {
        ...(data.minQuantity !== undefined && { minQuantity: data.minQuantity }),
        ...(data.location !== undefined && { location: data.location || null }),
      },
      include: { product: { include: { category: true } } },
    });
  }

  async getInventoryMovements(userId: number, barbershopId: number, productId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    await this.ensureModuleAccess(barbershopId, 'inventory');
    const item = await this.prisma.inventoryItem.findUnique({
      where: { barbershopId_productId: { barbershopId, productId } },
    });
    if (!item) return [];
    return this.prisma.inventoryMovement.findMany({
      where: { inventoryItemId: item.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  // ============ BARBER SCHEDULE ============

  async setBarberSchedule(
    userId: number,
    barbershopId: number,
    barberId: number,
    schedules: Array<{
      dayOfWeek: number;
      startTime: string;
      endTime: string;
      breakStart?: string;
      breakEnd?: string;
    }>,
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const barber = await this.prisma.barber.findFirst({
      where: { id: barberId, barbershopId },
    });
    if (!barber) throw new NotFoundException('Barbeiro não encontrado');

    await this.prisma.$transaction([
      this.prisma.barberSchedule.deleteMany({ where: { barberId } }),
      ...schedules.map((s) =>
        this.prisma.barberSchedule.create({
          data: { barberId, ...s },
        }),
      ),
    ]);
    return this.prisma.barberSchedule.findMany({ where: { barberId } });
  }

  async getBarberSchedules(userId: number, barbershopId: number, barberId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    return this.prisma.barberSchedule.findMany({
      where: { barberId, isActive: true },
      orderBy: { dayOfWeek: 'asc' },
    });
  }

  async getBarberSchedulesByBarber(userId: number, barberId: number) {
    const barber = await this.prisma.barber.findUnique({ where: { id: barberId } });
    if (!barber) throw new NotFoundException('Barbeiro não encontrado');
    return this.getBarberSchedules(userId, barber.barbershopId, barberId);
  }

  async createBarberSchedule(
    userId: number,
    input: { barberId: number; dayOfWeek: number; startTime: string; endTime: string; breakStart?: string; breakEnd?: string },
  ) {
    const barber = await this.prisma.barber.findUnique({ where: { id: input.barberId } });
    if (!barber) throw new NotFoundException('Barbeiro não encontrado');
    await this.ensureBarbershopAccess(userId, barber.barbershopId);
    return this.prisma.barberSchedule.create({
      data: { barberId: input.barberId, dayOfWeek: input.dayOfWeek, startTime: input.startTime, endTime: input.endTime, breakStart: input.breakStart, breakEnd: input.breakEnd },
    });
  }

  async updateBarberSchedule(
    userId: number,
    id: number,
    data: { startTime?: string; endTime?: string; breakStart?: string; breakEnd?: string; isActive?: boolean },
  ) {
    const schedule = await this.prisma.barberSchedule.findUnique({ where: { id }, include: { barber: true } });
    if (!schedule) throw new NotFoundException('Horário não encontrado');
    await this.ensureBarbershopAccess(userId, schedule.barber.barbershopId);
    return this.prisma.barberSchedule.update({ where: { id }, data });
  }

  async deleteBarberSchedule(userId: number, id: number) {
    const schedule = await this.prisma.barberSchedule.findUnique({ where: { id }, include: { barber: true } });
    if (!schedule) throw new NotFoundException('Horário não encontrado');
    await this.ensureBarbershopAccess(userId, schedule.barber.barbershopId);
    await this.prisma.barberSchedule.delete({ where: { id } });
  }

  // ============ BARBER TIME OFF ============

  async createBarberTimeOff(
    userId: number,
    input: { barberId: number; startAt: string; endAt: string; reason?: string },
  ) {
    const barber = await this.prisma.barber.findUnique({ where: { id: input.barberId } });
    if (!barber) throw new NotFoundException('Barbeiro não encontrado');
    await this.ensureBarbershopAccess(userId, barber.barbershopId);
    return this.prisma.barberTimeOff.create({
      data: {
        barberId: input.barberId,
        startAt: new Date(input.startAt),
        endAt: new Date(input.endAt),
        reason: input.reason ?? 'PERSONAL',
      },
    });
  }

  async getBarberTimeOffs(userId: number, barbershopId: number, barberId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    return this.prisma.barberTimeOff.findMany({
      where: { barberId },
      orderBy: { startAt: 'desc' },
    });
  }

  async deleteBarberTimeOff(userId: number, timeOffId: number) {
    const timeOff = await this.prisma.barberTimeOff.findUnique({
      where: { id: timeOffId },
      include: { barber: true },
    });
    if (!timeOff) throw new NotFoundException('Afastamento não encontrado');
    await this.ensureBarbershopAccess(userId, timeOff.barber.barbershopId);
    await this.prisma.barberTimeOff.delete({ where: { id: timeOffId } });
    return true;
  }

  async getBarberTimeOffsByBarber(
    userId: number,
    barberId: number,
    filters?: { startAt?: Date; endAt?: Date },
  ) {
    const barber = await this.prisma.barber.findUnique({ where: { id: barberId } });
    if (!barber) throw new NotFoundException('Barbeiro não encontrado');
    await this.ensureBarbershopAccess(userId, barber.barbershopId);
    const where: any = { barberId };
    if (filters?.startAt || filters?.endAt) {
      where.AND = [];
      if (filters.startAt) where.AND.push({ endAt: { gte: filters.startAt } });
      if (filters.endAt) where.AND.push({ startAt: { lte: filters.endAt } });
    }
    return this.prisma.barberTimeOff.findMany({
      where,
      orderBy: { startAt: 'desc' },
    });
  }

  // ============ APPOINTMENTS ============

  private async ensureResourceAvailable(
    barbershopId: number,
    resourceId: number,
    startAt: Date,
    endAt: Date,
    excludeAppointmentId?: number,
  ) {
    const conflict = await this.prisma.appointment.findFirst({
      where: {
        barbershopId,
        resourceId,
        id: excludeAppointmentId ? { not: excludeAppointmentId } : undefined,
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
    });
    if (conflict) {
      throw new BadRequestException('Recurso já reservado nesse horário');
    }
  }

  // Faltava checar conflito por BARBEIRO (só existia para resourceId) — dois
  // agendamentos podiam ser criados para o mesmo profissional no mesmo
  // horário sem nenhum aviso. Usado tanto pelo fluxo de staff quanto pelo
  // agendamento público.
  async ensureBarberAvailable(
    barbershopId: number,
    barberId: number,
    startAt: Date,
    endAt: Date,
    excludeAppointmentId?: number,
  ) {
    const conflict = await this.prisma.appointment.findFirst({
      where: {
        barbershopId,
        barberId,
        id: excludeAppointmentId ? { not: excludeAppointmentId } : undefined,
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
    });
    if (conflict) {
      throw new BadRequestException('Este profissional já tem um agendamento nesse horário');
    }
  }

  async createAppointment(
    userId: number,
    barbershopId: number,
    data: {
      customerId: number;
      barberId: number;
      resourceId?: number;
      startAt: Date;
      endAt: Date;
      status?: string;
      notes?: string;
      source?: string;
      depositAmount?: number;
      depositPaid?: boolean;
      services: Array<{ serviceId: number; quantity?: number; unitPrice: number }>;
    },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    await this.ensureBarberAvailable(barbershopId, data.barberId, data.startAt, data.endAt);
    if (data.resourceId) {
      await this.ensureResourceAvailable(barbershopId, data.resourceId, data.startAt, data.endAt);
    }
    const { services, depositAmount, depositPaid, ...appointmentData } = data;
    // Se nenhum valor de sinal foi informado, usa o sugerido no primeiro
    // serviço (se essa unidade configurou um) — evita a equipe ter que
    // lembrar de repetir o valor toda vez.
    let resolvedDeposit = depositAmount;
    if (resolvedDeposit === undefined && services[0]) {
      const svc = await this.prisma.barbershopService.findUnique({ where: { id: services[0].serviceId } });
      resolvedDeposit = svc?.depositAmount ? Number(svc.depositAmount) : undefined;
    }
    return this.prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.create({
        data: {
          barbershopId,
          ...appointmentData,
          status: appointmentData.status ?? 'CONFIRMED',
          source: appointmentData.source ?? 'PHONE',
          depositAmount: resolvedDeposit != null ? new Decimal(resolvedDeposit) : null,
          depositPaid: depositPaid ?? false,
        },
      });
      await tx.appointmentService.createMany({
        data: services.map((s) => ({
          appointmentId: appointment.id,
          serviceId: s.serviceId,
          quantity: s.quantity ?? 1,
          unitPrice: new Decimal(s.unitPrice),
        })),
      });
      return tx.appointment.findUnique({
        where: { id: appointment.id },
        include: { services: true, customer: true, barber: true },
      });
    });
  }

  async getAppointments(
    userId: number,
    barbershopId: number,
    filters?: {
      barberId?: number;
      customerId?: number;
      status?: string;
      startFrom?: Date;
      startTo?: Date;
      limit?: number;
      offset?: number;
    },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const where: any = { barbershopId };
    if (filters?.barberId) where.barberId = filters.barberId;
    if (filters?.customerId) where.customerId = filters.customerId;
    if (filters?.status) where.status = filters.status;
    if (filters?.startFrom || filters?.startTo) {
      where.startAt = {};
      if (filters.startFrom) where.startAt.gte = filters.startFrom;
      if (filters.startTo) where.startAt.lte = filters.startTo;
    }
    return this.prisma.appointment.findMany({
      where,
      include: { services: { include: { service: true } }, customer: true, barber: true },
      orderBy: { startAt: 'asc' },
      take: filters?.limit ?? 50,
      skip: filters?.offset ?? 0,
    });
  }

  async getNetworkAppointments(
    userId: number,
    filters?: {
      barbershopId?: number;
      status?: string;
      startFrom?: Date;
      startTo?: Date;
    },
  ) {
    const barbershops = await this.getMyBarbershops(userId);
    const allIds = barbershops.map((b) => b.id);
    if (allIds.length === 0) return [];

    const barbershopIds =
      filters?.barbershopId && allIds.includes(filters.barbershopId)
        ? [filters.barbershopId]
        : allIds;

    const where: any = { barbershopId: { in: barbershopIds } };
    if (filters?.status) where.status = filters.status;
    if (filters?.startFrom || filters?.startTo) {
      where.startAt = {};
      if (filters.startFrom) where.startAt.gte = filters.startFrom;
      if (filters.startTo) where.startAt.lte = filters.startTo;
    }
    return this.prisma.appointment.findMany({
      where,
      include: { services: { include: { service: true } }, customer: true, barber: true },
      orderBy: { startAt: 'asc' },
      take: 200,
    });
  }

  async getAppointment(userId: number, barbershopId: number, appointmentId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, barbershopId },
      include: { services: { include: { service: true } }, customer: true, barber: true },
    });
    if (!appointment) throw new NotFoundException('Agendamento não encontrado');
    return appointment;
  }

  async updateAppointment(
    userId: number,
    barbershopId: number,
    appointmentId: number,
    data: Partial<{
      customerId: number;
      barberId: number;
      resourceId: number;
      startAt: Date;
      endAt: Date;
      notes: string;
      status: string;
    }>,
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, barbershopId },
    });
    if (!appointment) throw new NotFoundException('Agendamento não encontrado');
    const barberId = data.barberId ?? appointment.barberId;
    await this.ensureBarberAvailable(
      barbershopId,
      barberId,
      data.startAt ?? appointment.startAt,
      data.endAt ?? appointment.endAt,
      appointmentId,
    );
    const resourceId = data.resourceId ?? appointment.resourceId ?? undefined;
    if (resourceId) {
      await this.ensureResourceAvailable(
        barbershopId,
        resourceId,
        data.startAt ?? appointment.startAt,
        data.endAt ?? appointment.endAt,
        appointmentId,
      );
    }
    return this.prisma.appointment.update({
      where: { id: appointmentId },
      data,
      include: { services: { include: { service: true } }, customer: true, barber: true },
    });
  }

  async deleteAppointment(userId: number, barbershopId: number, appointmentId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, barbershopId },
    });
    if (!appointment) throw new NotFoundException('Agendamento não encontrado');
    await this.prisma.appointment.delete({ where: { id: appointmentId } });
  }

  async updateAppointmentStatus(
    userId: number,
    barbershopId: number,
    appointmentId: number,
    status: string,
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    return this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { status },
    });
  }

  async setAppointmentDepositPaid(
    userId: number,
    barbershopId: number,
    appointmentId: number,
    depositPaid: boolean,
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, barbershopId },
    });
    if (!appointment) throw new NotFoundException('Agendamento não encontrado');
    return this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { depositPaid },
    });
  }

  // ============ PÁGINA PÚBLICA E AGENDAMENTO ONLINE ============

  private readonly DEFAULT_WORKING_HOURS: Record<number, { start: string; end: string } | null> = {
    0: null, // domingo fechado por padrão
    1: { start: '09:00', end: '18:00' },
    2: { start: '09:00', end: '18:00' },
    3: { start: '09:00', end: '18:00' },
    4: { start: '09:00', end: '18:00' },
    5: { start: '09:00', end: '18:00' },
    6: { start: '09:00', end: '17:00' },
  };

  private readonly WEEKDAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  async getPublicBarbershopByslug(slug: string) {
    const barbershop = await this.prisma.barbershop.findUnique({
      where: { slug },
      include: {
        services: { where: { isActive: true }, orderBy: { displayOrder: 'asc' } },
        barbers: { where: { isActive: true }, orderBy: { name: 'asc' } },
      },
    });
    if (!barbershop || !barbershop.isActive) {
      throw new NotFoundException('Unidade não encontrada');
    }
    const imageUrl = barbershop.photoKey ? await this.s3Service.getDownloadUrl(barbershop.photoKey) : null;
    const { averageRating, reviewCount } = await this.getReviewSummary(barbershop.id);
    const isFeatured = barbershop.featuredUntil != null && barbershop.featuredUntil > new Date();
    return { ...barbershop, imageUrl, averageRating, reviewCount, isFeatured };
  }

  // Janela de trabalho de um barbeiro num dia da semana, com fallback em
  // cascata: agenda própria do barbeiro (BarberSchedule) > horário da
  // unidade (Barbershop.businessHours) > horário padrão embutido. Isso
  // porque, na prática, nenhuma unidade configurou nem uma coisa nem outra
  // ainda — sem esse fallback a página pública mostraria "sem horários
  // disponíveis" para toda unidade existente.
  private async getWorkingWindow(
    barbershopId: number,
    barberId: number,
    dayOfWeek: number,
  ): Promise<{ start: string; end: string; breakStart?: string | null; breakEnd?: string | null } | null> {
    const schedule = await this.prisma.barberSchedule.findUnique({
      where: { barberId_dayOfWeek: { barberId, dayOfWeek } },
    });
    if (schedule) {
      if (!schedule.isActive) return null;
      return { start: schedule.startTime, end: schedule.endTime, breakStart: schedule.breakStart, breakEnd: schedule.breakEnd };
    }

    const barbershop = await this.prisma.barbershop.findUnique({
      where: { id: barbershopId },
      select: { businessHours: true },
    });
    if (barbershop?.businessHours) {
      try {
        const parsed = JSON.parse(barbershop.businessHours) as Record<string, { start: string; end: string } | null>;
        const dayHours = parsed[this.WEEKDAY_KEYS[dayOfWeek]];
        return dayHours ? { start: dayHours.start, end: dayHours.end } : null;
      } catch {
        // JSON inválido — cai para o horário padrão abaixo
      }
    }

    const fallback = this.DEFAULT_WORKING_HOURS[dayOfWeek];
    return fallback ? { ...fallback } : null;
  }

  private toMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  }

  async getPublicAvailableSlots(barbershopId: number, barberId: number, serviceId: number, dateStr: string) {
    const [barber, service] = await Promise.all([
      this.prisma.barber.findFirst({ where: { id: barberId, barbershopId, isActive: true } }),
      this.prisma.barbershopService.findFirst({ where: { id: serviceId, barbershopId, isActive: true } }),
    ]);
    if (!barber) throw new NotFoundException('Profissional não encontrado');
    if (!service) throw new NotFoundException('Serviço não encontrado');

    const date = new Date(`${dateStr}T00:00:00`);
    if (isNaN(date.getTime())) throw new BadRequestException('Data inválida');

    const dayOfWeek = date.getDay();
    const window = await this.getWorkingWindow(barbershopId, barberId, dayOfWeek);
    if (!window) return [];

    const duration = service.durationMinutes;
    const dayStart = new Date(date);
    const dayEnd = new Date(date);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const [appointments, timeOffs] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          barberId,
          status: { notIn: ['CANCELLED', 'NO_SHOW'] },
          startAt: { lt: dayEnd },
          endAt: { gt: dayStart },
        },
        select: { startAt: true, endAt: true },
      }),
      this.prisma.barberTimeOff.findMany({
        where: { barberId, startAt: { lt: dayEnd }, endAt: { gt: dayStart } },
        select: { startAt: true, endAt: true },
      }),
    ]);

    const busyRanges = [...appointments, ...timeOffs].map((r) => ({
      start: r.startAt.getTime(),
      end: r.endAt.getTime(),
    }));

    const windowStartMin = this.toMinutes(window.start);
    const windowEndMin = this.toMinutes(window.end);
    const breakStartMin = window.breakStart ? this.toMinutes(window.breakStart) : null;
    const breakEndMin = window.breakEnd ? this.toMinutes(window.breakEnd) : null;

    const now = new Date();
    const slots: string[] = [];
    const SLOT_GRANULARITY_MIN = 15;

    for (let minutes = windowStartMin; minutes + duration <= windowEndMin; minutes += SLOT_GRANULARITY_MIN) {
      if (breakStartMin != null && breakEndMin != null) {
        const overlapsBreak = minutes < breakEndMin && minutes + duration > breakStartMin;
        if (overlapsBreak) continue;
      }

      const slotStart = new Date(date);
      slotStart.setHours(0, minutes, 0, 0);
      const slotEnd = new Date(slotStart.getTime() + duration * 60000);

      if (slotStart <= now) continue;

      const overlapsBusy = busyRanges.some(
        (r) => slotStart.getTime() < r.end && slotEnd.getTime() > r.start,
      );
      if (overlapsBusy) continue;

      slots.push(slotStart.toISOString());
    }

    return slots;
  }

  async createPublicAppointment(input: {
    barbershopId: number;
    barberId: number;
    serviceId: number;
    startAt: string;
    customerName: string;
    customerPhone: string;
    customerEmail?: string;
    notes?: string;
    clientAccountId?: number;
  }) {
    const barbershop = await this.prisma.barbershop.findFirst({
      where: { id: input.barbershopId, isActive: true },
    });
    if (!barbershop) throw new NotFoundException('Unidade não encontrada');

    const [barber, service] = await Promise.all([
      this.prisma.barber.findFirst({ where: { id: input.barberId, barbershopId: input.barbershopId, isActive: true } }),
      this.prisma.barbershopService.findFirst({ where: { id: input.serviceId, barbershopId: input.barbershopId, isActive: true } }),
    ]);
    if (!barber) throw new NotFoundException('Profissional não encontrado');
    if (!service) throw new NotFoundException('Serviço não encontrado');

    const startAt = new Date(input.startAt);
    if (isNaN(startAt.getTime()) || startAt <= new Date()) {
      throw new BadRequestException('Horário inválido');
    }
    const endAt = new Date(startAt.getTime() + service.durationMinutes * 60000);

    // Revalida a janela de trabalho e a ausência de conflito no servidor —
    // nunca confia apenas na lista de horários que o próprio cliente buscou
    // antes (pode estar desatualizada ou ter sido manipulada).
    const window = await this.getWorkingWindow(input.barbershopId, input.barberId, startAt.getDay());
    if (!window) throw new BadRequestException('Profissional não atende nesse dia');
    const startMin = startAt.getHours() * 60 + startAt.getMinutes();
    const endMin = startMin + service.durationMinutes;
    if (startMin < this.toMinutes(window.start) || endMin > this.toMinutes(window.end)) {
      throw new BadRequestException('Horário fora do expediente do profissional');
    }
    if (window.breakStart && window.breakEnd) {
      const breakStartMin = this.toMinutes(window.breakStart);
      const breakEndMin = this.toMinutes(window.breakEnd);
      if (startMin < breakEndMin && endMin > breakStartMin) {
        throw new BadRequestException('Horário cai no intervalo do profissional');
      }
    }
    await this.ensureBarberAvailable(input.barbershopId, input.barberId, startAt, endAt);

    const networkId = barbershop.networkId;
    let customer = await this.prisma.customer.findFirst({
      where: { networkId, phone: input.customerPhone },
    });
    if (!customer) {
      customer = await this.prisma.customer.create({
        data: {
          networkId,
          name: input.customerName,
          phone: input.customerPhone,
          email: input.customerEmail || null,
          clientAccountId: input.clientAccountId ?? null,
        },
      });
    } else if (input.clientAccountId && !customer.clientAccountId) {
      customer = await this.prisma.customer.update({
        where: { id: customer.id },
        data: { clientAccountId: input.clientAccountId },
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.create({
        data: {
          barbershopId: input.barbershopId,
          customerId: customer!.id,
          barberId: input.barberId,
          startAt,
          endAt,
          status: 'CONFIRMED',
          source: 'ONLINE',
          notes: input.notes,
          depositAmount: service.depositAmount,
        },
      });
      await tx.appointmentService.create({
        data: { appointmentId: appointment.id, serviceId: service.id, unitPrice: service.price },
      });
      return tx.appointment.findUnique({
        where: { id: appointment.id },
        include: { barbershop: true, barber: true, services: { include: { service: true } } },
      });
    });
  }

  // ============ BUSCA PÚBLICA (marketplace) ============

  private haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Distinct categories vêm direto dos serviços cadastrados (BarbershopService.category
  // é texto livre hoje — sem uma taxonomia própria ainda) para alimentar o filtro
  // de busca sem precisar de uma lista hardcoded no front.
  async getPublicServiceCategories(): Promise<TreatmentCategory[]> {
    const rows = await this.prisma.barbershopService.findMany({
      where: { isActive: true, barbershop: { isActive: true } },
      select: { category: true },
      distinct: ['category'],
    });
    return rows.map((r) => r.category).sort();
  }

  // Slugifica um nome de cidade pra comparação — remove acento, baixa a caixa,
  // troca não-alfanumérico por hífen. Usado pras páginas de SEO categoria×cidade
  // (/search/:categoria/:cidade): o slug da URL é comparado contra a cidade
  // cadastrada slugificada, em vez de "contains" em texto livre, porque o slug
  // vem sem acento (ex: "sao-jose-dos-campos") e não bateria com "São José dos
  // Campos" num contains case-insensitive comum (Postgres não ignora acento).
  slugifyCity(city: string): string {
    return city
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  async getPublicCities(): Promise<string[]> {
    const rows = await this.prisma.barbershop.findMany({
      where: { isActive: true },
      select: { city: true },
      distinct: ['city'],
    });
    return rows.map((r) => r.city).sort();
  }

  async searchPublicBarbershops(input: {
    query?: string;
    category?: TreatmentCategory;
    city?: string;
    citySlug?: string;
    lat?: number;
    lng?: number;
    limit?: number;
  }) {
    const AND: any[] = [];
    if (input.query) {
      AND.push({
        OR: [
          { name: { contains: input.query, mode: 'insensitive' } },
          { city: { contains: input.query, mode: 'insensitive' } },
        ],
      });
    }
    if (input.city) AND.push({ city: { contains: input.city, mode: 'insensitive' } });
    if (input.category) {
      AND.push({ services: { some: { isActive: true, category: input.category } } });
    }

    const barbershops = await this.prisma.barbershop.findMany({
      where: { isActive: true, ...(AND.length ? { AND } : {}) },
      include: {
        services: { where: { isActive: true }, select: { category: true } },
        network: { select: { name: true } },
      },
      // Sem índice geo no banco — a distância é calculada em memória, então
      // limitamos o conjunto candidato. Suficiente para o volume atual;
      // precisaria de PostGIS (ou similar) numa base muito maior.
      take: 200,
    });

    const now = new Date();
    const candidates = input.citySlug
      ? barbershops.filter((b) => this.slugifyCity(b.city) === input.citySlug)
      : barbershops;

    const results = candidates.map((b) => {
      const categories = [...new Set(b.services.map((s) => s.category))];
      const distanceKm =
        input.lat != null && input.lng != null && b.latitude != null && b.longitude != null
          ? this.haversineKm(input.lat, input.lng, b.latitude, b.longitude)
          : null;
      return {
        id: b.id,
        name: b.name,
        slug: b.slug,
        city: b.city,
        state: b.state,
        address: b.address,
        photoKey: b.photoKey,
        networkName: b.network?.name ?? b.name,
        categories,
        distanceKm,
        isFeatured: b.featuredUntil != null && b.featuredUntil > now,
      };
    });

    // Destaque pago (ativado manualmente pelo admin) sempre aparece primeiro;
    // dentro de cada grupo (destaque / não-destaque) mantém a ordenação normal.
    const rank = (a: (typeof results)[number], b: (typeof results)[number]) => {
      if (input.lat != null && input.lng != null) {
        if (a.distanceKm == null && b.distanceKm == null) return a.name.localeCompare(b.name);
        if (a.distanceKm == null) return 1;
        if (b.distanceKm == null) return -1;
        return a.distanceKm - b.distanceKm;
      }
      return a.name.localeCompare(b.name);
    };
    results.sort((a, b) => {
      if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1;
      return rank(a, b);
    });

    const limited = results.slice(0, input.limit ?? 30);
    const ratings = await this.getReviewSummaries(limited.map((r) => r.id));
    return Promise.all(
      limited.map(async ({ photoKey, ...r }) => ({
        ...r,
        imageUrl: photoKey ? await this.s3Service.getDownloadUrl(photoKey) : null,
        ...(ratings.get(r.id) ?? { averageRating: null, reviewCount: 0 }),
      })),
    );
  }

  // ============ ADMIN: POSICIONAMENTO "DESTAQUE" ============

  async getAdminBarbershops(query?: string) {
    return this.prisma.barbershop.findMany({
      where: query
        ? {
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { city: { contains: query, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: { name: 'asc' },
      take: 100,
    });
  }

  async setBarbershopFeatured(barbershopId: number, featuredUntil: string | null) {
    return this.prisma.barbershop.update({
      where: { id: barbershopId },
      data: { featuredUntil: featuredUntil ? new Date(featuredUntil) : null },
    });
  }

  // ============ AVALIAÇÕES ============

  // Só quem teve pelo menos um atendimento CONCLUÍDO nessa unidade pode
  // avaliar — evita review de quem nunca foi cliente de verdade (ex.:
  // concorrente, ou alguém que só olhou a página pública).
  private async ensureVerifiedCustomer(clientAccountId: number, barbershopId: number) {
    const visit = await this.prisma.appointment.findFirst({
      where: { barbershopId, status: 'COMPLETED', customer: { clientAccountId } },
    });
    if (!visit) {
      throw new ForbiddenException(
        'Você só pode avaliar unidades onde já teve um atendimento concluído.',
      );
    }
  }

  private privacyName(fullName: string): string {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length <= 1) return parts[0] ?? '';
    return `${parts[0]} ${parts[parts.length - 1][0]}.`;
  }

  async createOrUpdateReview(
    clientAccountId: number,
    barbershopId: number,
    rating: number,
    comment?: string,
  ) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new BadRequestException('A nota deve ser um número inteiro entre 1 e 5.');
    }
    await this.ensureVerifiedCustomer(clientAccountId, barbershopId);
    return this.prisma.review.upsert({
      where: { barbershopId_clientAccountId: { barbershopId, clientAccountId } },
      create: { barbershopId, clientAccountId, rating, comment },
      update: { rating, comment },
    });
  }

  async deleteReview(clientAccountId: number, barbershopId: number) {
    await this.prisma.review.deleteMany({ where: { barbershopId, clientAccountId } });
  }

  async getMyReview(clientAccountId: number, barbershopId: number) {
    return this.prisma.review.findUnique({
      where: { barbershopId_clientAccountId: { barbershopId, clientAccountId } },
    });
  }

  async canReviewBarbershop(clientAccountId: number, barbershopId: number): Promise<boolean> {
    const visit = await this.prisma.appointment.findFirst({
      where: { barbershopId, status: 'COMPLETED', customer: { clientAccountId } },
    });
    return Boolean(visit);
  }

  async getBarbershopReviews(barbershopId: number) {
    const reviews = await this.prisma.review.findMany({
      where: { barbershopId },
      include: { clientAccount: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt.toISOString(),
      reviewerName: this.privacyName(r.clientAccount.name),
    }));
  }

  private async getReviewSummaries(
    barbershopIds: number[],
  ): Promise<Map<number, { averageRating: number | null; reviewCount: number }>> {
    const map = new Map<number, { averageRating: number | null; reviewCount: number }>();
    if (barbershopIds.length === 0) return map;
    const groups = await this.prisma.review.groupBy({
      by: ['barbershopId'],
      where: { barbershopId: { in: barbershopIds } },
      _avg: { rating: true },
      _count: true,
    });
    for (const g of groups) {
      map.set(g.barbershopId, { averageRating: g._avg.rating, reviewCount: g._count });
    }
    return map;
  }

  async getReviewSummary(barbershopId: number): Promise<{ averageRating: number | null; reviewCount: number }> {
    const map = await this.getReviewSummaries([barbershopId]);
    return map.get(barbershopId) ?? { averageRating: null, reviewCount: 0 };
  }

  // ============ CARTÃO-PRESENTE ============
  // Emitido e resgatado manualmente pela equipe — sem cobrança online própria
  // (decisão explícita: não integrar Stripe pra pagamentos de cliente do
  // marketplace agora). O código evita caracteres ambíguos (0/O, 1/I) porque
  // é lido em voz alta / digitado por telefone com frequência.

  private generateGiftCardCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return `GIFT-${code}`;
  }

  async createGiftCard(
    userId: number,
    networkId: number,
    data: {
      initialValue: number;
      purchaserName?: string;
      purchaserPhone?: string;
      purchaserEmail?: string;
      recipientName?: string;
      message?: string;
      expiresAt?: Date;
    },
  ) {
    const network = await this.getMyNetwork(userId);
    if (!network || network.id !== networkId) throw new ForbiddenException('Sem acesso a esta rede');
    if (data.initialValue <= 0) {
      throw new BadRequestException('O valor do cartão-presente deve ser maior que zero');
    }

    let code = this.generateGiftCardCode();
    while (await this.prisma.giftCard.findUnique({ where: { code } })) {
      code = this.generateGiftCardCode();
    }

    return this.prisma.giftCard.create({
      data: {
        networkId,
        code,
        initialValue: new Decimal(data.initialValue),
        remainingValue: new Decimal(data.initialValue),
        purchaserName: data.purchaserName,
        purchaserPhone: data.purchaserPhone,
        purchaserEmail: data.purchaserEmail,
        recipientName: data.recipientName,
        message: data.message,
        expiresAt: data.expiresAt,
      },
    });
  }

  async getGiftCards(userId: number, networkId: number) {
    const network = await this.getMyNetwork(userId);
    if (!network || network.id !== networkId) throw new ForbiddenException('Sem acesso a esta rede');
    return this.prisma.giftCard.findMany({ where: { networkId }, orderBy: { createdAt: 'desc' } });
  }

  async setGiftCardActive(userId: number, networkId: number, giftCardId: number, isActive: boolean) {
    const network = await this.getMyNetwork(userId);
    if (!network || network.id !== networkId) throw new ForbiddenException('Sem acesso a esta rede');
    const giftCard = await this.prisma.giftCard.findFirst({ where: { id: giftCardId, networkId } });
    if (!giftCard) throw new NotFoundException('Cartão-presente não encontrado');
    return this.prisma.giftCard.update({ where: { id: giftCardId }, data: { isActive } });
  }

  // Confere se um código é válido/utilizável sem gastar saldo — usado tanto
  // pela pré-visualização no checkout quanto pela validação real dentro de
  // createSale (evita duplicar as regras em dois lugares).
  private async validateGiftCard(barbershopId: number, code: string) {
    const barbershop = await this.prisma.barbershop.findUnique({ where: { id: barbershopId } });
    if (!barbershop) throw new NotFoundException('Unidade não encontrada');
    const giftCard = await this.prisma.giftCard.findUnique({ where: { code: code.trim().toUpperCase() } });
    if (!giftCard || giftCard.networkId !== barbershop.networkId) {
      throw new NotFoundException('Cartão-presente não encontrado');
    }
    if (!giftCard.isActive) throw new BadRequestException('Este cartão-presente está inativo');
    if (giftCard.expiresAt && giftCard.expiresAt < new Date()) {
      throw new BadRequestException('Este cartão-presente expirou');
    }
    if (Number(giftCard.remainingValue) <= 0) {
      throw new BadRequestException('Este cartão-presente não tem saldo restante');
    }
    return giftCard;
  }

  async lookupGiftCard(userId: number, barbershopId: number, code: string) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    return this.validateGiftCard(barbershopId, code);
  }

  // ============ FIDELIDADE ============

  async getCustomerLoyalty(userId: number, barbershopId: number, customerId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const barbershop = await this.prisma.barbershop.findUnique({
      where: { id: barbershopId },
      include: { network: true },
    });
    if (!barbershop) throw new NotFoundException('Unidade não encontrada');
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, networkId: barbershop.networkId },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado');
    const pointValue = barbershop.network.loyaltyPointValue ?? 0;
    return {
      enabled: barbershop.network.loyaltyEnabled,
      points: customer.loyaltyPoints,
      pointValue,
      redeemableValue: customer.loyaltyPoints * pointValue,
    };
  }

  // ============ WALK-INS (Queue) ============

  async createWalkIn(
    userId: number,
    barbershopId: number,
    data: {
      customerId?: number;
      barberId?: number;
      customerName: string;
      customerPhone?: string;
      services: Array<{ serviceId: number; quantity?: number; notes?: string }>;
    },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const maxPos = await this.prisma.walkIn.aggregate({
      where: { barbershopId, status: 'WAITING' },
      _max: { queuePosition: true },
    });
    const queuePosition = (maxPos._max.queuePosition ?? 0) + 1;

    return this.prisma.$transaction(async (tx) => {
      const walkIn = await tx.walkIn.create({
        data: {
          barbershopId,
          customerId: data.customerId,
          barberId: data.barberId,
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          queuePosition,
        },
      });
      await tx.walkInService.createMany({
        data: data.services.map((s) => ({
          walkInId: walkIn.id,
          serviceId: s.serviceId,
          quantity: s.quantity ?? 1,
          notes: s.notes,
        })),
      });
      return tx.walkIn.findUnique({
        where: { id: walkIn.id },
        include: { services: { include: { service: true } }, customer: true, barber: true },
      });
    });
  }

  async getWalkIns(
    userId: number,
    barbershopId: number,
    filters?: { status?: string; limit?: number; offset?: number },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const where: any = { barbershopId };
    if (filters?.status) where.status = filters.status;
    return this.prisma.walkIn.findMany({
      where,
      include: { services: { include: { service: true } }, customer: true, barber: true },
      orderBy: [{ status: 'asc' }, { queuePosition: 'asc' }],
      take: filters?.limit ?? 50,
      skip: filters?.offset ?? 0,
    });
  }

  async getWalkInQueue(userId: number, barbershopId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    return this.prisma.walkIn.findMany({
      where: { barbershopId, status: 'WAITING' },
      include: { services: { include: { service: true } }, customer: true, barber: true },
      orderBy: { queuePosition: 'asc' },
    });
  }

  async updateWalkInStatus(
    userId: number,
    barbershopId: number,
    walkInId: number,
    status: string,
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const data: any = { status };
    if (status === 'IN_PROGRESS') data.servedAt = new Date();
    return this.prisma.walkIn.update({
      where: { id: walkInId },
      data,
    });
  }

  // ============ SERVICE HISTORY ============

  async getCustomerServiceHistory(
    userId: number,
    barbershopId: number,
    customerId: number,
    limit?: number,
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    return this.prisma.serviceHistory.findMany({
      where: { barbershopId, customerId },
      include: { service: true, barber: true },
      orderBy: { performedAt: 'desc' },
      take: limit ?? 50,
    });
  }

  // ============ SALES ============

  async createSale(
    userId: number,
    barbershopId: number,
    data: {
      customerId?: number;
      barberId?: number;
      appointmentId?: number;
      saleType: string;
      items: Array<{
        itemType: string;
        serviceId?: number;
        productId?: number;
        serviceHistoryId?: number;
        quantity: number;
        unitPrice: number;
        totalPrice: number;
        notes?: string;
      }>;
      subtotal: number;
      discountAmount?: number;
      taxAmount?: number;
      total: number;
      paymentStatus?: string;
      paymentMethod?: string;
      giftCardCode?: string;
      loyaltyPointsRedeemed?: number;
    },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const discount = data.discountAmount ?? 0;
    const tax = data.taxAmount ?? 0;

    const barbershop = await this.prisma.barbershop.findUnique({
      where: { id: barbershopId },
      include: { network: true },
    });

    // O cartão-presente e o resgate de pontos são calculados e validados no
    // servidor (nunca confiamos no valor que o front manda) e descontados
    // em cima do total já calculado pelo front (subtotal - desconto + imposto)
    // — dois mecanismos de desconto independentes, não substituem um ao outro.
    let giftCard: { id: number; remainingValue: any } | null = null;
    let giftCardAmountApplied = 0;
    if (data.giftCardCode) {
      giftCard = await this.validateGiftCard(barbershopId, data.giftCardCode);
      giftCardAmountApplied = Math.min(Number(giftCard.remainingValue), data.total);
    }

    let loyaltyDiscountAmount = 0;
    if (data.loyaltyPointsRedeemed && data.loyaltyPointsRedeemed > 0) {
      if (!data.customerId) {
        throw new BadRequestException('Selecione um cliente para resgatar pontos de fidelidade');
      }
      const customerForRedemption = await this.prisma.customer.findUnique({ where: { id: data.customerId } });
      if (!customerForRedemption) throw new NotFoundException('Cliente não encontrado');
      if (customerForRedemption.loyaltyPoints < data.loyaltyPointsRedeemed) {
        throw new BadRequestException('Cliente não tem pontos de fidelidade suficientes');
      }
      const pointValue = barbershop?.network.loyaltyPointValue ?? 0;
      loyaltyDiscountAmount = data.loyaltyPointsRedeemed * pointValue;
    }

    const finalTotal = Math.max(0, data.total - giftCardAmountApplied - loyaltyDiscountAmount);

    // Vincula a venda ao caixa aberto no momento, se houver um — é o que
    // permite reconciliar o fechamento de caixa depois (ver
    // closeCashSession). Uma venda feita sem caixa aberto simplesmente não
    // entra na conferência de dinheiro físico, mas continua contando no
    // dashboard financeiro (que não depende de sessão de caixa).
    const openSession = await this.prisma.cashSession.findFirst({
      where: { barbershopId, status: 'OPEN' },
    });
    return this.prisma.$transaction(async (tx) => {
      const sale = await tx.sale.create({
        data: {
          barbershopId,
          customerId: data.customerId,
          barberId: data.barberId,
          appointmentId: data.appointmentId,
          cashSessionId: openSession?.id,
          saleType: data.saleType,
          subtotal: new Decimal(data.subtotal),
          discountAmount: new Decimal(discount),
          taxAmount: new Decimal(tax),
          total: new Decimal(finalTotal),
          paymentStatus: data.paymentStatus ?? 'PENDING',
          paymentMethod: data.paymentMethod,
          paidAt: data.paymentStatus === 'PAID' ? new Date() : null,
          giftCardId: giftCard?.id,
          giftCardAmountApplied: giftCard ? new Decimal(giftCardAmountApplied) : null,
          loyaltyPointsRedeemed: data.loyaltyPointsRedeemed || null,
          loyaltyDiscountAmount: loyaltyDiscountAmount > 0 ? new Decimal(loyaltyDiscountAmount) : null,
        },
      });

      if (giftCard) {
        await tx.giftCard.update({
          where: { id: giftCard.id },
          data: { remainingValue: { decrement: giftCardAmountApplied } },
        });
      }
      if (data.loyaltyPointsRedeemed && data.customerId) {
        await tx.customer.update({
          where: { id: data.customerId },
          data: { loyaltyPoints: { decrement: data.loyaltyPointsRedeemed } },
        });
      }

      // Concede pontos de fidelidade só quando a venda já está paga — evita
      // dar crédito por algo que ainda pode não se concretizar (PENDING).
      if (
        data.paymentStatus === 'PAID' &&
        data.customerId &&
        barbershop?.network.loyaltyEnabled &&
        barbershop.network.loyaltyPointsPerCurrencyUnit
      ) {
        const pointsEarned = Math.floor(finalTotal * barbershop.network.loyaltyPointsPerCurrencyUnit);
        if (pointsEarned > 0) {
          await tx.customer.update({
            where: { id: data.customerId },
            data: { loyaltyPoints: { increment: pointsEarned } },
          });
          await tx.sale.update({ where: { id: sale.id }, data: { loyaltyPointsEarned: pointsEarned } });
        }
      }
      await tx.saleItem.createMany({
        data: data.items.map((item) => ({
          saleId: sale.id,
          itemType: item.itemType,
          serviceId: item.serviceId,
          productId: item.productId,
          serviceHistoryId: item.serviceHistoryId,
          quantity: item.quantity,
          unitPrice: new Decimal(item.unitPrice),
          totalPrice: new Decimal(item.totalPrice),
          notes: item.notes,
        })),
      });

      // Baixa automática de estoque para itens de produto. Diferente do
      // ajuste manual (adjustInventory), aqui NÃO bloqueamos saldo negativo:
      // a venda já aconteceu e o caixa não pode travar por causa de estoque
      // desatualizado — o item simplesmente fica negativo, sinalizando que
      // a contagem física precisa ser conferida.
      for (const item of data.items) {
        if (item.itemType !== 'PRODUCT' || !item.productId) continue;
        const product = await tx.barbershopProduct.findUnique({ where: { id: item.productId } });
        if (!product) continue;
        const existing = await tx.inventoryItem.findUnique({
          where: { barbershopId_productId: { barbershopId, productId: item.productId } },
        });
        const quantityBefore = existing ? Number(existing.quantity) : 0;
        const quantityChange = -item.quantity;
        const quantityAfter = quantityBefore + quantityChange;
        const inventoryItem = existing
          ? await tx.inventoryItem.update({
              where: { id: existing.id },
              data: { quantity: quantityAfter },
            })
          : await tx.inventoryItem.create({
              data: {
                barbershopId,
                productId: item.productId,
                quantity: quantityAfter,
                unit: product.unit,
              },
            });
        await tx.inventoryMovement.create({
          data: {
            inventoryItemId: inventoryItem.id,
            movementType: 'SALE',
            quantityChange,
            quantityBefore,
            quantityAfter,
            referenceType: 'SALE',
            referenceId: String(sale.id),
          },
        });
      }

      return tx.sale.findUnique({
        where: { id: sale.id },
        include: { items: true, customer: true, barber: true },
      });
    });
  }

  async getSales(
    userId: number,
    barbershopId: number,
    filters?: {
      customerId?: number;
      barberId?: number;
      paymentStatus?: string;
      from?: Date;
      to?: Date;
      limit?: number;
      offset?: number;
    },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const where: any = { barbershopId };
    if (filters?.customerId) where.customerId = filters.customerId;
    if (filters?.barberId) where.barberId = filters.barberId;
    if (filters?.paymentStatus) where.paymentStatus = filters.paymentStatus;
    if (filters?.from || filters?.to) {
      where.createdAt = {};
      if (filters.from) where.createdAt.gte = filters.from;
      if (filters.to) where.createdAt.lte = filters.to;
    }
    const sales = await this.prisma.sale.findMany({
      where,
      include: {
        items: { include: { service: true, product: true } },
        customer: true,
        barber: true,
      },
      orderBy: { createdAt: 'desc' },
      take: filters?.limit ?? 50,
      skip: filters?.offset ?? 0,
    });
    return sales.map((s) => ({
      ...s,
      customerName: (s.customer as any)?.name ?? null,
      barberName: (s.barber as any)?.name ?? null,
      items: s.items.map((item) => ({
        ...item,
        productName: (item.product as any)?.name ?? null,
        serviceName: (item.service as any)?.name ?? null,
      })),
    }));
  }

  async updateSale(
    userId: number,
    barbershopId: number,
    saleId: number,
    data: {
      customerId?: number;
      barberId?: number;
      saleType?: string;
      items?: Array<{
        itemType: string;
        serviceId?: number;
        productId?: number;
        serviceHistoryId?: number;
        quantity: number;
        unitPrice: number;
        totalPrice: number;
        notes?: string;
      }>;
      subtotal?: number;
      discountAmount?: number;
      taxAmount?: number;
      total?: number;
      paymentStatus?: string;
      paymentMethod?: string;
    },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.sale.findFirst({
        where: { id: saleId, barbershopId },
      });
      if (!existing) throw new BadRequestException('Venda não encontrada');

      const updateData: any = {};
      if (data.customerId !== undefined) updateData.customerId = data.customerId;
      if (data.barberId !== undefined) updateData.barberId = data.barberId;
      if (data.saleType !== undefined) updateData.saleType = data.saleType;
      if (data.subtotal !== undefined) updateData.subtotal = new Decimal(data.subtotal);
      if (data.discountAmount !== undefined) updateData.discountAmount = new Decimal(data.discountAmount);
      if (data.taxAmount !== undefined) updateData.taxAmount = new Decimal(data.taxAmount);
      if (data.total !== undefined) updateData.total = new Decimal(data.total);
      if (data.paymentStatus !== undefined) {
        updateData.paymentStatus = data.paymentStatus;
        if (data.paymentStatus === 'PAID' && existing.paymentStatus !== 'PAID') {
          updateData.paidAt = new Date();
        }
      }
      if (data.paymentMethod !== undefined) updateData.paymentMethod = data.paymentMethod;

      await tx.sale.update({ where: { id: saleId }, data: updateData });

      if (data.items) {
        await tx.saleItem.deleteMany({ where: { saleId } });
        await tx.saleItem.createMany({
          data: data.items.map((item) => ({
            saleId,
            itemType: item.itemType,
            serviceId: item.serviceId,
            productId: item.productId,
            serviceHistoryId: item.serviceHistoryId,
            quantity: item.quantity,
            unitPrice: new Decimal(item.unitPrice),
            totalPrice: new Decimal(item.totalPrice),
            notes: item.notes,
          })),
        });
      }

      return tx.sale.findUnique({
        where: { id: saleId },
        include: { items: true, customer: true, barber: true },
      });
    });
  }

  async deleteSale(userId: number, barbershopId: number, saleId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const existing = await this.prisma.sale.findFirst({
      where: { id: saleId, barbershopId },
    });
    if (!existing) throw new BadRequestException('Venda não encontrada');
    await this.prisma.sale.delete({ where: { id: saleId } });
    return true;
  }

  // ============ CASH SESSION ============

  async getCurrentCashSession(userId: number, barbershopId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const session = await this.prisma.cashSession.findFirst({
      where: { barbershopId, status: 'OPEN' },
      include: { openedBy: true, closedBy: true },
    });
    return session ? this.toCashSessionResult(session) : null;
  }

  async getCashSessions(userId: number, barbershopId: number, limit = 30) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const sessions = await this.prisma.cashSession.findMany({
      where: { barbershopId },
      include: { openedBy: true, closedBy: true },
      orderBy: { openedAt: 'desc' },
      take: limit,
    });
    return sessions.map((s) => this.toCashSessionResult(s));
  }

  async openCashSession(userId: number, barbershopId: number, openingBalance: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const existing = await this.prisma.cashSession.findFirst({
      where: { barbershopId, status: 'OPEN' },
    });
    if (existing) {
      throw new BadRequestException('Já existe um caixa aberto para esta barbearia');
    }
    const session = await this.prisma.cashSession.create({
      data: {
        barbershopId,
        openedByUserId: userId,
        openingBalance: new Decimal(openingBalance),
      },
      include: { openedBy: true, closedBy: true },
    });
    return this.toCashSessionResult(session);
  }

  /**
   * expectedBalance considera só transações em dinheiro (CASH) — cartão e
   * Pix não afetam o dinheiro físico na gaveta, que é o que essa conferência
   * existe pra checar.
   */
  async closeCashSession(
    userId: number,
    barbershopId: number,
    data: { countedBalance: number; notes?: string },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const session = await this.prisma.cashSession.findFirst({
      where: { barbershopId, status: 'OPEN' },
    });
    if (!session) {
      throw new NotFoundException('Nenhum caixa aberto para esta barbearia');
    }
    const [cashSales, cashExpenses] = await Promise.all([
      this.prisma.sale.aggregate({
        where: {
          cashSessionId: session.id,
          paymentMethod: 'CASH',
          paymentStatus: 'PAID',
        },
        _sum: { total: true },
      }),
      this.prisma.expense.aggregate({
        where: { cashSessionId: session.id, paymentMethod: 'CASH' },
        _sum: { amount: true },
      }),
    ]);
    const openingBalance = Number(session.openingBalance);
    const cashIn = Number(cashSales._sum.total ?? 0);
    const cashOut = Number(cashExpenses._sum.amount ?? 0);
    const expectedBalance = openingBalance + cashIn - cashOut;
    const difference = data.countedBalance - expectedBalance;
    const updated = await this.prisma.cashSession.update({
      where: { id: session.id },
      data: {
        closedByUserId: userId,
        closedAt: new Date(),
        countedBalance: new Decimal(data.countedBalance),
        expectedBalance: new Decimal(expectedBalance),
        difference: new Decimal(difference),
        status: 'CLOSED',
        notes: data.notes,
      },
      include: { openedBy: true, closedBy: true },
    });
    return this.toCashSessionResult(updated);
  }

  private toCashSessionResult(session: any) {
    return {
      ...session,
      openedByName: session.openedBy?.fullName ?? null,
      closedByName: session.closedBy?.fullName ?? null,
    };
  }

  // ============ EXPENSES ============

  async createExpense(
    userId: number,
    barbershopId: number,
    data: {
      category: string;
      description: string;
      amount: number;
      paymentMethod?: string;
      expenseDate?: string;
    },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const openSession = await this.prisma.cashSession.findFirst({
      where: { barbershopId, status: 'OPEN' },
    });
    const expense = await this.prisma.expense.create({
      data: {
        barbershopId,
        cashSessionId: openSession?.id,
        category: data.category,
        description: data.description,
        amount: new Decimal(data.amount),
        paymentMethod: data.paymentMethod,
        expenseDate: data.expenseDate ? new Date(data.expenseDate) : new Date(),
        createdByUserId: userId,
      },
      include: { createdBy: true },
    });
    return { ...expense, createdByName: expense.createdBy?.fullName ?? null };
  }

  async getExpenses(
    userId: number,
    barbershopId: number,
    filters?: { from?: Date; to?: Date; category?: string },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const where: any = { barbershopId };
    if (filters?.category) where.category = filters.category;
    if (filters?.from || filters?.to) {
      where.expenseDate = {};
      if (filters.from) where.expenseDate.gte = filters.from;
      if (filters.to) where.expenseDate.lte = filters.to;
    }
    const expenses = await this.prisma.expense.findMany({
      where,
      include: { createdBy: true },
      orderBy: { expenseDate: 'desc' },
    });
    return expenses.map((e) => ({ ...e, createdByName: e.createdBy?.fullName ?? null }));
  }

  async deleteExpense(userId: number, barbershopId: number, expenseId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const existing = await this.prisma.expense.findFirst({
      where: { id: expenseId, barbershopId },
    });
    if (!existing) throw new NotFoundException('Despesa não encontrada');
    await this.prisma.expense.delete({ where: { id: expenseId } });
    return true;
  }

  // ============ FINANCIAL DASHBOARD ============

  async getFinancialSummary(userId: number, barbershopId: number, from: Date, to: Date) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const [sales, expenses] = await Promise.all([
      this.prisma.sale.findMany({
        where: {
          barbershopId,
          paymentStatus: 'PAID',
          createdAt: { gte: from, lte: to },
        },
        select: { total: true, paymentMethod: true, createdAt: true },
      }),
      this.prisma.expense.findMany({
        where: { barbershopId, expenseDate: { gte: from, lte: to } },
        select: { amount: true, category: true },
      }),
    ]);

    const totalRevenue = sales.reduce((sum, s) => sum + Number(s.total), 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

    const byMethod = new Map<string, number>();
    sales.forEach((s) => {
      const key = s.paymentMethod ?? 'UNKNOWN';
      byMethod.set(key, (byMethod.get(key) ?? 0) + Number(s.total));
    });

    const byCategory = new Map<string, number>();
    expenses.forEach((e) => {
      byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + Number(e.amount));
    });

    const byDay = new Map<string, number>();
    sales.forEach((s) => {
      const key = s.createdAt.toISOString().slice(0, 10); // YYYY-MM-DD
      byDay.set(key, (byDay.get(key) ?? 0) + Number(s.total));
    });
    const sortedDays = Array.from(byDay.keys()).sort();

    return {
      totalRevenue,
      totalExpenses,
      netProfit: totalRevenue - totalExpenses,
      revenueByPaymentMethod: Array.from(byMethod.entries()).map(([category, total]) => ({
        category,
        total,
      })),
      expensesByCategory: Array.from(byCategory.entries()).map(([category, total]) => ({
        category,
        total,
      })),
      revenueByDay: {
        labels: sortedDays,
        data: sortedDays.map((d) => byDay.get(d) ?? 0),
      },
    };
  }

  // ============ RESOURCES ============

  async getResources(userId: number, barbershopId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    return this.prisma.resource.findMany({
      where: { barbershopId },
      orderBy: { name: 'asc' },
    });
  }

  async createResource(userId: number, barbershopId: number, data: { name: string; type?: string }) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    return this.prisma.resource.create({
      data: { barbershopId, name: data.name, type: data.type ?? 'ROOM' },
    });
  }

  async updateResource(
    userId: number,
    barbershopId: number,
    resourceId: number,
    data: Partial<{ name: string; type: string; isActive: boolean }>,
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const resource = await this.prisma.resource.findFirst({ where: { id: resourceId, barbershopId } });
    if (!resource) throw new NotFoundException('Recurso não encontrado');
    return this.prisma.resource.update({ where: { id: resourceId }, data });
  }

  async deleteResource(userId: number, barbershopId: number, resourceId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const resource = await this.prisma.resource.findFirst({ where: { id: resourceId, barbershopId } });
    if (!resource) throw new NotFoundException('Recurso não encontrado');
    await this.prisma.resource.delete({ where: { id: resourceId } });
    return true;
  }

  // ============ PACOTES DE SESSÃO ============

  async getServicePackages(userId: number, barbershopId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const packages = await this.prisma.servicePackage.findMany({
      where: { barbershopId },
      include: { service: true },
      orderBy: { name: 'asc' },
    });
    return packages.map((p) => ({ ...p, serviceName: p.service?.name ?? null }));
  }

  async createServicePackage(
    userId: number,
    barbershopId: number,
    data: { serviceId: number; name: string; totalSessions: number; price: number },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    await this.ensureModuleAccess(barbershopId, 'packages');
    const service = await this.prisma.barbershopService.findFirst({
      where: { id: data.serviceId, barbershopId },
    });
    if (!service) throw new NotFoundException('Serviço não encontrado');
    const pkg = await this.prisma.servicePackage.create({
      data: {
        barbershopId,
        serviceId: data.serviceId,
        name: data.name,
        totalSessions: data.totalSessions,
        price: new Decimal(data.price),
      },
      include: { service: true },
    });
    return { ...pkg, serviceName: pkg.service?.name ?? null };
  }

  async updateServicePackage(
    userId: number,
    barbershopId: number,
    id: number,
    data: Partial<{ name: string; totalSessions: number; price: number; isActive: boolean }>,
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const pkg = await this.prisma.servicePackage.findFirst({ where: { id, barbershopId } });
    if (!pkg) throw new NotFoundException('Pacote não encontrado');
    const { price, ...rest } = data;
    const updated = await this.prisma.servicePackage.update({
      where: { id },
      data: { ...rest, price: price != null ? new Decimal(price) : undefined },
      include: { service: true },
    });
    return { ...updated, serviceName: updated.service?.name ?? null };
  }

  async deleteServicePackage(userId: number, barbershopId: number, id: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const pkg = await this.prisma.servicePackage.findFirst({ where: { id, barbershopId } });
    if (!pkg) throw new NotFoundException('Pacote não encontrado');
    await this.prisma.servicePackage.update({ where: { id }, data: { isActive: false } });
    return true;
  }

  // ============ PACOTES DO CLIENTE ============

  private toClientPackageResult(cp: any) {
    return {
      ...cp,
      servicePackageName: cp.servicePackage?.name ?? null,
      serviceName: cp.servicePackage?.service?.name ?? null,
    };
  }

  async purchaseClientPackage(
    userId: number,
    barbershopId: number,
    data: { customerId: number; servicePackageId: number },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    await this.ensureModuleAccess(barbershopId, 'packages');
    const pkg = await this.prisma.servicePackage.findFirst({
      where: { id: data.servicePackageId, barbershopId, isActive: true },
    });
    if (!pkg) throw new NotFoundException('Pacote não encontrado');
    const clientPackage = await this.prisma.clientPackage.create({
      data: {
        barbershopId,
        customerId: data.customerId,
        servicePackageId: pkg.id,
        totalSessions: pkg.totalSessions,
      },
      include: { servicePackage: { include: { service: true } } },
    });
    return this.toClientPackageResult(clientPackage);
  }

  async getClientPackages(userId: number, barbershopId: number, customerId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const packages = await this.prisma.clientPackage.findMany({
      where: { barbershopId, customerId },
      include: { servicePackage: { include: { service: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return packages.map((p) => this.toClientPackageResult(p));
  }

  async debitClientPackageSession(userId: number, barbershopId: number, clientPackageId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const clientPackage = await this.prisma.clientPackage.findFirst({
      where: { id: clientPackageId, barbershopId },
    });
    if (!clientPackage) throw new NotFoundException('Pacote do cliente não encontrado');
    if (clientPackage.status !== 'ACTIVE') {
      throw new BadRequestException('Pacote não está ativo');
    }
    if (clientPackage.usedSessions >= clientPackage.totalSessions) {
      throw new BadRequestException('Pacote não tem sessões restantes');
    }
    const usedSessions = clientPackage.usedSessions + 1;
    const status = usedSessions >= clientPackage.totalSessions ? 'COMPLETED' : 'ACTIVE';
    const updated = await this.prisma.clientPackage.update({
      where: { id: clientPackageId },
      data: { usedSessions, status },
      include: { servicePackage: { include: { service: true } } },
    });
    return this.toClientPackageResult(updated);
  }

  // ============ FICHA DE ANAMNESE / CONSENTIMENTO ============

  async createConsentForm(
    userId: number,
    barbershopId: number,
    data: { customerId: number; formType: string; category?: string; answers?: string; expiresAt?: string },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    await this.ensureModuleAccess(barbershopId, 'packages');
    return this.prisma.consentForm.create({
      data: {
        barbershopId,
        customerId: data.customerId,
        formType: data.formType,
        category: data.category,
        answers: data.answers,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      },
    });
  }

  async getConsentForms(userId: number, barbershopId: number, customerId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const forms = await this.prisma.consentForm.findMany({
      where: { barbershopId, customerId },
      orderBy: { createdAt: 'desc' },
    });
    const now = new Date();
    return forms.map((f) => ({
      ...f,
      status: f.status === 'SIGNED' && f.expiresAt && f.expiresAt < now ? 'EXPIRED' : f.status,
    }));
  }

  async signConsentForm(userId: number, barbershopId: number, id: number, signatureName: string) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const form = await this.prisma.consentForm.findFirst({ where: { id, barbershopId } });
    if (!form) throw new NotFoundException('Ficha não encontrada');
    return this.prisma.consentForm.update({
      where: { id },
      data: { signatureName, signedAt: new Date(), status: 'SIGNED' },
    });
  }

  async deleteConsentForm(userId: number, barbershopId: number, id: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const form = await this.prisma.consentForm.findFirst({ where: { id, barbershopId } });
    if (!form) throw new NotFoundException('Ficha não encontrada');
    await this.prisma.consentForm.delete({ where: { id } });
    return true;
  }

  // ============ COMISSÃO ============

  async getCommissionRules(userId: number, barbershopId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const rules = await this.prisma.commissionRule.findMany({
      where: { barbershopId },
      include: { barber: true },
      orderBy: [{ barberId: 'asc' }, { itemType: 'asc' }],
    });
    return rules.map((r) => ({ ...r, barberName: r.barber?.name ?? null }));
  }

  async setCommissionRule(
    userId: number,
    barbershopId: number,
    data: { barberId?: number; itemType?: string; percentage: number },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const itemType = data.itemType ?? 'ALL';
    if (data.barberId) {
      const barber = await this.prisma.barber.findFirst({
        where: { id: data.barberId, barbershopId },
      });
      if (!barber) throw new NotFoundException('Profissional não encontrado');
    }
    // Upsert manual: a chave única usa barberId nullable, que o Prisma não aceita
    // direto em upsert.where com null — resolvemos com findFirst + create/update.
    const existing = await this.prisma.commissionRule.findFirst({
      where: { barbershopId, barberId: data.barberId ?? null, itemType },
    });
    const rule = existing
      ? await this.prisma.commissionRule.update({
          where: { id: existing.id },
          data: { percentage: new Decimal(data.percentage) },
          include: { barber: true },
        })
      : await this.prisma.commissionRule.create({
          data: {
            barbershopId,
            barberId: data.barberId,
            itemType,
            percentage: new Decimal(data.percentage),
          },
          include: { barber: true },
        });
    return { ...rule, barberName: rule.barber?.name ?? null };
  }

  async deleteCommissionRule(userId: number, barbershopId: number, id: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const rule = await this.prisma.commissionRule.findFirst({ where: { id, barbershopId } });
    if (!rule) throw new NotFoundException('Regra de comissão não encontrada');
    await this.prisma.commissionRule.delete({ where: { id } });
    return true;
  }

  async getCommissionReport(userId: number, barbershopId: number, from: Date, to: Date) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const [rules, sales, barbers] = await Promise.all([
      this.prisma.commissionRule.findMany({ where: { barbershopId } }),
      this.prisma.sale.findMany({
        where: {
          barbershopId,
          paymentStatus: 'PAID',
          barberId: { not: null },
          createdAt: { gte: from, lte: to },
        },
        include: { items: true },
      }),
      this.prisma.barber.findMany({ where: { barbershopId } }),
    ]);
    const barberNameMap = new Map(barbers.map((b) => [b.id, b.name]));

    const resolvePercentage = (barberId: number, itemType: string): number => {
      const exact = rules.find((r) => r.barberId === barberId && r.itemType === itemType);
      if (exact) return Number(exact.percentage);
      const barberAll = rules.find((r) => r.barberId === barberId && r.itemType === 'ALL');
      if (barberAll) return Number(barberAll.percentage);
      const shopType = rules.find((r) => r.barberId == null && r.itemType === itemType);
      if (shopType) return Number(shopType.percentage);
      const shopAll = rules.find((r) => r.barberId == null && r.itemType === 'ALL');
      if (shopAll) return Number(shopAll.percentage);
      return 0;
    };

    const byBarber = new Map<
      number,
      { totalServiceSales: number; totalProductSales: number; serviceCommission: number; productCommission: number }
    >();

    for (const sale of sales) {
      const barberId = sale.barberId as number;
      if (!byBarber.has(barberId)) {
        byBarber.set(barberId, {
          totalServiceSales: 0,
          totalProductSales: 0,
          serviceCommission: 0,
          productCommission: 0,
        });
      }
      const acc = byBarber.get(barberId)!;
      for (const item of sale.items) {
        const total = Number(item.totalPrice);
        const pct = resolvePercentage(barberId, item.itemType);
        if (item.itemType === 'PRODUCT') {
          acc.totalProductSales += total;
          acc.productCommission += (total * pct) / 100;
        } else {
          acc.totalServiceSales += total;
          acc.serviceCommission += (total * pct) / 100;
        }
      }
    }

    const rows = Array.from(byBarber.entries()).map(([barberId, acc]) => ({
      barberId,
      barberName: barberNameMap.get(barberId) ?? `#${barberId}`,
      totalServiceSales: acc.totalServiceSales,
      totalProductSales: acc.totalProductSales,
      serviceCommission: acc.serviceCommission,
      productCommission: acc.productCommission,
      totalCommission: acc.serviceCommission + acc.productCommission,
    }));
    rows.sort((a, b) => b.totalCommission - a.totalCommission);

    return {
      rows,
      totalCommission: rows.reduce((sum, r) => sum + r.totalCommission, 0),
    };
  }
}
