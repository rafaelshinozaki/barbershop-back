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
import { PLANO_STATUS } from '../common/contants';

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
      hireDate?: Date;
    },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);

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
}
