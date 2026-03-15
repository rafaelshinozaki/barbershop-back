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
import {
  planIncludesModule,
  getModulesForPlanName,
  BarbershopModule,
} from './barbershop-plan.constants';

@Injectable()
export class BarbershopService {
  private readonly logger = new Logger(BarbershopService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
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
              where: { status: 'ACTIVE' },
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
                  where: { status: 'ACTIVE' },
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
    if (!plan) return false;
    return planIncludesModule(plan.name, module);
  }

  /** Retorna os módulos disponíveis para a barbearia conforme o plano do dono. */
  async getAvailableModules(barbershopId: number): Promise<string[]> {
    const plan = await this.getBarbershopPlan(barbershopId);
    if (!plan) return getModulesForPlanName(''); // básico quando sem assinatura
    return getModulesForPlanName(plan.name);
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
    if (!ownsViaBarbershop && !ownsViaNetwork) {
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
      city: string;
      description: string;
      mission: string;
      foundationYear: number;
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
    const monthlyRevenue: { month: string; year: number; total: number }[] = [];
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
        month: start.toLocaleDateString('pt-BR', { month: 'short' }),
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
    }> = [];

    recentAppointments.forEach((a) => {
      events.push({
        id: `apt-${a.id}`,
        type: 'appointment',
        date: a.startAt,
        title: `Agendamento: ${a.customer?.name ?? '-'}`,
        subtitle: `${a.barbershop.name} • ${a.barber?.name ?? '-'}`,
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
      city: string;
      state: string;
      country: string;
      postalCode: string;
      phone: string;
      email: string;
      timezone?: string;
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
    return this.prisma.barbershop.create({
      data: {
        ...data,
        timezone: data.timezone ?? 'America/Sao_Paulo',
        networkId: network.id,
        ownerUserId: userId,
      },
    });
  }

  async getUserBarbershops(userId: number) {
    return this.getMyBarbershops(userId);
  }

  async getMyBarbershops(userId: number) {
    return this.prisma.barbershop.findMany({
      where: {
        OR: [{ ownerUserId: userId }, { network: { ownerUserId: userId } }],
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
      city: string;
      state: string;
      country: string;
      postalCode: string;
      phone: string;
      email: string;
      timezone: string;
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
      phone: string;
      email?: string;
      birthDate?: Date;
      notes?: string;
    },
  ) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId);
    return this.prisma.customer.create({
      data: { networkId: barbershop.networkId, ...data },
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
      hireDate?: Date;
    },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
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
    data: Partial<{ name: string; phone: string; email: string; avatarUrl: string; specialization: string; isActive: boolean }>,
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
      category: string;
      displayOrder?: number;
    },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    return this.prisma.barbershopService.create({
      data: {
        barbershopId,
        ...data,
        price: new Decimal(data.price),
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
      category: string;
      isActive: boolean;
      displayOrder: number;
    }>,
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const price = data.price !== undefined ? new Decimal(data.price) : undefined;
    return this.prisma.barbershopService.update({
      where: { id: serviceId },
      data: { ...data, price },
    });
  }

  async deleteService(userId: number, barbershopId: number, serviceId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    await this.prisma.barbershopService.delete({ where: { id: serviceId } });
  }

  // ============ PRODUCTS ============

  async createProduct(
    userId: number,
    barbershopId: number,
    data: {
      name: string;
      sku?: string;
      description?: string;
      salePrice: number | Decimal;
      costPrice?: number | Decimal;
      unit?: string;
    },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    return this.prisma.barbershopProduct.create({
      data: {
        barbershopId,
        ...data,
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
      orderBy: { name: 'asc' },
    });
  }

  async updateProduct(
    userId: number,
    barbershopId: number,
    productId: number,
    data: Partial<{
      name: string;
      sku: string;
      description: string;
      salePrice: number | Decimal;
      costPrice: number | Decimal;
      unit: string;
      isActive: boolean;
    }>,
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const salePrice = data.salePrice !== undefined ? new Decimal(data.salePrice) : undefined;
    const costPrice = data.costPrice !== undefined ? new Decimal(data.costPrice) : undefined;
    return this.prisma.barbershopProduct.update({
      where: { id: productId },
      data: { ...data, salePrice, costPrice },
    });
  }

  async deleteProduct(userId: number, barbershopId: number, productId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    await this.prisma.barbershopProduct.delete({ where: { id: productId } });
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

  async createAppointment(
    userId: number,
    barbershopId: number,
    data: {
      customerId: number;
      barberId: number;
      startAt: Date;
      endAt: Date;
      status?: string;
      notes?: string;
      source?: string;
      services: Array<{ serviceId: number; quantity?: number; unitPrice: number }>;
    },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const { services, ...appointmentData } = data;
    return this.prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.create({
        data: {
          barbershopId,
          ...appointmentData,
          status: appointmentData.status ?? 'CONFIRMED',
          source: appointmentData.source ?? 'PHONE',
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
    },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const discount = data.discountAmount ?? 0;
    const tax = data.taxAmount ?? 0;
    return this.prisma.$transaction(async (tx) => {
      const sale = await tx.sale.create({
        data: {
          barbershopId,
          customerId: data.customerId,
          barberId: data.barberId,
          appointmentId: data.appointmentId,
          saleType: data.saleType,
          subtotal: new Decimal(data.subtotal),
          discountAmount: new Decimal(discount),
          taxAmount: new Decimal(tax),
          total: new Decimal(data.total),
          paymentStatus: data.paymentStatus ?? 'PENDING',
          paymentMethod: data.paymentMethod,
          paidAt: data.paymentStatus === 'PAID' ? new Date() : null,
        },
      });
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
    return this.prisma.sale.findMany({
      where,
      include: { items: true, customer: true, barber: true },
      orderBy: { createdAt: 'desc' },
      take: filters?.limit ?? 50,
      skip: filters?.offset ?? 0,
    });
  }

  // ============ INVENTORY ============

  async getInventoryItems(userId: number, barbershopId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    return this.prisma.inventoryItem.findMany({
      where: { barbershopId },
      include: { product: true },
      orderBy: { product: { name: 'asc' } },
    });
  }

  async createInventoryItem(
    userId: number,
    barbershopId: number,
    data: {
      productId: number;
      quantity: number;
      unit?: string;
      minQuantity?: number;
      location?: string;
    },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const existing = await this.prisma.inventoryItem.findUnique({
      where: { barbershopId_productId: { barbershopId, productId: data.productId } },
    });
    if (existing) {
      throw new BadRequestException('Produto já possui item de inventário');
    }
    return this.prisma.inventoryItem.create({
      data: {
        barbershopId,
        ...data,
        unit: data.unit ?? 'UNIT',
      },
    });
  }

  async updateInventoryQuantity(
    userId: number,
    barbershopId: number,
    inventoryItemId: number,
    quantityChange: number,
    movementType: string,
    notes?: string,
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: inventoryItemId, barbershopId },
    });
    if (!item) throw new NotFoundException('Item de inventário não encontrado');
    const quantityBefore = Number(item.quantity);
    const quantityAfter = Math.max(0, quantityBefore + quantityChange);

    return this.prisma.$transaction([
      this.prisma.inventoryItem.update({
        where: { id: inventoryItemId },
        data: {
          quantity: quantityAfter,
          lastCountedAt: new Date(),
        },
      }),
      this.prisma.inventoryMovement.create({
        data: {
          inventoryItemId,
          movementType,
          quantityChange,
          quantityBefore,
          quantityAfter,
          notes,
        },
      }),
    ]).then(([updated]) => updated);
  }
}
