import { unsubscribeLinks, verifyUnsubscribeToken } from './marketing-unsubscribe';
import {
  appointmentManageUrl,
  createAppointmentToken,
  verifyAppointmentToken,
} from './appointment-link';
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import { langForCountry, LOCALE } from '../email/language';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationQueueService } from '../queue/notification-queue.service';
import { RealtimeService } from '../realtime/realtime.service';
import { UserService } from '../auth/users/users.service';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma, TreatmentCategory } from '@prisma/client';
import { isStaffType, StaffType } from './staff-roles';
import { DEFAULT_WORKING_HOURS, WEEKDAY_KEYS } from './working-hours';
import {
  addDaysStr,
  dayOfWeekOf,
  monthRangeUtc,
  nextDateStr,
  safeTimeZone,
  toZonedParts,
  zonedTimeToUtc,
  reportPeriod,
} from '../common/timezone.util';
import {
  planIncludesModule,
  getModulesForPlanName,
  getPlanLimits,
  BarbershopModule,
} from './barbershop-plan.constants';
import { PLANO_STATUS } from '../common/contants';
import { S3Service } from '../aws/s3.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { normalizePhoneToE164 } from '../common/phone.util';
import { StripeService } from '../stripe/stripe.service';
import { PLATFORM_SUBSCRIPTION_FEE_PERCENT } from './subscription.constants';
import { appointmentCalendarLinks } from '../calendar/calendar-links';

// Mesmas opções do seletor de cores do front (Radix Themes)
const NETWORK_ACCENT_COLORS = [
  'gray',
  'gold',
  'bronze',
  'brown',
  'yellow',
  'amber',
  'orange',
  'tomato',
  'red',
  'ruby',
  'crimson',
  'pink',
  'plum',
  'purple',
  'violet',
  'iris',
  'indigo',
  'blue',
  'cyan',
  'teal',
  'jade',
  'green',
  'grass',
  'lime',
  'mint',
  'sky',
] as const;
const NETWORK_GRAY_COLORS = ['auto', 'gray', 'mauve', 'slate', 'sage', 'olive', 'sand'] as const;

/**
 * Cargos na unidade, como no Booksy (do mais restrito ao dono):
 * - basic (Barbeiro básico): só a própria agenda; clientes só pelo nome
 * - barber (Barbeiro): a própria agenda, as próprias vendas, fila e pacotes;
 *   contato só dos clientes que já agendaram com ele
 * - reception (Recepção): agenda de todos, cadastro completo dos clientes e
 *   o caixa do dia (abrir, vender, fechar) — sem relatórios nem configurações
 * - manager (Gerente): quase tudo do dono
 * - owner (Dono): tudo, inclusive apagar a unidade
 */
export type AccessLevel = 'basic' | 'barber' | 'reception' | 'manager' | 'owner';
const ACCESS_RANK: Record<AccessLevel, number> = {
  basic: 1,
  barber: 2,
  reception: 3,
  manager: 4,
  owner: 5,
};
/** Recepção não atende: não aparece pra agendar nem recebe agendamento */
/** Até quantos dias à frente o "próximo horário disponível" procura */
const NEXT_AVAILABLE_DAYS = 60;
/** Quanto tempo o horário fica reservado esperando o sinal online */
export const DEPOSIT_HOLD_MINUTES = 15;
const BOOKABLE_STAFF = {
  OR: [{ staffType: null }, { staffType: { not: 'reception' } }],
} satisfies Prisma.BarberWhereInput;
/**
 * Vínculo valendo agora: ativo e dentro do período (freelancer com data de
 * início/fim). Fora dele a pessoa não entra na unidade nem aparece pra agendar.
 */
function currentEngagement(now = new Date()): Prisma.BarberWhereInput {
  return {
    isActive: true,
    AND: [
      { OR: [{ accessStartsAt: null }, { accessStartsAt: { lte: now } }] },
      { OR: [{ accessEndsAt: null }, { accessEndsAt: { gte: now } }] },
    ],
  };
}
/** O atendimento cai dentro do período do vínculo? */
function withinEngagement(
  barber: { accessStartsAt: Date | null; accessEndsAt: Date | null },
  startAt: Date,
): boolean {
  return (
    (!barber.accessStartsAt || startAt >= barber.accessStartsAt) &&
    (!barber.accessEndsAt || startAt <= barber.accessEndsAt)
  );
}
/** Valida o período do vínculo temporário (datas ISO ou null = sem limite) */
export function parseEngagementPeriod(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined,
): { accessStartsAt: Date | null; accessEndsAt: Date | null } {
  const toDate = (v: string | Date | null | undefined) => {
    if (v == null || v === '') return null;
    const d = new Date(v);
    if (isNaN(d.getTime())) throw new BadRequestException('Data do vínculo inválida');
    return d;
  };
  const accessStartsAt = toDate(start);
  const accessEndsAt = toDate(end);
  if (accessStartsAt && accessEndsAt && accessEndsAt < accessStartsAt) {
    throw new BadRequestException('O fim do vínculo não pode ser antes do início');
  }
  return { accessStartsAt, accessEndsAt };
}
/** Cargos que veem só a própria agenda (e as próprias vendas) */
const OWN_AGENDA_ONLY: AccessLevel[] = ['basic', 'barber'];

const MAX_TIME_OFF_DAYS = 366;
const MAX_AGENDA_ROWS = 3000;
const TIME_OFF_REASONS = ['VACATION', 'SICK', 'PERSONAL', 'OTHER'];

@Injectable()
export class BarbershopService {
  private readonly logger = new Logger(BarbershopService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly s3Service: S3Service,
    private readonly whatsappService: WhatsappService,
    private readonly stripeService: StripeService,
    private readonly notificationQueue: NotificationQueueService,
    private readonly realtime: RealtimeService,
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
  async canAccessModule(barbershopId: number, module: BarbershopModule): Promise<boolean> {
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
    // Freelancer com vínculo encerrado não ocupa vaga
    const currentCount = await this.prisma.barber.count({
      where: {
        barbershopId,
        isActive: true,
        OR: [{ accessEndsAt: null }, { accessEndsAt: { gte: new Date() } }],
      },
    });
    if (currentCount >= limits.maxBarbersPerShop) {
      throw new BadRequestException(
        `Seu plano permite no máximo ${limits.maxBarbersPerShop} profissional(is) por unidade. Faça upgrade para adicionar mais.`,
      );
    }
  }

  /**
   * Acesso do usuário à unidade, com o nível mínimo que a operação exige:
   * - 'barber'  → qualquer pessoa da equipe (atender: agenda, venda, cliente)
   * - 'manager' → gerente ou dono (operar a unidade: preços, equipe, caixa…)
   * - 'owner'   → só o dono (financeiro, apagar unidade, regras de comissão)
   * Antes qualquer barbeiro tinha o poder do dono — inclusive quem já tinha
   * sido desligado (isActive=false) continuava entrando.
   */
  private async ensureBarbershopAccess(
    userId: number,
    barbershopId: number,
    min: AccessLevel = 'barber',
  ) {
    const barbershop = await this.prisma.barbershop.findFirst({
      where: { id: barbershopId },
      include: { network: true },
    });
    if (!barbershop) {
      throw new ForbiddenException('Barbearia não encontrada');
    }
    const level = await this.accessLevelOf(userId, barbershop);
    if (!level) {
      throw new ForbiddenException('Você não tem acesso a esta barbearia');
    }
    if (ACCESS_RANK[level] < ACCESS_RANK[min]) {
      throw new ForbiddenException('Seu cargo nesta unidade não permite essa ação.');
    }
    return Object.assign(barbershop, { accessLevel: level });
  }

  /** Cargo do usuário na unidade (null = sem acesso). */
  private async accessLevelOf(
    userId: number,
    barbershop: {
      id: number;
      ownerUserId: number | null;
      network?: { ownerUserId: number } | null;
    },
  ): Promise<AccessLevel | null> {
    if (barbershop.ownerUserId === userId || barbershop.network?.ownerUserId === userId) {
      return 'owner';
    }
    const staff = await this.prisma.barber.findFirst({
      where: { barbershopId: barbershop.id, userId, ...currentEngagement() },
      select: { staffType: true },
    });
    if (!staff) return null;
    return isStaffType(staff.staffType) ? staff.staffType : 'barber';
  }

  /** Mesmo controle, pra quem está fora deste service (fotos, redes sociais…). */
  async ensureAccess(userId: number, barbershopId: number, min: AccessLevel = 'barber') {
    return this.ensureBarbershopAccess(userId, barbershopId, min);
  }

  /** Cargo do usuário na unidade — o front usa pra mostrar só o que ele pode. */
  async getMyAccessLevel(userId: number, barbershopId: number): Promise<AccessLevel | null> {
    const barbershop = await this.prisma.barbershop.findFirst({
      where: { id: barbershopId },
      include: { network: true },
    });
    return barbershop ? this.accessLevelOf(userId, barbershop) : null;
  }

  /**
   * Horário/folga de um barbeiro: gerente e dono mexem em qualquer um; o
   * barbeiro (e o básico), só no próprio. Recepção não mexe em horário.
   */
  /** Agendar/cancelar pra um profissional: barbeiro só na própria agenda. */
  async ensureCanBookForBarber(userId: number, barbershopId: number, barberId: number) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'basic');
    const ownBarberId = await this.ownBarberIdIfBarber(userId, barbershop);
    if (ownBarberId !== null && barberId !== ownBarberId) {
      throw new ForbiddenException('Seu cargo só permite agendar na sua própria agenda.');
    }
    await this.ensureBarberOfBarbershop(barbershopId, barberId);
    return barbershop;
  }

  /** Escala semanal: gerente e dono de qualquer um; o profissional, só a dele. */
  ensureCanManageBarberSchedule(userId: number, barbershopId: number, barberId: number) {
    return this.ensureCanManageBarber(userId, barbershopId, barberId);
  }

  private async ensureCanManageBarber(userId: number, barbershopId: number, barberId: number) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'basic');
    if (ACCESS_RANK[barbershop.accessLevel] >= ACCESS_RANK.manager) return barbershop;
    const own = await this.prisma.barber.findFirst({
      where: { id: barberId, barbershopId, userId, isActive: true },
      select: { id: true },
    });
    if (!own) {
      throw new ForbiddenException('Seu cargo só permite mexer na sua própria agenda.');
    }
    return barbershop;
  }

  /**
   * Como no Booksy: barbeiro e barbeiro básico veem e mexem só na própria
   * agenda. Devolve o id de barbeiro dele (null pra recepção, gerente e dono,
   * que veem todas).
   */
  private async ownBarberIdIfBarber(
    userId: number,
    barbershop: { id: number; accessLevel: AccessLevel },
  ): Promise<number | null> {
    if (!OWN_AGENDA_ONLY.includes(barbershop.accessLevel)) return null;
    const me = await this.prisma.barber.findFirst({
      where: { barbershopId: barbershop.id, userId, isActive: true },
      select: { id: true },
    });
    return me?.id ?? -1;
  }

  /** Barbeiro: agendamento de outro barbeiro não existe pra ele. */
  private ensureOwnAppointment(ownBarberId: number | null, appointment: { barberId: number }) {
    if (ownBarberId !== null && appointment.barberId !== ownBarberId) {
      throw new NotFoundException('Agendamento não encontrado');
    }
  }

  /**
   * De quais clientes a pessoa vê telefone e e-mail (como no Booksy):
   * recepção, gerente e dono, de todos; barbeiro, só dos que já agendaram com
   * ele; barbeiro básico, de nenhum.
   */
  private async contactVisibility(
    userId: number,
    barbershop: { id: number; accessLevel: AccessLevel },
  ): Promise<(customerId: number | null | undefined) => boolean> {
    if (ACCESS_RANK[barbershop.accessLevel] >= ACCESS_RANK.reception) return () => true;
    if (barbershop.accessLevel === 'basic') return () => false;
    const own = await this.ownBarberIdIfBarber(userId, barbershop);
    const mine = await this.prisma.appointment.findMany({
      where: { barberId: own ?? -1 },
      select: { customerId: true },
      distinct: ['customerId'],
    });
    const ids = new Set(mine.map((a) => a.customerId));
    return (customerId) => customerId != null && ids.has(customerId);
  }

  private hideContact<
    T extends { id: number; phone?: string | null; email?: string | null } | null,
  >(canSee: (customerId: number) => boolean, customer: T): T {
    if (!customer || canSee(customer.id)) return customer;
    return { ...customer, phone: '', email: null };
  }

  private hideAppointmentContact<T extends { customer?: any }>(
    canSee: (customerId: number) => boolean,
    appt: T,
  ): T {
    return appt?.customer ? { ...appt, customer: this.hideContact(canSee, appt.customer) } : appt;
  }

  private hideWalkInContact<
    T extends { customerId?: number | null; customerPhone?: string | null; customer?: any },
  >(canSee: (customerId: number | null | undefined) => boolean, walkIn: T): T {
    if (!walkIn || canSee(walkIn.customerId)) return walkIn;
    return { ...this.hideAppointmentContact(canSee, walkIn), customerPhone: null };
  }

  /** Verifica acesso à barbearia (usado por EmployeeInviteService). */
  async verifyBarbershopAccess(userId: number, barbershopId: number) {
    return this.ensureBarbershopAccess(userId, barbershopId, 'manager');
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

  /** Valida contra as cores do Radix Themes; vazio/null volta ao padrão. */
  private normalizeThemeColor(value: string | null, allowed: readonly string[], label: string) {
    if (value == null || value.trim() === '') return null;
    const v = value.trim();
    if (!allowed.includes(v)) throw new BadRequestException(`${label} inválida: ${v}`);
    return v;
  }

  /**
   * Cores da franquia do usuário: a rede que ele possui, ou a rede da
   * barbearia onde trabalha (Barber.userId). Só o dono pode editar.
   */
  async getMyNetworkTheme(userId: number) {
    const owned = await this.prisma.network.findFirst({ where: { ownerUserId: userId } });
    const network =
      owned ??
      (
        await this.prisma.barber.findFirst({
          where: { userId, ...currentEngagement() },
          select: { barbershop: { select: { network: true } } },
        })
      )?.barbershop.network;
    if (!network) return null;
    // Mesma regra do NetworkResolver.logoUrl: upload no S3 (URL assinada)
    // tem prioridade sobre uma URL externa salva direto
    const logoUrl = network.logoKey
      ? await this.s3Service.getDownloadUrl(network.logoKey)
      : network.logoUrl ?? null;
    return {
      networkId: network.id,
      name: network.name,
      logoUrl,
      accentColor: network.accentColor,
      grayColor: network.grayColor,
      canEdit: network.ownerUserId === userId,
    };
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
      referralBonusPoints: number;
      noShowFeeEnabled: boolean;
      noShowFeeType: string;
      noShowFeeValue: number;
      lateCancellationWindowHours: number;
      accentColor: string;
      grayColor: string;
    }>,
  ) {
    const network = await this.getMyNetwork(userId);
    if (!network) throw new NotFoundException('Franquia não encontrada');
    const updateData: Record<string, unknown> = { ...data };
    if (data.logoUrl !== undefined) updateData.logoKey = null;
    if (data.accentColor !== undefined) {
      updateData.accentColor = this.normalizeThemeColor(
        data.accentColor,
        NETWORK_ACCENT_COLORS,
        'Cor de destaque',
      );
    }
    if (data.grayColor !== undefined) {
      updateData.grayColor = this.normalizeThemeColor(
        data.grayColor,
        NETWORK_GRAY_COLORS,
        'Tom de cinza',
      );
    }
    return this.prisma.network.update({
      where: { id: network.id },
      data: updateData,
    });
  }

  /** Dashboard stats agregados para dono da franquia */
  async getNetworkDashboardStats(userId: number) {
    // Faturamento da rede: só as unidades onde a pessoa é dona ou gerente
    // (antes o barbeiro via o faturamento de todas onde trabalha)
    const barbershops = await this.prisma.barbershop.findMany({
      where: {
        OR: [
          { ownerUserId: userId },
          { network: { ownerUserId: userId } },
          { barbers: { some: { userId, staffType: 'manager', ...currentEngagement() } } },
        ],
      },
    });
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

    // Meses no fuso da rede (o da primeira unidade — todas as unidades de uma
    // rede ficam no mesmo país), não no do servidor, que roda em UTC.
    const timeZone = safeTimeZone(barbershops[0]?.timezone);
    const [year, month] = toZonedParts(new Date(), timeZone).dateStr.split('-').map(Number);
    const startOfMonth = monthRangeUtc(year, month, timeZone).start;

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
      const { start, end } = monthRangeUtc(year, month - i, timeZone);
      const r = await this.prisma.sale.aggregate({
        where: {
          barbershopId: { in: barbershopIds },
          paymentStatus: 'PAID',
          createdAt: { gte: start, lt: end },
        },
        _sum: { total: true },
      });
      // Meio do mês em UTC só pra extrair rótulo/ano/mês do calendário
      const label = new Date(Date.UTC(year, month - 1 - i, 15));
      monthlyRevenue.push({
        month: label.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
        monthIndex: label.getUTCMonth(),
        year: label.getUTCFullYear(),
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
    // O check de slug lá em cima não é atômico: dois cadastros simultâneos
    // com o mesmo slug passam juntos por ele e um estoura a unique aqui.
    const barbershop = await this.prisma.barbershop
      .create({
        data: {
          ...data,
          timezone: data.timezone ?? 'America/Sao_Paulo',
          currency: data.currency ?? network.currency,
          networkId: network.id,
          ownerUserId: userId,
        },
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new BadRequestException('Já existe uma barbearia com este slug');
        }
        throw error;
      });

    const owner = await this.prisma.user.findUnique({ where: { id: userId } });
    if (owner) {
      // O dono entra na equipe de cada unidade dele (a agenda dele é uma só:
      // o mesmo horário não é vendido em duas unidades)
      await this.prisma.barber.create({
        data: {
          barbershopId: barbershop.id,
          userId,
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
          { barbers: { some: { userId, ...currentEngagement() } } },
        ],
      },
      orderBy: { name: 'asc' },
    });
  }

  async getBarbershop(userId: number, id: number) {
    await this.ensureBarbershopAccess(userId, id, 'basic');
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
      subdomain: string;
    }>,
  ) {
    await this.ensureBarbershopAccess(userId, id, 'manager');
    const { subdomain, ...rest } = data;
    const updateData: typeof rest & { subdomain?: string | null } = { ...rest };
    if (subdomain !== undefined) {
      updateData.subdomain = await this.resolveSubdomainUpdate(id, subdomain);
    }
    return this.prisma.barbershop.update({
      where: { id },
      data: updateData,
    });
  }

  // Label de DNS válido: minúsculas, números, hífen no meio; 3 a 63
  // caracteres. String vazia limpa (volta pra null) — usado quando o dono
  // quer desativar o subdomínio sem excluir a barbearia.
  private async resolveSubdomainUpdate(
    barbershopId: number,
    rawSubdomain: string,
  ): Promise<string | null> {
    const trimmed = rawSubdomain.trim().toLowerCase();
    if (trimmed === '') return null;
    if (!/^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/.test(trimmed)) {
      throw new BadRequestException(
        'Subdomínio inválido — use só letras minúsculas, números e hífen (sem começar/terminar com hífen), de 3 a 63 caracteres.',
      );
    }
    const RESERVED = ['www', 'app', 'api', 'admin', 'mail', 'ftp'];
    if (RESERVED.includes(trimmed)) {
      throw new BadRequestException('Esse subdomínio é reservado. Escolha outro.');
    }
    const existing = await this.prisma.barbershop.findFirst({
      where: { subdomain: trimmed, NOT: { id: barbershopId } },
    });
    if (existing) {
      throw new BadRequestException('Esse subdomínio já está em uso por outra barbearia.');
    }
    return trimmed;
  }

  async deleteBarbershop(userId: number, id: number) {
    await this.ensureBarbershopAccess(userId, id, 'owner');
    // Antes as assinaturas dos clientes sumiam do banco junto com a unidade
    // (cascade) mas continuavam ativas no Stripe — o cliente seguia pagando
    await this.cancelClientSubscriptionsOfBarbershops([id]);
    await this.cancelChairRentsOfBarbershops([id]);
    await this.prisma.barbershop.delete({ where: { id } });
  }

  /**
   * Cancela na hora, no Stripe, as assinaturas de serviço dos clientes das
   * unidades (antes de apagar a unidade ou a conta do dono). Assinatura que
   * o Stripe já não conhece não impede nada; outro erro interrompe, pra não
   * apagar a unidade deixando a cobrança rodando.
   */
  async cancelClientSubscriptionsOfBarbershops(barbershopIds: number[]) {
    if (barbershopIds.length === 0) return;
    const subs = await this.prisma.clientSubscription.findMany({
      where: { barbershopId: { in: barbershopIds }, status: { not: 'CANCELED' } },
      select: { id: true, stripeSubscriptionId: true },
    });
    for (const sub of subs) {
      try {
        await this.stripeService.cancelSubscription(sub.stripeSubscriptionId);
      } catch (error: any) {
        if (error?.code !== 'resource_missing') throw error;
      }
      await this.prisma.clientSubscription.update({
        where: { id: sub.id },
        data: { status: 'CANCELED', canceledAt: new Date(), cancelAtPeriodEnd: false },
      });
    }
  }

  /**
   * Aluguel da cadeira (espaço compartilhado) em que a unidade é o espaço ou
   * o profissional: cancela a cobrança mensal no Stripe antes de apagar a
   * unidade/conta ou de encerrar o vínculo — senão o profissional seguia
   * pagando por um espaço que não existe mais.
   */
  async cancelChairRentsOfBarbershops(barbershopIds: number[], onlyLinkId?: number) {
    if (barbershopIds.length === 0 && !onlyLinkId) return;
    const links = await this.prisma.sharedLocationMember.findMany({
      where: onlyLinkId
        ? { id: onlyLinkId, rentStripeSubscriptionId: { not: null } }
        : {
            rentStripeSubscriptionId: { not: null },
            OR: [
              { hostBarbershopId: { in: barbershopIds } },
              { memberBarbershopId: { in: barbershopIds } },
            ],
          },
      select: { id: true, rentStripeSubscriptionId: true },
    });
    for (const link of links) {
      try {
        await this.stripeService.cancelSubscription(link.rentStripeSubscriptionId!);
      } catch (error: any) {
        if (error?.code !== 'resource_missing') throw error;
      }
      await this.prisma.sharedLocationMember.update({
        where: { id: link.id },
        data: { rentStripeSubscriptionId: null, rentStatus: 'NONE' },
      });
    }
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
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'basic');
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
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'basic');
    const where: any = { networkId: barbershop.networkId };
    if (filters?.isActive !== undefined) where.isActive = filters.isActive;
    if (filters?.search) {
      where.OR = [{ name: { contains: filters.search, mode: 'insensitive' } }];
      // Quem não vê o contato de todos não busca por ele (confirmaria o
      // telefone de alguém)
      if (ACCESS_RANK[barbershop.accessLevel] >= ACCESS_RANK.reception) {
        where.OR.push(
          { phone: { contains: filters.search } },
          { email: { contains: filters.search, mode: 'insensitive' } },
        );
      }
    }
    const customers = await this.prisma.customer.findMany({
      where,
      orderBy: { name: 'asc' },
      take: filters?.limit ?? 50,
      skip: filters?.offset ?? 0,
    });
    const canSee = await this.contactVisibility(userId, barbershop);
    return customers.map((c) => this.hideContact(canSee, c));
  }

  async getCustomer(userId: number, barbershopId: number, customerId: number) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'basic');
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, networkId: barbershop.networkId },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado');
    return this.hideContact(await this.contactVisibility(userId, barbershop), customer);
  }

  async updateCustomer(
    userId: number,
    barbershopId: number,
    customerId: number,
    data: Partial<{
      name: string;
      phone: string;
      email: string;
      birthDate: Date;
      notes: string;
      isActive: boolean;
      marketingOptOut: boolean;
    }>,
  ) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'reception');
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
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'basic');
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
    data: Partial<{
      name: string;
      phone: string;
      email: string;
      avatarUrl: string;
      specialization: string;
      specialties: TreatmentCategory[];
      isActive: boolean;
      staffType: string;
      accessStartsAt: string | Date | null;
      accessEndsAt: string | Date | null;
    }>,
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const barber = await this.prisma.barber.findFirst({
      where: { id: barberId, barbershopId },
    });
    if (!barber) throw new NotFoundException('Barbeiro não encontrado');
    const period = parseEngagementPeriod(
      data.accessStartsAt === undefined ? barber.accessStartsAt : data.accessStartsAt,
      data.accessEndsAt === undefined ? barber.accessEndsAt : data.accessEndsAt,
    );
    if (data.accessStartsAt !== undefined) data.accessStartsAt = period.accessStartsAt;
    if (data.accessEndsAt !== undefined) data.accessEndsAt = period.accessEndsAt;
    if (data.staffType !== undefined) {
      if (!isStaffType(data.staffType)) throw new BadRequestException('Cargo inválido');
      // Quem vira recepção deixa de atender: não pode ter horário marcado
      if (data.staffType === 'reception' && barber.staffType !== 'reception') {
        const upcoming = await this.prisma.appointment.count({
          where: {
            barberId,
            startAt: { gte: new Date() },
            status: { notIn: ['CANCELLED', 'COMPLETED', 'NO_SHOW'] },
          },
        });
        if (upcoming > 0) {
          throw new BadRequestException(
            'Esse profissional tem agendamentos marcados. Remarque-os antes de passar pra recepção.',
          );
        }
      }
    }
    return this.prisma.barber.update({ where: { id: barberId }, data });
  }

  async deleteBarber(userId: number, barbershopId: number, barberId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
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
    if (!user)
      throw new BadRequestException(
        'O funcionário ainda não criou a conta. Peça que aceite o convite por email primeiro.',
      );
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'basic');
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
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

  async getBarberSchedules(userId: number, barbershopId: number, barberId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'basic');
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
    input: {
      barberId: number;
      dayOfWeek: number;
      startTime: string;
      endTime: string;
      breakStart?: string;
      breakEnd?: string;
    },
  ) {
    const barber = await this.prisma.barber.findUnique({ where: { id: input.barberId } });
    if (!barber) throw new NotFoundException('Barbeiro não encontrado');
    await this.ensureCanManageBarber(userId, barber.barbershopId, barber.id);
    return this.prisma.barberSchedule.create({
      data: {
        barberId: input.barberId,
        dayOfWeek: input.dayOfWeek,
        startTime: input.startTime,
        endTime: input.endTime,
        breakStart: input.breakStart,
        breakEnd: input.breakEnd,
      },
    });
  }

  async updateBarberSchedule(
    userId: number,
    id: number,
    data: {
      startTime?: string;
      endTime?: string;
      breakStart?: string;
      breakEnd?: string;
      isActive?: boolean;
    },
  ) {
    const schedule = await this.prisma.barberSchedule.findUnique({
      where: { id },
      include: { barber: true },
    });
    if (!schedule) throw new NotFoundException('Horário não encontrado');
    await this.ensureCanManageBarber(userId, schedule.barber.barbershopId, schedule.barberId);
    return this.prisma.barberSchedule.update({ where: { id }, data });
  }

  async deleteBarberSchedule(userId: number, id: number) {
    const schedule = await this.prisma.barberSchedule.findUnique({
      where: { id },
      include: { barber: true },
    });
    if (!schedule) throw new NotFoundException('Horário não encontrado');
    await this.ensureCanManageBarber(userId, schedule.barber.barbershopId, schedule.barberId);
    await this.prisma.barberSchedule.delete({ where: { id } });
  }

  // ============ BARBER TIME OFF ============

  /**
   * Folga/férias/afastamento de um profissional (gerente e dono; o
   * barbeiro, só a própria). O período sai da página pública e da série;
   * horários já marcados nele continuam — volta quantos são, pra equipe
   * remarcar ou cancelar.
   */
  async createBarberTimeOff(
    userId: number,
    input: { barberId: number; startAt: string; endAt: string; reason?: string },
  ) {
    const barber = await this.prisma.barber.findUnique({ where: { id: input.barberId } });
    if (!barber) throw new NotFoundException('Barbeiro não encontrado');
    await this.ensureCanManageBarber(userId, barber.barbershopId, barber.id);
    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);
    if (isNaN(startAt.getTime()) || isNaN(endAt.getTime()) || endAt <= startAt) {
      throw new BadRequestException('Período inválido');
    }
    if (endAt.getTime() - startAt.getTime() > MAX_TIME_OFF_DAYS * 86_400_000) {
      throw new BadRequestException(`O período pode ter no máximo ${MAX_TIME_OFF_DAYS} dias`);
    }
    const reason = input.reason ?? 'PERSONAL';
    if (!TIME_OFF_REASONS.includes(reason)) throw new BadRequestException('Motivo inválido');
    const [timeOff, affectedAppointments] = await Promise.all([
      this.prisma.barberTimeOff.create({
        data: { barberId: input.barberId, startAt, endAt, reason },
      }),
      this.prisma.appointment.count({
        where: {
          barberId: barber.id,
          status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] },
          startAt: { lt: endAt },
          endAt: { gt: startAt },
        },
      }),
    ]);
    this.realtime.notify(barber.barbershopId, 'APPOINTMENT', 'UPDATED');
    return { ...timeOff, affectedAppointments };
  }

  /** Folgas da unidade num período (fundo da agenda); barbeiro vê só as dele. */
  async getBarbershopTimeOffs(userId: number, barbershopId: number, startAt: Date, endAt: Date) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'basic');
    const own = await this.ownBarberIdIfBarber(userId, barbershop);
    const rows = await this.prisma.barberTimeOff.findMany({
      where: {
        barber: { barbershopId },
        ...(own !== null ? { barberId: own } : {}),
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      include: { barber: { select: { name: true } } },
      orderBy: { startAt: 'asc' },
      take: 500,
    });
    return rows.map(({ barber, ...t }) => ({ ...t, barberName: barber.name }));
  }

  async deleteBarberTimeOff(userId: number, timeOffId: number) {
    const timeOff = await this.prisma.barberTimeOff.findUnique({
      where: { id: timeOffId },
      include: { barber: true },
    });
    if (!timeOff) throw new NotFoundException('Afastamento não encontrado');
    await this.ensureCanManageBarber(userId, timeOff.barber.barbershopId, timeOff.barberId);
    await this.prisma.barberTimeOff.delete({ where: { id: timeOffId } });
    this.realtime.notify(timeOff.barber.barbershopId, 'APPOINTMENT', 'UPDATED');
    return true;
  }

  async getBarberTimeOffsByBarber(
    userId: number,
    barberId: number,
    filters?: { startAt?: Date; endAt?: Date },
  ) {
    const barber = await this.prisma.barber.findUnique({ where: { id: barberId } });
    if (!barber) throw new NotFoundException('Barbeiro não encontrado');
    await this.ensureBarbershopAccess(userId, barber.barbershopId, 'basic');
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

  /**
   * Trava a agenda do barbeiro (e do recurso, se houver) até o fim da
   * transação. Sem isso, a checagem de conflito ("tem alguém nesse
   * horário?") e a gravação eram passos separados: duas reservas
   * simultâneas passavam as duas pela checagem e o mesmo horário era
   * vendido duas vezes (reproduzido no teste de integração com 5 reservas
   * ao mesmo tempo). Advisory lock do Postgres por barbeiro: reservas de
   * barbeiros diferentes continuam em paralelo.
   */
  private async lockSchedule(tx: Prisma.TransactionClient, barberId: number, resourceId?: number) {
    // Quem tem conta pode atender em várias unidades: a trava é da pessoa,
    // pra duas unidades não venderem o mesmo horário dela ao mesmo tempo
    const barber = await tx.barber.findUnique({
      where: { id: barberId },
      select: { userId: true },
    });
    if (barber?.userId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(3, ${barber.userId}::int)`;
    } else {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(1, ${barberId}::int)`;
    }
    if (resourceId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(2, ${resourceId}::int)`;
    }
  }

  // Tudo que vem por id do front precisa pertencer a esta barbearia/rede —
  // antes dava pra agendar/vender pra cliente de outra franquia (e resgatar
  // os pontos de fidelidade dele), ou usar barbeiro/serviço/produto de outra
  // unidade, só trocando o id na requisição.
  private async ensureCustomerOfNetwork(networkId: number, customerId: number) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, networkId },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado');
  }

  private async ensureBarberOfBarbershop(barbershopId: number, barberId: number) {
    const barber = await this.prisma.barber.findFirst({
      where: { id: barberId, barbershopId, ...BOOKABLE_STAFF },
      select: { id: true },
    });
    if (!barber) throw new NotFoundException('Profissional não encontrado');
  }

  private async ensureItemsOfBarbershop(
    barbershopId: number,
    serviceIds: number[],
    productIds: number[] = [],
  ) {
    const uniqueServices = [...new Set(serviceIds)];
    const uniqueProducts = [...new Set(productIds)];
    const [services, products] = await Promise.all([
      uniqueServices.length
        ? this.prisma.barbershopService.count({
            where: { id: { in: uniqueServices }, barbershopId },
          })
        : 0,
      uniqueProducts.length
        ? this.prisma.barbershopProduct.count({
            where: { id: { in: uniqueProducts }, barbershopId },
          })
        : 0,
    ]);
    if (services !== uniqueServices.length) throw new NotFoundException('Serviço não encontrado');
    if (products !== uniqueProducts.length) throw new NotFoundException('Produto não encontrado');
  }

  private async ensureResourceAvailable(
    barbershopId: number,
    resourceId: number,
    startAt: Date,
    endAt: Date,
    excludeAppointmentId?: number,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const conflict = await client.appointment.findFirst({
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

  /** Os vínculos da mesma pessoa em todas as unidades (ou só este, sem conta) */
  private async samePersonBarberIds(
    barberId: number,
    userId: number | null | undefined,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<number[]> {
    if (!userId) return [barberId];
    const all = await client.barber.findMany({ where: { userId }, select: { id: true } });
    return [...new Set([barberId, ...all.map((b) => b.id)])];
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
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const barber = await client.barber.findFirst({
      where: { id: barberId, barbershopId },
      select: { userId: true, accessStartsAt: true, accessEndsAt: true },
    });
    if (barber && !withinEngagement(barber, startAt)) {
      throw new BadRequestException(
        'Esse horário está fora do período deste profissional na unidade',
      );
    }
    // A mesma pessoa pode atender em outras unidades: o horário dela é um só
    const barberIds = await this.samePersonBarberIds(barberId, barber?.userId, client);
    const conflict = await client.appointment.findFirst({
      where: {
        barberId: { in: barberIds },
        id: excludeAppointmentId ? { not: excludeAppointmentId } : undefined,
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { barbershopId: true },
    });
    if (conflict) {
      // De outra unidade só diz que está ocupado — nada do atendimento de lá
      throw new BadRequestException(
        conflict.barbershopId === barbershopId
          ? 'Este profissional já tem um agendamento nesse horário'
          : 'Este profissional já está ocupado em outra unidade nesse horário',
      );
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
      /** Agendamento recorrente (ver AppointmentSeriesService) */
      seriesId?: string;
      seriesIndex?: number;
    },
    /** notify = false: a série manda um e-mail só, com todas as datas */
    opts: { notify?: boolean } = {},
  ) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'basic');
    const ownBarberId = await this.ownBarberIdIfBarber(userId, barbershop);
    if (ownBarberId !== null && data.barberId !== ownBarberId) {
      throw new ForbiddenException('Seu cargo só permite agendar na sua própria agenda.');
    }
    await this.ensureCustomerOfNetwork(barbershop.networkId, data.customerId);
    await this.ensureBarberOfBarbershop(barbershopId, data.barberId);
    await this.ensureItemsOfBarbershop(
      barbershopId,
      data.services.map((s) => s.serviceId),
    );
    const { services, depositAmount, depositPaid, ...appointmentData } = data;
    // Se nenhum valor de sinal foi informado, usa o sugerido no primeiro
    // serviço (se essa unidade configurou um) — evita a equipe ter que
    // lembrar de repetir o valor toda vez.
    let resolvedDeposit = depositAmount;
    if (resolvedDeposit === undefined && services[0]) {
      const svc = await this.prisma.barbershopService.findUnique({
        where: { id: services[0].serviceId },
      });
      resolvedDeposit = svc?.depositAmount ? Number(svc.depositAmount) : undefined;
    }
    const created = await this.prisma.$transaction(async (tx) => {
      // Checagem de conflito e gravação sob a mesma trava (ver lockSchedule)
      await this.lockSchedule(tx, data.barberId, data.resourceId);
      await this.ensureBarberAvailable(
        barbershopId,
        data.barberId,
        data.startAt,
        data.endAt,
        undefined,
        tx,
      );
      if (data.resourceId) {
        await this.ensureResourceAvailable(
          barbershopId,
          data.resourceId,
          data.startAt,
          data.endAt,
          undefined,
          tx,
        );
      }
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
    // Marcado pela equipe (telefone, balcão): o cliente também recebe a
    // confirmação com o link pra remarcar/cancelar, como no agendamento online
    if (
      opts.notify !== false &&
      created &&
      created.status === 'CONFIRMED' &&
      created.customer.email
    ) {
      this.sendAppointmentEmail(
        created.id,
        'appointment_confirmation',
        created.customer.email,
      ).catch((err) =>
        this.logger.error(`Erro ao enviar confirmação do agendamento #${created.id}:`, err),
      );
    }
    return (
      created &&
      this.hideAppointmentContact(await this.contactVisibility(userId, barbershop), created)
    );
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
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'basic');
    const where: any = { barbershopId };
    if (filters?.barberId) where.barberId = filters.barberId;
    // Barbeiro vê só a própria agenda
    const ownBarberId = await this.ownBarberIdIfBarber(userId, barbershop);
    if (ownBarberId !== null) where.barberId = ownBarberId;
    if (filters?.customerId) where.customerId = filters.customerId;
    if (filters?.status) where.status = filters.status;
    if (filters?.startFrom || filters?.startTo) {
      where.startAt = {};
      if (filters.startFrom) where.startAt.gte = filters.startFrom;
      if (filters.startTo) where.startAt.lte = filters.startTo;
    }
    const appointments = await this.prisma.appointment.findMany({
      where,
      include: {
        services: { include: { service: true } },
        customer: true,
        barber: true,
        sale: { select: { id: true } },
      },
      orderBy: { startAt: 'asc' },
      // Agenda (semana/mês): o período inteiro — com 50 fixo, numa semana
      // movimentada os horários além do 50º simplesmente não apareciam
      take: filters?.limit ?? (filters?.startFrom && filters?.startTo ? MAX_AGENDA_ROWS : 50),
      skip: filters?.offset ?? 0,
    });
    const canSee = await this.contactVisibility(userId, barbershop);
    return appointments.map(({ sale, ...a }) =>
      this.hideAppointmentContact(canSee, { ...a, saleId: sale?.id ?? null }),
    );
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

    // Onde a pessoa é barbeiro, entra só a agenda dela
    const where: any = {
      barbershopId: { in: barbershopIds },
      OR: [
        { barbershop: { ownerUserId: userId } },
        { barbershop: { network: { ownerUserId: userId } } },
        {
          barbershop: {
            barbers: {
              some: {
                userId,
                staffType: { in: ['manager', 'reception'] },
                ...currentEngagement(),
              },
            },
          },
        },
        { barber: { userId, ...currentEngagement() } },
      ],
    };
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
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'basic');
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, barbershopId },
      include: { services: { include: { service: true } }, customer: true, barber: true },
    });
    if (!appointment) throw new NotFoundException('Agendamento não encontrado');
    this.ensureOwnAppointment(await this.ownBarberIdIfBarber(userId, barbershop), appointment);
    return this.hideAppointmentContact(
      await this.contactVisibility(userId, barbershop),
      appointment,
    );
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
    opts: { refundDeposit?: boolean } = {},
  ) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'basic');
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, barbershopId },
    });
    if (!appointment) throw new NotFoundException('Agendamento não encontrado');
    const ownBarberId = await this.ownBarberIdIfBarber(userId, barbershop);
    this.ensureOwnAppointment(ownBarberId, appointment);
    if (ownBarberId !== null && data.barberId && data.barberId !== ownBarberId) {
      throw new ForbiddenException('Seu cargo só permite mexer na sua própria agenda.');
    }
    if (data.customerId) await this.ensureCustomerOfNetwork(barbershop.networkId, data.customerId);
    if (data.barberId) await this.ensureBarberOfBarbershop(barbershopId, data.barberId);
    const barberId = data.barberId ?? appointment.barberId;
    const resourceId = data.resourceId ?? appointment.resourceId ?? undefined;
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockSchedule(tx, barberId, resourceId);
      await this.ensureBarberAvailable(
        barbershopId,
        barberId,
        data.startAt ?? appointment.startAt,
        data.endAt ?? appointment.endAt,
        appointmentId,
        tx,
      );
      if (resourceId) {
        await this.ensureResourceAvailable(
          barbershopId,
          resourceId,
          data.startAt ?? appointment.startAt,
          data.endAt ?? appointment.endAt,
          appointmentId,
          tx,
        );
      }
      return tx.appointment.update({
        where: { id: appointmentId },
        data,
        include: { services: { include: { service: true } }, customer: true, barber: true },
      });
    });

    // Vaga liberada por cancelamento — avisa o primeiro da lista de espera
    // que combine (mesma data, mesmo barbeiro/serviço se especificado).
    // Não bloqueia a resposta da mutation nem falha ela: notificação é
    // best-effort (erro de WhatsApp/e-mail não deve impedir o cancelamento).
    const moved =
      data.startAt != null && new Date(data.startAt).getTime() !== appointment.startAt.getTime();
    if (data.status === 'CANCELLED' && appointment.status !== 'CANCELLED') {
      this.checkWaitlistOnCancellation(barbershopId, updated).catch((err) =>
        this.logger.error(
          `Erro ao verificar lista de espera do agendamento #${appointmentId}:`,
          err,
        ),
      );
    }

    // Remarcou pela agenda: o horário antigo ficou livre
    if (moved && appointment.status === 'CONFIRMED' && data.status !== 'CANCELLED') {
      this.checkWaitlistOnCancellation(barbershopId, {
        ...updated,
        startAt: appointment.startAt,
        barberId: appointment.barberId,
      }).catch((err) =>
        this.logger.error(
          `Erro ao verificar lista de espera do agendamento #${appointmentId}:`,
          err,
        ),
      );
    }

    // A unidade cancelou: o sinal pago online volta pro cliente (a equipe
    // pode optar por reter, ex.: cliente avisou em cima da hora). Falta
    // (NO_SHOW) retém o sinal — é pra isso que ele existe.
    if (
      data.status === 'CANCELLED' &&
      appointment.status !== 'CANCELLED' &&
      opts.refundDeposit !== false &&
      appointment.depositPaid &&
      appointment.depositPaidAt
    ) {
      try {
        if (await this.refundOnlineDeposit(appointmentId)) {
          Object.assign(updated, { depositPaid: false, depositRefundedAt: new Date() });
        }
      } catch (err) {
        this.logger.error(`Erro ao estornar o sinal do agendamento #${appointmentId}:`, err);
      }
    }

    // Taxa de no-show/cancelamento tardio: cobrança 100% manual (mesma
    // filosofia do sinal e do cartão-presente) — só calcula e registra o
    // valor devido, não cobra sozinho. Best-effort: nunca bloqueia a
    // mutation nem falha o cancelamento em si.
    if (
      (data.status === 'CANCELLED' || data.status === 'NO_SHOW') &&
      appointment.status !== data.status
    ) {
      this.recordNoShowFee(barbershopId, updated, data.status).catch((err) =>
        this.logger.error(
          `Erro ao registrar taxa de no-show do agendamento #${appointmentId}:`,
          err,
        ),
      );
    }

    // A equipe mudou o horário ou cancelou: o cliente fica sabendo (antes só
    // descobria no lembrete, ou chegando na barbearia)
    const to = updated.customer.email;
    if (to && updated.startAt > new Date()) {
      const moved = updated.startAt.getTime() !== appointment.startAt.getTime();
      const cancelledNow = data.status === 'CANCELLED' && appointment.status !== 'CANCELLED';
      const template = cancelledNow
        ? 'appointment_cancelled'
        : moved && updated.status === 'CONFIRMED'
        ? 'appointment_rescheduled'
        : null;
      if (template) {
        this.sendAppointmentEmail(updated.id, template, to).catch((err) =>
          this.logger.error(`Erro ao avisar o cliente do agendamento #${appointmentId}:`, err),
        );
      }
    }

    return this.hideAppointmentContact(await this.contactVisibility(userId, barbershop), updated);
  }

  private async recordNoShowFee(
    barbershopId: number,
    appointment: {
      id: number;
      startAt: Date;
      services: Array<{ unitPrice: Decimal; quantity: number }>;
      customer: { id: number };
    },
    newStatus: string,
  ) {
    const barbershop = await this.prisma.barbershop.findUnique({
      where: { id: barbershopId },
      include: { network: true },
    });
    if (!barbershop) return;
    const { network } = barbershop;
    if (!network.noShowFeeEnabled) return;

    const isNoShow = newStatus === 'NO_SHOW';
    const isLateCancellation =
      newStatus === 'CANCELLED' &&
      appointment.startAt.getTime() - Date.now() < network.lateCancellationWindowHours * 3600000;
    if (!isNoShow && !isLateCancellation) return;

    // appointmentId é único em NoShowFee — calcula uma vez só, mesmo que o
    // status mude de novo depois.
    const existing = await this.prisma.noShowFee.findUnique({
      where: { appointmentId: appointment.id },
    });
    if (existing) return;

    const serviceTotal = appointment.services.reduce(
      (sum, s) => sum + Number(s.unitPrice) * s.quantity,
      0,
    );
    if (serviceTotal <= 0) return;

    let feeAmount = 0;
    if (network.noShowFeeType === 'PERCENT' && network.noShowFeeValue) {
      feeAmount = serviceTotal * (network.noShowFeeValue / 100);
    } else if (network.noShowFeeType === 'FIXED' && network.noShowFeeValue) {
      feeAmount = network.noShowFeeValue;
    }
    if (feeAmount <= 0) return;

    await this.prisma.noShowFee.create({
      data: {
        appointmentId: appointment.id,
        customerId: appointment.customer.id,
        barbershopId,
        amount: new Decimal(feeAmount),
        currency: barbershop.currency,
        reason: isNoShow ? 'NO_SHOW' : 'LATE_CANCELLATION',
      },
    });
  }

  async deleteAppointment(userId: number, barbershopId: number, appointmentId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, barbershopId },
    });
    if (!appointment) throw new NotFoundException('Agendamento não encontrado');
    if (appointment.depositPaid && appointment.depositPaidAt) {
      throw new BadRequestException(
        'Este horário tem sinal pago online. Cancele (o sinal é estornado) em vez de excluir.',
      );
    }
    await this.prisma.appointment.delete({ where: { id: appointmentId } });
  }

  /**
   * Estorna o sinal pago online (Stripe). Marca antes de chamar o Stripe —
   * dois cliques, ou cliente e unidade ao mesmo tempo, não estornam duas
   * vezes — e desfaz a marca se o Stripe recusar. Sem sinal online pago
   * (ou já estornado): false.
   */
  async refundOnlineDeposit(appointmentId: number) {
    const appt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { depositPaymentIntentId: true, depositPaidAt: true },
    });
    const intentId = appt?.depositPaymentIntentId;
    if (!intentId || !appt.depositPaidAt) return false;
    const now = new Date();
    const claimed = await this.prisma.appointment.updateMany({
      where: {
        id: appointmentId,
        depositPaid: true,
        depositRefundedAt: null,
        depositPaymentIntentId: intentId,
      },
      data: { depositPaid: false, depositRefundedAt: now },
    });
    if (claimed.count === 0) return false;
    try {
      await this.stripeService.createRefund(
        intentId,
        undefined,
        'requested_by_customer',
        `deposit-refund-${intentId}`,
      );
    } catch (err) {
      // Já estornado direto no painel do Stripe: vale como estornado
      if ((err as { code?: string })?.code === 'charge_already_refunded') return true;
      await this.prisma.appointment.updateMany({
        where: { id: appointmentId, depositRefundedAt: now },
        data: { depositPaid: true, depositRefundedAt: null },
      });
      throw err;
    }
    return true;
  }

  /** Estorno manual do sinal pago online (gerente e dono). */
  async refundAppointmentDeposit(userId: number, barbershopId: number, appointmentId: number) {
    const barbershop = await this.ensureAccess(userId, barbershopId, 'manager');
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, barbershopId },
    });
    if (!appointment) throw new NotFoundException('Agendamento não encontrado');
    if (appointment.depositRefundedAt) throw new BadRequestException('O sinal já foi estornado');
    if (!appointment.depositPaid || !appointment.depositPaidAt) {
      throw new BadRequestException('Este horário não tem sinal pago online');
    }
    let refunded: boolean;
    try {
      refunded = await this.refundOnlineDeposit(appointmentId);
    } catch (err) {
      this.logger.error(`Erro ao estornar o sinal do agendamento #${appointmentId}:`, err);
      throw new BadRequestException('Não foi possível estornar agora. Tente de novo.');
    }
    if (!refunded) throw new BadRequestException('O sinal já foi estornado');
    const updated = await this.prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      include: { services: { include: { service: true } }, customer: true, barber: true },
    });
    return this.hideAppointmentContact(await this.contactVisibility(userId, barbershop), updated);
  }

  async setAppointmentDepositPaid(
    userId: number,
    barbershopId: number,
    appointmentId: number,
    depositPaid: boolean,
  ) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId);
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, barbershopId },
    });
    if (!appointment) throw new NotFoundException('Agendamento não encontrado');
    this.ensureOwnAppointment(await this.ownBarberIdIfBarber(userId, barbershop), appointment);
    // Sinal online: só o Stripe muda (pago) ou o estorno (desfaz)
    if (appointment.depositPaidAt || appointment.depositRefundedAt) {
      throw new BadRequestException(
        'Sinal pago online: use "Estornar sinal" pra devolver ao cliente.',
      );
    }
    return this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { depositPaid },
    });
  }

  // ============ LISTA DE ESPERA ============
  // Manual (staff adiciona) — quando um agendamento cancela e combina com
  // uma entrada aqui, o primeiro da fila é avisado por WhatsApp/e-mail que
  // abriu vaga. Não reagenda sozinho, só notifica (evita criar um
  // agendamento que o cliente não confirmou de fato).

  async getWaitlistEntries(userId: number, barbershopId: number, status?: string) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId);
    const entries = await this.prisma.waitlistEntry.findMany({
      where: { barbershopId, status: status ?? undefined },
      include: { customer: true, barber: true, service: true },
      orderBy: { createdAt: 'asc' },
    });
    const canSee = await this.contactVisibility(userId, barbershop);
    return entries.map((e) => this.hideAppointmentContact(canSee, e));
  }

  async createWaitlistEntry(
    userId: number,
    barbershopId: number,
    data: { customerId: number; barberId?: number; serviceId?: number; date: Date; notes?: string },
  ) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId);
    const entry = await this.prisma.waitlistEntry.create({
      data: { ...data, barbershopId },
      include: { customer: true, barber: true, service: true },
    });
    return this.hideAppointmentContact(await this.contactVisibility(userId, barbershop), entry);
  }

  async cancelWaitlistEntry(userId: number, barbershopId: number, id: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const entry = await this.prisma.waitlistEntry.findFirst({ where: { id, barbershopId } });
    if (!entry) throw new NotFoundException('Entrada da lista de espera não encontrada');
    return this.prisma.waitlistEntry.update({ where: { id }, data: { status: 'CANCELLED' } });
  }

  /**
   * Um horário ficou livre (cancelado, remarcado, reserva sem sinal que
   * expirou): avisa o primeiro da lista de espera que combine. Horário que
   * já passou não interessa a ninguém.
   */
  async checkWaitlistOnCancellation(
    barbershopId: number,
    appointment: { startAt: Date; barberId: number; services: { serviceId: number }[] },
  ) {
    if (appointment.startAt <= new Date()) return;
    // WaitlistEntry.date é gravada como meia-noite UTC do dia escolhido
    // (new Date("YYYY-MM-DD")); o dia do agendamento tem de ser o do fuso da
    // unidade — em UTC, um horário depois das 21h em Brasília já caía no dia
    // seguinte e não achava ninguém na lista.
    const shop = await this.prisma.barbershop.findUnique({
      where: { id: barbershopId },
      select: { timezone: true },
    });
    const localDate = toZonedParts(appointment.startAt, safeTimeZone(shop?.timezone)).dateStr;
    const dayStart = new Date(`${localDate}T00:00:00Z`);
    const dayEnd = new Date(`${nextDateStr(localDate)}T00:00:00Z`);
    const serviceIds = appointment.services.map((s) => s.serviceId);

    const candidates = await this.prisma.waitlistEntry.findMany({
      where: {
        barbershopId,
        status: 'WAITING',
        date: { gte: dayStart, lt: dayEnd },
        OR: [{ barberId: null }, { barberId: appointment.barberId }],
      },
      include: { customer: true, barbershop: true },
      orderBy: { createdAt: 'asc' },
    });
    const match = candidates.find((c) => c.serviceId == null || serviceIds.includes(c.serviceId));
    if (!match) return;

    await this.prisma.waitlistEntry.update({
      where: { id: match.id },
      data: { status: 'NOTIFIED', notifiedAt: new Date() },
    });
    // Quem está na tela da lista de espera vê a entrada virar "avisado"
    this.realtime.notify(barbershopId, 'WAITLIST', 'UPDATED');

    // Cliente não tem idioma salvo: língua do país da unidade
    const lang = langForCountry(match.barbershop.country);
    const dateStr = appointment.startAt.toLocaleDateString(LOCALE[lang], {
      timeZone: match.barbershop.timezone,
    });
    const timeStr = appointment.startAt.toLocaleTimeString(LOCALE[lang], {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: match.barbershop.timezone,
    });

    // Envio pela fila (tentativas + limite de taxa), sem segurar o
    // cancelamento esperando o Mailgun/a Meta responderem
    try {
      if (match.customer.email) {
        await this.notificationQueue.email(
          {
            kind: 'customer',
            loggedAgainstUserId: match.barbershop.ownerUserId ?? 0,
            template: 'waitlist_slot_available',
            context: {
              CustomerName: match.customer.name,
              BarbershopName: match.barbershop.name,
              BarbershopPhone: match.barbershop.phone,
              AppointmentDate: dateStr,
              AppointmentTime: timeStr,
              Year: new Date().getFullYear(),
            },
            subject: {
              pt: `Vaga disponível em ${match.barbershop.name}`,
              en: `A slot opened up at ${match.barbershop.name}`,
              es: `Hay un horario disponible en ${match.barbershop.name}`,
            },
            lang,
            meta: 'waitlist-slot-available',
            to: match.customer.email,
          },
          `waitlist-email-${match.id}`,
        );
      }

      const phone = this.whatsappService.isConfigured()
        ? normalizePhoneToE164(match.customer.phone)
        : null;
      if (phone) {
        await this.notificationQueue.whatsapp(
          {
            kind: 'waitlist-slot',
            to: phone,
            params: {
              customerName: match.customer.name,
              barbershopName: match.barbershop.name,
              date: dateStr,
              time: timeStr,
            },
          },
          `waitlist-whatsapp-${match.id}`,
        );
      }
    } catch (err) {
      this.logger.error(`Erro ao enfileirar aviso da lista de espera #${match.id}:`, err);
    }
  }

  // ============ CAMPANHAS DE MARKETING (Message Blast) ============
  // Disparo segmentado por WhatsApp/e-mail. Guarda só o resumo de cada
  // campanha (não uma linha por destinatário) e respeita
  // Customer.marketingOptOut. WhatsApp precisa de um template genérico
  // aprovado (ver .env.example); sem credencial configurada, envia só
  // por e-mail.

  private async resolveMarketingSegment(
    networkId: number,
    barbershopId: number,
    segment: string,
    inactiveDays?: number,
  ) {
    const baseWhere = { networkId, isActive: true, marketingOptOut: false };

    if (segment === 'INACTIVE') {
      const days = inactiveDays ?? 60;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const [recent, ever] = await Promise.all([
        this.prisma.serviceHistory.findMany({
          where: { barbershopId, performedAt: { gte: cutoff } },
          select: { customerId: true },
          distinct: ['customerId'],
        }),
        this.prisma.serviceHistory.findMany({
          where: { barbershopId },
          select: { customerId: true },
          distinct: ['customerId'],
        }),
      ]);
      const recentIds = new Set(recent.map((r) => r.customerId));
      const inactiveIds = ever.map((r) => r.customerId).filter((id) => !recentIds.has(id));
      return this.prisma.customer.findMany({ where: { ...baseWhere, id: { in: inactiveIds } } });
    }

    if (segment === 'BIRTHDAY_MONTH') {
      // Mês corrente no fuso da unidade; birthDate é data de calendário
      // gravada como meia-noite UTC (new Date("YYYY-MM-DD")), então o mês
      // dela é o UTC — getMonth() no fuso local jogava quem nasceu no dia 1
      // pro mês anterior num servidor a oeste de Greenwich.
      const shop = await this.prisma.barbershop.findUnique({
        where: { id: barbershopId },
        select: { timezone: true },
      });
      const currentMonth =
        Number(toZonedParts(new Date(), safeTimeZone(shop?.timezone)).dateStr.slice(5, 7)) - 1;
      const customers = await this.prisma.customer.findMany({
        where: { ...baseWhere, birthDate: { not: null } },
      });
      return customers.filter((c) => c.birthDate && c.birthDate.getUTCMonth() === currentMonth);
    }

    // ALL
    return this.prisma.customer.findMany({ where: baseWhere });
  }

  async previewMarketingSegment(
    userId: number,
    barbershopId: number,
    segment: string,
    inactiveDays?: number,
  ) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const customers = await this.resolveMarketingSegment(
      barbershop.networkId,
      barbershopId,
      segment,
      inactiveDays,
    );
    return { recipientCount: customers.length };
  }

  async getMarketingCampaigns(userId: number, barbershopId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    return this.prisma.marketingCampaign.findMany({
      where: { barbershopId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async sendMarketingBlast(
    userId: number,
    barbershopId: number,
    data: {
      subject?: string;
      message: string;
      segment: string;
      inactiveDays?: number;
      sendEmail: boolean;
      sendWhatsapp: boolean;
    },
  ) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const customers = await this.resolveMarketingSegment(
      barbershop.networkId,
      barbershopId,
      data.segment,
      data.inactiveDays,
    );

    // Cria a campanha primeiro e enfileira um envio por cliente — antes o
    // loop enviava um por um dentro da própria requisição (milhares de
    // clientes = dezenas de minutos, timeout no meio e contagem errada).
    // Os workers atualizam emailSentCount/whatsappSentCount conforme enviam.
    const emailRecipients = data.sendEmail
      ? customers.filter((c): c is typeof c & { email: string } => !!c.email)
      : [];
    const whatsappPhones =
      data.sendWhatsapp && this.whatsappService.isConfigured()
        ? customers
            .map((c) => normalizePhoneToE164(c.phone))
            .filter((phone): phone is string => !!phone)
        : [];

    const campaign = await this.prisma.marketingCampaign.create({
      data: {
        barbershopId,
        createdByUserId: userId,
        subject: data.subject,
        message: data.message,
        segment: data.segment,
        inactiveDays: data.inactiveDays,
        sentByEmail: data.sendEmail,
        sentByWhatsapp: data.sendWhatsapp,
        recipientCount: customers.length,
        emailQueuedCount: emailRecipients.length,
        whatsappQueuedCount: whatsappPhones.length,
      },
    });

    await this.notificationQueue.emailBulk(
      emailRecipients.map((customer) => {
        // Cada e-mail leva o link de descadastro do próprio cliente (LGPD) e
        // os cabeçalhos de descadastro com um clique (Gmail/Yahoo exigem)
        const unsubscribe = unsubscribeLinks(customer.id);
        return {
          kind: 'customer' as const,
          loggedAgainstUserId: barbershop.ownerUserId ?? 0,
          template: 'marketing_blast',
          context: {
            BarbershopName: barbershop.name,
            Subject: data.subject ?? barbershop.name,
            Message: data.message,
            Year: new Date().getFullYear(),
            UnsubscribeURL: unsubscribe.page,
          },
          headers: unsubscribe.headers,
          subject: data.subject ?? barbershop.name,
          // Texto da campanha é do dono; o rodapé do template sai na língua do país da unidade
          lang: langForCountry(barbershop.country),
          meta: 'marketing-blast',
          to: customer.email,
          campaignId: campaign.id,
        };
      }),
    );
    await this.notificationQueue.whatsappBulk(
      whatsappPhones.map((phone) => ({
        kind: 'marketing' as const,
        to: phone,
        message: data.message,
        campaignId: campaign.id,
      })),
    );

    return campaign;
  }

  /**
   * Descadastro pelo link do e-mail de marketing (sem login). Marca a ficha
   * como fora das campanhas; devolve o nome da rede/unidade pra tela.
   */
  async unsubscribeFromMarketing(token: string): Promise<string> {
    const customerId = verifyUnsubscribeToken(token);
    if (!customerId) throw new BadRequestException('Link de descadastro inválido');
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: { network: { include: { barbershops: { take: 1, orderBy: { id: 'asc' } } } } },
    });
    if (!customer) throw new BadRequestException('Link de descadastro inválido');
    if (!customer.marketingOptOut) {
      await this.prisma.customer.update({
        where: { id: customerId },
        data: { marketingOptOut: true },
      });
    }
    return customer.network?.name || customer.network?.barbershops[0]?.name || 'Barbershop';
  }

  // ============ PÁGINA PÚBLICA E AGENDAMENTO ONLINE ============

  // Horário padrão e dias da semana: ver working-hours.ts (a tela de horário
  // de funcionamento usa os mesmos)
  private readonly DEFAULT_WORKING_HOURS = DEFAULT_WORKING_HOURS;
  private readonly WEEKDAY_KEYS = WEEKDAY_KEYS;

  async getPublicBarbershopByslug(slug: string) {
    const barbershop = await this.prisma.barbershop.findUnique({
      where: { slug },
      include: {
        services: { where: { isActive: true }, orderBy: { displayOrder: 'asc' } },
        barbers: {
          where: {
            isActive: true,
            AND: [
              BOOKABLE_STAFF,
              { OR: [{ accessEndsAt: null }, { accessEndsAt: { gte: new Date() } }] },
            ],
          },
          orderBy: { name: 'asc' },
        },
        network: { select: { accentColor: true, grayColor: true } },
      },
    });
    if (!barbershop || !barbershop.isActive) {
      throw new NotFoundException('Unidade não encontrada');
    }
    const imageUrl = barbershop.photoKey
      ? await this.s3Service.getDownloadUrl(barbershop.photoKey)
      : null;
    const { averageRating, reviewCount } = await this.getReviewSummary(barbershop.id);
    const isFeatured = barbershop.featuredUntil != null && barbershop.featuredUntil > new Date();
    const canOfferSubscriptions = await this.canAccessModule(barbershop.id, 'subscriptions');
    const subscriptionPlans = canOfferSubscriptions
      ? await this.prisma.clientSubscriptionPlan.findMany({
          where: { barbershopId: barbershop.id, isActive: true },
          include: { service: true },
          orderBy: { name: 'asc' },
        })
      : [];
    return {
      ...barbershop,
      imageUrl,
      averageRating,
      reviewCount,
      isFeatured,
      subscriptionPlans: subscriptionPlans.map((p) => ({
        ...p,
        serviceName: p.service?.name ?? null,
      })),
      // Cores definidas pelo dono da franquia — a página pública usa as mesmas
      accentColor: barbershop.network.accentColor,
      grayColor: barbershop.network.grayColor,
    };
  }

  // Mesma página pública de sempre (getPublicBarbershopByslug), só que
  // resolvida a partir do host (subdomain.<domínio>) em vez do caminho
  // /u/:slug — usado quando o front detecta que está rodando num
  // subdomínio próprio da unidade.
  async getPublicBarbershopBySubdomain(subdomain: string) {
    const barbershop = await this.prisma.barbershop.findFirst({
      where: { subdomain: subdomain.trim().toLowerCase(), isActive: true },
    });
    if (!barbershop) throw new NotFoundException('Unidade não encontrada');
    return this.getPublicBarbershopByslug(barbershop.slug);
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
  ): Promise<{
    start: string;
    end: string;
    breakStart?: string | null;
    breakEnd?: string | null;
  } | null> {
    const schedule = await this.prisma.barberSchedule.findUnique({
      where: { barberId_dayOfWeek: { barberId, dayOfWeek } },
    });
    if (schedule) {
      if (!schedule.isActive) return null;
      return {
        start: schedule.startTime,
        end: schedule.endTime,
        breakStart: schedule.breakStart,
        breakEnd: schedule.breakEnd,
      };
    }

    const barbershop = await this.prisma.barbershop.findUnique({
      where: { id: barbershopId },
      select: { businessHours: true },
    });
    if (barbershop?.businessHours) {
      try {
        const parsed = JSON.parse(barbershop.businessHours) as Record<
          string,
          { start: string; end: string } | null
        >;
        const dayHours = parsed[this.WEEKDAY_KEYS[dayOfWeek]];
        return dayHours ? { start: dayHours.start, end: dayHours.end } : null;
      } catch {
        // JSON inválido — cai para o horário padrão abaixo
      }
    }

    const fallback = this.DEFAULT_WORKING_HOURS[dayOfWeek];
    return fallback ? { ...fallback } : null;
  }

  /**
   * Expediente num dia específico, com os fechamentos da unidade (feriado,
   * reforma): dia fechado não tem expediente; horário especial limita o do
   * profissional — ou abre um dia que normalmente é fechado, pra quem não
   * tem folga marcada nesse dia da semana.
   */
  async getWorkingWindowOn(barbershopId: number, barberId: number, dateStr: string) {
    const dayOfWeek = dayOfWeekOf(dateStr);
    const [window, closure] = await Promise.all([
      this.getWorkingWindow(barbershopId, barberId, dayOfWeek),
      this.prisma.barbershopClosure.findUnique({
        where: { barbershopId_date: { barbershopId, date: dateStr } },
      }),
    ]);
    if (!closure) return window;
    if (!closure.openTime || !closure.closeTime) return null;
    const open = this.toMinutes(closure.openTime);
    const close = this.toMinutes(closure.closeTime);
    if (!window) {
      const ownSchedule = await this.prisma.barberSchedule.findUnique({
        where: { barberId_dayOfWeek: { barberId, dayOfWeek } },
        select: { id: true },
      });
      // Folga marcada nesse dia da semana continua sendo folga
      if (ownSchedule) return null;
      return { start: closure.openTime, end: closure.closeTime, breakStart: null, breakEnd: null };
    }
    const start = Math.max(this.toMinutes(window.start), open);
    const end = Math.min(this.toMinutes(window.end), close);
    if (start >= end) return null;
    const hhmm = (m: number) =>
      `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    return { ...window, start: hhmm(start), end: hhmm(end) };
  }

  private toMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  }

  /**
   * Serviços escolhidos na página pública (um ou vários, em sequência no
   * mesmo horário, como corte + barba): os da unidade, ativos, na ordem
   * pedida, e a duração somada.
   */
  private async publicServices(barbershopId: number, serviceIds: number[]) {
    const ids = [...new Set(serviceIds)].filter((id) => Number.isInteger(id));
    if (ids.length === 0) throw new BadRequestException('Escolha pelo menos um serviço');
    if (ids.length > 5) throw new BadRequestException('No máximo 5 serviços por agendamento');
    const found = await this.prisma.barbershopService.findMany({
      where: { id: { in: ids }, barbershopId, isActive: true },
    });
    if (found.length !== ids.length) throw new NotFoundException('Serviço não encontrado');
    const services = ids.map((id) => found.find((s) => s.id === id)!);
    return {
      services,
      durationMinutes: services.reduce((sum, s) => sum + s.durationMinutes, 0),
    };
  }

  /** Profissionais que a página pública oferece (ativos, no período, que atendem). */
  private publicBarbers(barbershopId: number) {
    return this.prisma.barber.findMany({
      where: { barbershopId, isActive: true, ...BOOKABLE_STAFF },
      orderBy: { id: 'asc' },
    });
  }

  /**
   * "Qualquer profissional": quem tem menos horários marcados no dia vem
   * primeiro — distribui os clientes da página pública pela equipe.
   */
  private async publicCandidatesByLoad(barbershopId: number, startAtInput: string) {
    const barbers = await this.publicBarbers(barbershopId);
    const day = new Date(startAtInput);
    if (isNaN(day.getTime())) throw new BadRequestException('Horário inválido');
    const counts = await this.prisma.appointment.groupBy({
      by: ['barberId'],
      where: {
        barbershopId,
        barberId: { in: barbers.map((b) => b.id) },
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        startAt: {
          gte: new Date(day.getTime() - 12 * 3_600_000),
          lte: new Date(day.getTime() + 12 * 3_600_000),
        },
      },
      _count: { _all: true },
    });
    const load = new Map(counts.map((c) => [c.barberId, c._count._all]));
    return [...barbers].sort(
      (a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || a.id - b.id,
    );
  }

  /**
   * Horários livres na página pública. Sem profissional ("qualquer
   * profissional", como no Booksy): todos os horários em que pelo menos um
   * está livre.
   */
  async getPublicAvailableSlots(
    barbershopId: number,
    barberId: number | null,
    serviceIds: number[],
    dateStr: string,
  ) {
    const { durationMinutes } = await this.publicServices(barbershopId, serviceIds);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || isNaN(Date.parse(`${dateStr}T00:00:00Z`))) {
      throw new BadRequestException('Data inválida');
    }
    // Tudo no fuso da unidade, não do servidor (ver common/timezone.util.ts)
    const shop = await this.prisma.barbershop.findUnique({
      where: { id: barbershopId },
      select: { timezone: true },
    });
    const timeZone = safeTimeZone(shop?.timezone);

    if (barberId != null) {
      const barber = await this.prisma.barber.findFirst({
        where: { id: barberId, barbershopId, isActive: true, ...BOOKABLE_STAFF },
      });
      if (!barber) throw new NotFoundException('Profissional não encontrado');
      return this.slotsForBarber(barbershopId, barber, durationMinutes, dateStr, timeZone);
    }
    const all = await Promise.all(
      (
        await this.publicBarbers(barbershopId)
      ).map((b) => this.slotsForBarber(barbershopId, b, durationMinutes, dateStr, timeZone)),
    );
    return [...new Set(all.flat())].sort();
  }

  /**
   * Próximo horário livre (a partir de hoje ou de `fromDate`, até 60 dias):
   * do profissional escolhido ou, sem profissional, o mais cedo entre todos.
   * O cliente não precisa sair testando dia por dia.
   */
  async getPublicNextAvailableSlot(
    barbershopId: number,
    barberId: number | null,
    serviceIds: number[],
    fromDate?: string | null,
  ): Promise<{ date: string; startAt: string } | null> {
    const { durationMinutes } = await this.publicServices(barbershopId, serviceIds);
    const shop = await this.prisma.barbershop.findUnique({
      where: { id: barbershopId },
      select: { timezone: true },
    });
    if (!shop) throw new NotFoundException('Unidade não encontrada');
    const timeZone = safeTimeZone(shop.timezone);
    let barbers: Awaited<ReturnType<BarbershopService['publicBarbers']>>;
    if (barberId != null) {
      const barber = await this.prisma.barber.findFirst({
        where: { id: barberId, barbershopId, isActive: true, ...BOOKABLE_STAFF },
      });
      if (!barber) throw new NotFoundException('Profissional não encontrado');
      barbers = [barber];
    } else {
      barbers = await this.publicBarbers(barbershopId);
    }
    if (barbers.length === 0) return null;

    const today = toZonedParts(new Date(), timeZone).dateStr;
    const valid =
      !!fromDate &&
      /^\d{4}-\d{2}-\d{2}$/.test(fromDate) &&
      !isNaN(Date.parse(`${fromDate}T00:00:00Z`));
    // Data no passado vira hoje; muito longe não varre o ano inteiro
    const start =
      valid && fromDate > today && fromDate <= addDaysStr(today, 365) ? fromDate : today;
    for (let i = 0; i < NEXT_AVAILABLE_DAYS; i++) {
      const date = addDaysStr(start, i);
      const perBarber = await Promise.all(
        barbers.map((b) => this.slotsForBarber(barbershopId, b, durationMinutes, date, timeZone)),
      );
      const earliest = perBarber
        .map((slots) => slots[0])
        .filter(Boolean)
        .sort()[0];
      if (earliest) return { date, startAt: earliest };
    }
    return null;
  }

  private async slotsForBarber(
    barbershopId: number,
    barber: {
      id: number;
      userId: number | null;
      accessStartsAt: Date | null;
      accessEndsAt: Date | null;
    },
    duration: number,
    dateStr: string,
    timeZone: string,
  ) {
    const window = await this.getWorkingWindowOn(barbershopId, barber.id, dateStr);
    if (!window) return [];
    const barberIds = await this.samePersonBarberIds(barber.id, barber.userId);

    const dayStart = zonedTimeToUtc(dateStr, 0, timeZone);
    const dayEnd = zonedTimeToUtc(nextDateStr(dateStr), 0, timeZone);

    const [appointments, timeOffs] = await Promise.all([
      // Ocupado aqui ou em outra unidade onde a pessoa também atende
      this.prisma.appointment.findMany({
        where: {
          barberId: { in: barberIds },
          status: { notIn: ['CANCELLED', 'NO_SHOW'] },
          startAt: { lt: dayEnd },
          endAt: { gt: dayStart },
        },
        select: { startAt: true, endAt: true },
      }),
      this.prisma.barberTimeOff.findMany({
        where: { barberId: { in: barberIds }, startAt: { lt: dayEnd }, endAt: { gt: dayStart } },
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

    for (
      let minutes = windowStartMin;
      minutes + duration <= windowEndMin;
      minutes += SLOT_GRANULARITY_MIN
    ) {
      if (breakStartMin != null && breakEndMin != null) {
        const overlapsBreak = minutes < breakEndMin && minutes + duration > breakStartMin;
        if (overlapsBreak) continue;
      }

      const slotStart = zonedTimeToUtc(dateStr, minutes, timeZone);
      const slotEnd = new Date(slotStart.getTime() + duration * 60000);

      if (slotStart <= now) continue;
      if (!withinEngagement(barber, slotStart)) continue;

      const overlapsBusy = busyRanges.some(
        (r) => slotStart.getTime() < r.end && slotEnd.getTime() > r.start,
      );
      if (overlapsBusy) continue;

      slots.push(slotStart.toISOString());
    }

    return slots;
  }

  /**
   * Horário escolhido pelo cliente (agendar ou remarcar pela página pública):
   * revalida no servidor a janela de trabalho e o intervalo — nunca confia só
   * na lista de horários que o cliente buscou antes (pode estar desatualizada
   * ou ter sido manipulada). Dia da semana e hora de parede no fuso da
   * unidade, não do servidor. O conflito com outros horários é checado por
   * quem chama, dentro da transação.
   */
  private async ensurePublicSlot(
    barbershop: { id: number; timezone: string | null },
    barberId: number,
    durationMinutes: number,
    startAtInput: string,
  ) {
    const startAt = new Date(startAtInput);
    if (isNaN(startAt.getTime()) || startAt <= new Date()) {
      throw new BadRequestException('Horário inválido');
    }
    const endAt = new Date(startAt.getTime() + durationMinutes * 60000);
    const local = toZonedParts(startAt, safeTimeZone(barbershop.timezone));
    const window = await this.getWorkingWindowOn(barbershop.id, barberId, local.dateStr);
    if (!window) throw new BadRequestException('Profissional não atende nesse dia');
    const startMin = local.minutesOfDay;
    const endMin = startMin + durationMinutes;
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
    return { startAt, endAt };
  }

  async createPublicAppointment(input: {
    barbershopId: number;
    /** Sem profissional: "qualquer profissional" — o sistema escolhe um livre */
    barberId?: number | null;
    /** Um serviço ou vários, em sequência no mesmo horário */
    serviceIds: number[];
    startAt: string;
    customerName: string;
    customerPhone: string;
    customerEmail?: string;
    notes?: string;
    clientAccountId?: number;
    referralCode?: string;
  }) {
    const barbershop = await this.prisma.barbershop.findFirst({
      where: { id: input.barbershopId, isActive: true },
    });
    if (!barbershop) throw new NotFoundException('Unidade não encontrada');

    const { services, durationMinutes } = await this.publicServices(
      input.barbershopId,
      input.serviceIds,
    );
    const auto = input.barberId == null;
    let candidates: Array<{ id: number }>;
    if (!auto) {
      const barber = await this.prisma.barber.findFirst({
        where: {
          id: input.barberId!,
          barbershopId: input.barbershopId,
          isActive: true,
          ...BOOKABLE_STAFF,
        },
      });
      if (!barber) throw new NotFoundException('Profissional não encontrado');
      candidates = [barber];
    } else {
      candidates = await this.publicCandidatesByLoad(input.barbershopId, input.startAt);
    }

    // Quem pode atender nesse horário (expediente, intervalo, período do
    // vínculo e agenda livre). Checagem rápida antes de criar o cliente — a
    // definitiva é dentro da transação, sob a trava da agenda
    let startAt!: Date;
    let endAt!: Date;
    const free: number[] = [];
    let lastError: unknown = null;
    for (const c of candidates) {
      try {
        const slot = await this.ensurePublicSlot(barbershop, c.id, durationMinutes, input.startAt);
        await this.ensureBarberAvailable(input.barbershopId, c.id, slot.startAt, slot.endAt);
        startAt = slot.startAt;
        endAt = slot.endAt;
        free.push(c.id);
        if (!auto) break;
      } catch (err) {
        // Profissional escolhido: o motivo vai pro cliente; no automático, tenta o próximo
        if (!auto || !(err instanceof BadRequestException)) throw err;
        lastError = err;
      }
    }
    if (free.length === 0) {
      throw lastError ?? new BadRequestException('Esse horário não está mais disponível');
    }

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

      // Registra a indicação (se veio um ?ref= válido) só na criação — cliente
      // já existente sendo reconhecido de novo não conta indicação retroativa.
      // Falha silenciosa em código inválido/de outra rede/auto-indicação: não
      // vale travar o agendamento por causa de um link de indicação quebrado.
      if (input.referralCode) {
        const referrerId = this.decodeReferralCode(input.referralCode);
        if (referrerId && referrerId !== customer.id) {
          const referrer = await this.prisma.customer.findFirst({
            where: { id: referrerId, networkId },
          });
          if (referrer) {
            await this.prisma.customerReferral.create({
              data: { networkId, referrerId: referrer.id, referredId: customer.id },
            });
          }
        }
      }
    }
    // Ficha que já existia (achada pelo telefone digitado) NÃO é ligada à
    // conta logada: o telefone não é confirmado, e ligar deixava qualquer um
    // ver o histórico de outra pessoa agendando com o telefone dela. A ficha
    // entra na conta quando o e-mail dela bate com o e-mail confirmado.

    const deposits = services.filter((sv) => sv.depositAmount != null);
    const depositAmount = deposits.length
      ? deposits.reduce((sum, sv) => sum.add(sv.depositAmount!), new Decimal(0))
      : null;
    // Sinal online: o horário fica reservado (aguardando pagamento) por
    // alguns minutos; sem pagar, é liberado (ver DepositPaymentService)
    const payOnline = barbershop.onlineDeposit && depositAmount != null && depositAmount.gt(0);
    const book = (barberId: number) =>
      this.prisma.$transaction(async (tx) => {
        await this.lockSchedule(tx, barberId);
        await this.ensureBarberAvailable(
          input.barbershopId,
          barberId,
          startAt,
          endAt,
          undefined,
          tx,
        );
        const appointment = await tx.appointment.create({
          data: {
            barbershopId: input.barbershopId,
            customerId: customer!.id,
            barberId,
            startAt,
            endAt,
            status: payOnline ? 'PENDING_PAYMENT' : 'CONFIRMED',
            holdExpiresAt: payOnline ? new Date(Date.now() + DEPOSIT_HOLD_MINUTES * 60_000) : null,
            source: 'ONLINE',
            notes: input.notes,
            depositAmount,
          },
        });
        await tx.appointmentService.createMany({
          data: services.map((sv) => ({
            appointmentId: appointment.id,
            serviceId: sv.id,
            unitPrice: sv.price,
          })),
        });
        return tx.appointment.findUnique({
          where: { id: appointment.id },
          include: { barbershop: true, barber: true, services: { include: { service: true } } },
        });
      });
    // No automático, se outra pessoa pegou o horário do escolhido nesse meio
    // tempo, vai pro próximo livre
    let created: Awaited<ReturnType<typeof book>> | null = null;
    for (const barberId of free) {
      try {
        created = await book(barberId);
        break;
      } catch (err) {
        if (!auto || !(err instanceof BadRequestException) || barberId === free[free.length - 1]) {
          throw err;
        }
      }
    }

    // Confirmação por e-mail com o link pra cancelar/remarcar (best-effort:
    // o horário já está marcado, e-mail fora do ar não desfaz nada)
    // Aguardando o sinal: a confirmação sai quando o pagamento for aprovado
    const confirmationEmail = input.customerEmail?.trim() || customer!.email;
    if (created && confirmationEmail && created.status === 'CONFIRMED') {
      this.sendAppointmentEmail(created.id, 'appointment_confirmation', confirmationEmail).catch(
        (err) =>
          this.logger.error(`Erro ao enviar confirmação do agendamento #${created.id}:`, err),
      );
    }
    return created;
  }

  /**
   * Confirmação ou aviso de horário remarcado, com o link "gerenciar
   * agendamento" (cancelar/remarcar sem login). Vai pela fila de e-mail.
   */
  /** Confirmação depois que o sinal online é pago */
  notifyAppointmentConfirmed(appointmentId: number, to: string) {
    return this.sendAppointmentEmail(appointmentId, 'appointment_confirmation', to);
  }

  /** Cancelamento pela unidade (ex.: fechamento no dia), com o motivo no e-mail */
  notifyAppointmentCancelled(
    appointmentId: number,
    to: string,
    reason?: string | null,
    seriesDates?: string[],
  ) {
    return this.sendAppointmentEmail(
      appointmentId,
      'appointment_cancelled',
      to,
      reason,
      seriesDates,
    );
  }

  /** Série recorrente: uma confirmação só, com todas as datas */
  notifySeriesConfirmed(firstAppointmentId: number, to: string, seriesDates: string[]) {
    return this.sendAppointmentEmail(
      firstAppointmentId,
      'appointment_confirmation',
      to,
      null,
      seriesDates,
    );
  }

  private async sendAppointmentEmail(
    appointmentId: number,
    template: 'appointment_confirmation' | 'appointment_rescheduled' | 'appointment_cancelled',
    to: string,
    reason?: string | null,
    /** Datas da série recorrente (já formatadas), listadas no e-mail */
    seriesDates?: string[],
  ) {
    const appt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        customer: true,
        barber: true,
        barbershop: { include: { network: true } },
        services: { include: { service: true } },
      },
    });
    if (!appt) return;
    const shop = appt.barbershop;
    // Cliente não tem idioma salvo: língua do país da unidade
    const lang = langForCountry(shop.country);
    const serviceNames =
      appt.services
        .map((s) => s.service?.name)
        .filter(Boolean)
        .join(', ') || '-';
    const subjects = {
      appointment_confirmation: {
        pt: `Horário confirmado em ${shop.name}`,
        en: `Appointment confirmed at ${shop.name}`,
        es: `Cita confirmada en ${shop.name}`,
      },
      appointment_rescheduled: {
        pt: `Horário remarcado em ${shop.name}`,
        en: `Appointment rescheduled at ${shop.name}`,
        es: `Cita reprogramada en ${shop.name}`,
      },
      appointment_cancelled: {
        pt: `Horário cancelado em ${shop.name}`,
        en: `Appointment cancelled at ${shop.name}`,
        es: `Cita cancelada en ${shop.name}`,
      },
    };
    await this.notificationQueue.email(
      {
        kind: 'customer',
        loggedAgainstUserId: shop.ownerUserId ?? 0,
        template,
        context: {
          CustomerName: appt.customer.name,
          BarbershopName: shop.name,
          BarbershopAddress: `${shop.address}, ${shop.city} - ${shop.state}`,
          BarbershopPhone: shop.phone,
          BarberName: appt.barber.name,
          ServiceNames: serviceNames,
          AppointmentDate: appt.startAt.toLocaleDateString(LOCALE[lang], {
            timeZone: shop.timezone,
          }),
          AppointmentTime: appt.startAt.toLocaleTimeString(LOCALE[lang], {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: shop.timezone,
          }),
          CancellationWindowHours: shop.network.lateCancellationWindowHours,
          ManageURL: appointmentManageUrl(appt.id),
          // "Adicionar à agenda" (Google, Outlook, .ics pro Apple e outros)
          ...appointmentCalendarLinks(appt, createAppointmentToken(appt.id)),
          BookURL: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/u/${shop.slug}`,
          Reason: reason || null,
          SeriesDates: seriesDates?.length ? seriesDates : null,
          Year: new Date().getFullYear(),
        },
        subject: subjects[template],
        lang,
        meta: template.replace('_', '-'),
        to,
      },
      // Uma confirmação por agendamento; remarcação, uma por novo horário
      template === 'appointment_confirmation'
        ? `appointment-confirmation-${appt.id}`
        : template === 'appointment_cancelled'
        ? `appointment-cancelled-${appt.id}`
        : `appointment-rescheduled-${appt.id}-${appt.startAt.getTime()}`,
    );
  }

  // ============ CLIENTE GERENCIA O PRÓPRIO HORÁRIO (link do e-mail) ============
  // Como no Booksy: pelo link da confirmação/lembrete o cliente cancela ou
  // remarca sem login, até a janela da política de cancelamento da rede
  // (Network.lateCancellationWindowHours). Dentro da janela, só falando com
  // a unidade — assim o cliente nunca cai numa taxa de cancelamento tardio
  // por um clique; quem decide é a barbearia.

  private async loadManagedAppointment(token: string) {
    const id = verifyAppointmentToken(token);
    const appt = id
      ? await this.prisma.appointment.findUnique({
          where: { id },
          include: {
            customer: true,
            barber: true,
            barbershop: { include: { network: true } },
            services: { include: { service: true } },
          },
        })
      : null;
    // Mesma resposta pra link adulterado e agendamento apagado
    if (!appt) throw new NotFoundException('Link inválido ou agendamento não encontrado');
    const windowHours = appt.barbershop.network.lateCancellationWindowHours;
    const changeDeadline = new Date(appt.startAt.getTime() - windowHours * 3600000);
    const canChange = appt.status === 'CONFIRMED' && new Date() < changeDeadline;
    return { appt, windowHours, changeDeadline, canChange };
  }

  private ensureChangeable(loaded: { canChange: boolean; appt: { status: string } }) {
    if (loaded.canChange) return;
    if (loaded.appt.status === 'CANCELLED') {
      throw new BadRequestException('Este agendamento já foi cancelado');
    }
    if (loaded.appt.status !== 'CONFIRMED') {
      throw new BadRequestException('Este agendamento não pode mais ser alterado');
    }
    throw new BadRequestException(
      'O prazo para cancelar ou remarcar pelo link já passou. Fale com a barbearia.',
    );
  }

  async getManagedAppointment(token: string) {
    const { appt, windowHours, changeDeadline, canChange } = await this.loadManagedAppointment(
      token,
    );
    // Vários serviços no mesmo horário: nomes juntos, preço somado
    const services = appt.services.filter((s) => s.service);
    const shop = appt.barbershop;
    return {
      id: appt.id,
      status: appt.status,
      startAt: appt.startAt.toISOString(),
      endAt: appt.endAt.toISOString(),
      canChange,
      changeDeadline: changeDeadline.toISOString(),
      cancellationWindowHours: windowHours,
      customerName: appt.customer.name,
      barbershopId: shop.id,
      barbershopName: shop.name,
      barbershopSlug: shop.slug,
      barbershopPhone: shop.phone,
      barbershopAddress: `${shop.address}, ${shop.city} - ${shop.state}`,
      timezone: shop.timezone,
      barberId: appt.barberId,
      barberName: appt.barber.name,
      serviceId: services[0]?.service?.id ?? null,
      serviceIds: services.map((s) => s.service!.id),
      serviceName: services.map((s) => s.service!.name).join(' + '),
      price: services.reduce((sum, s) => sum + Number(s.unitPrice) * (s.quantity ?? 1), 0),
      currency: shop.currency,
      depositAmount: appt.depositAmount != null ? Number(appt.depositAmount) : null,
      depositPaid: appt.depositPaid,
      depositRefunded: appt.depositRefundedAt != null,
      holdExpiresAt: appt.holdExpiresAt?.toISOString() ?? null,
    };
  }

  /**
   * Próximos horários do cliente logado (fichas ligadas à conta pelo e-mail
   * confirmado), com o mesmo link de gerenciar do e-mail — remarcar e
   * cancelar direto da conta, como no Booksy.
   */
  async getClientUpcomingAppointments(clientAccountId: number) {
    const appts = await this.prisma.appointment.findMany({
      where: {
        customer: { clientAccountId },
        status: { in: ['CONFIRMED', 'IN_PROGRESS'] },
        endAt: { gte: new Date() },
      },
      select: { id: true },
      orderBy: { startAt: 'asc' },
      take: 20,
    });
    return Promise.all(
      appts.map(async (a) => {
        const token = createAppointmentToken(a.id);
        return { ...(await this.getManagedAppointment(token)), manageToken: token };
      }),
    );
  }

  async cancelManagedAppointment(token: string) {
    const loaded = await this.loadManagedAppointment(token);
    this.ensureChangeable(loaded);
    const { appt } = loaded;
    // Condicional no status: dois cliques (ou a unidade mudando ao mesmo
    // tempo) não cancelam duas vezes nem passam por cima de outro status
    const updated = await this.prisma.appointment.updateMany({
      where: { id: appt.id, status: 'CONFIRMED' },
      data: { status: 'CANCELLED' },
    });
    if (updated.count === 0) {
      throw new BadRequestException('Este agendamento não pode mais ser alterado');
    }
    this.checkWaitlistOnCancellation(appt.barbershopId, appt).catch((err) =>
      this.logger.error(`Erro ao verificar lista de espera do agendamento #${appt.id}:`, err),
    );
    return { id: appt.id, barbershopId: appt.barbershopId };
  }

  async rescheduleManagedAppointment(token: string, startAtInput: string) {
    const loaded = await this.loadManagedAppointment(token);
    this.ensureChangeable(loaded);
    const { appt } = loaded;
    const service = appt.services[0]?.service;
    if (!service)
      throw new BadRequestException('Este agendamento não pode ser remarcado pelo link');
    // O profissional precisa continuar atendendo pela página pública
    const barber = await this.prisma.barber.findFirst({
      where: { id: appt.barberId, isActive: true, ...BOOKABLE_STAFF },
      select: { id: true },
    });
    if (!barber) {
      throw new BadRequestException(
        'Este profissional não está mais disponível. Fale com a barbearia.',
      );
    }
    const durationMs = appt.endAt.getTime() - appt.startAt.getTime();
    const { startAt } = await this.ensurePublicSlot(
      appt.barbershop,
      appt.barberId,
      Math.round(durationMs / 60000),
      startAtInput,
    );
    const endAt = new Date(startAt.getTime() + durationMs);
    if (startAt.getTime() === appt.startAt.getTime()) {
      throw new BadRequestException('Escolha um horário diferente do atual');
    }

    await this.prisma.$transaction(async (tx) => {
      await this.lockSchedule(tx, appt.barberId, appt.resourceId ?? undefined);
      await this.ensureBarberAvailable(
        appt.barbershopId,
        appt.barberId,
        startAt,
        endAt,
        appt.id,
        tx,
      );
      if (appt.resourceId) {
        await this.ensureResourceAvailable(
          appt.barbershopId,
          appt.resourceId,
          startAt,
          endAt,
          appt.id,
          tx,
        );
      }
      const moved = await tx.appointment.updateMany({
        where: { id: appt.id, status: 'CONFIRMED', startAt: appt.startAt },
        // Horário novo ganha lembrete novo
        data: { startAt, endAt, reminderSentAt: null },
      });
      if (moved.count === 0) {
        throw new BadRequestException(
          'Este agendamento mudou enquanto você remarcava. Abra o link de novo.',
        );
      }
    });

    // Horário antigo ficou livre: pode ser a vaga de alguém da lista de espera
    this.checkWaitlistOnCancellation(appt.barbershopId, appt).catch((err) =>
      this.logger.error(`Erro ao verificar lista de espera do agendamento #${appt.id}:`, err),
    );
    const to = appt.customer.email;
    if (to) {
      this.sendAppointmentEmail(appt.id, 'appointment_rescheduled', to).catch((err) =>
        this.logger.error(`Erro ao avisar remarcação do agendamento #${appt.id}:`, err),
      );
    }
    return { id: appt.id, barbershopId: appt.barbershopId, previousStartAt: appt.startAt };
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
      // Oculta pela moderação (denúncia aceita) não aparece
      where: { barbershopId, hiddenAt: null },
      include: {
        clientAccount: { select: { name: true } },
        customer: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt.toISOString(),
      // Logado: nome da conta; pelo link do e-mail: nome da ficha
      reviewerName: this.privacyName(r.clientAccount?.name ?? r.customer?.name ?? 'Cliente'),
      reply: r.reply,
      repliedAt: r.repliedAt?.toISOString() ?? null,
    }));
  }

  private async getReviewSummaries(
    barbershopIds: number[],
  ): Promise<Map<number, { averageRating: number | null; reviewCount: number }>> {
    const map = new Map<number, { averageRating: number | null; reviewCount: number }>();
    if (barbershopIds.length === 0) return map;
    const groups = await this.prisma.review.groupBy({
      by: ['barbershopId'],
      where: { barbershopId: { in: barbershopIds }, hiddenAt: null },
      _avg: { rating: true },
      _count: true,
    });
    for (const g of groups) {
      map.set(g.barbershopId, { averageRating: g._avg.rating, reviewCount: g._count });
    }
    return map;
  }

  async getReviewSummary(
    barbershopId: number,
  ): Promise<{ averageRating: number | null; reviewCount: number }> {
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
    // Vale dinheiro: gerador criptográfico, não Math.random (previsível)
    for (let i = 0; i < 8; i++) code += chars[randomInt(chars.length)];
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
    if (!network || network.id !== networkId)
      throw new ForbiddenException('Sem acesso a esta rede');
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
    if (!network || network.id !== networkId)
      throw new ForbiddenException('Sem acesso a esta rede');
    return this.prisma.giftCard.findMany({ where: { networkId }, orderBy: { createdAt: 'desc' } });
  }

  async setGiftCardActive(
    userId: number,
    networkId: number,
    giftCardId: number,
    isActive: boolean,
  ) {
    const network = await this.getMyNetwork(userId);
    if (!network || network.id !== networkId)
      throw new ForbiddenException('Sem acesso a esta rede');
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
    const giftCard = await this.prisma.giftCard.findUnique({
      where: { code: code.trim().toUpperCase() },
    });
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

  // ============ INDICAÇÃO ENTRE CLIENTES ============

  // Código de indicação = base36 do id do Customer — decodificável sem
  // round-trip no banco (não precisa de coluna própria nem checar colisão,
  // já que id já é único).
  private encodeReferralCode(customerId: number): string {
    return customerId.toString(36).toUpperCase();
  }

  private decodeReferralCode(code: string): number | null {
    const id = parseInt(code, 36);
    return Number.isFinite(id) && id > 0 ? id : null;
  }

  async getCustomerReferralInfo(userId: number, barbershopId: number, customerId: number) {
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

    const referralsMade = await this.prisma.customerReferral.findMany({
      where: { referrerId: customerId },
      select: { pointsAwarded: true },
    });

    return {
      referralCode: this.encodeReferralCode(customer.id),
      referralBonusPoints: barbershop.network.referralBonusPoints,
      referralsCount: referralsMade.length,
      pointsEarnedFromReferrals: referralsMade.reduce((sum, r) => sum + (r.pointsAwarded ?? 0), 0),
    };
  }

  async getBarbershopNoShowFees(userId: number, barbershopId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const fees = await this.prisma.noShowFee.findMany({
      where: { barbershopId },
      include: { customer: true },
      orderBy: { createdAt: 'desc' },
    });
    return fees.map((f) => ({
      id: f.id,
      customerId: f.customerId,
      customerName: f.customer.name,
      amount: Number(f.amount),
      currency: f.currency,
      reason: f.reason,
      status: f.status,
      collectedAt: f.collectedAt?.toISOString(),
      createdAt: f.createdAt.toISOString(),
    }));
  }

  async markNoShowFeeCollected(userId: number, barbershopId: number, id: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const fee = await this.prisma.noShowFee.findFirst({ where: { id, barbershopId } });
    if (!fee) throw new NotFoundException('Taxa não encontrada');
    await this.prisma.noShowFee.update({
      where: { id },
      data: { status: 'COLLECTED', collectedAt: new Date() },
    });
    return true;
  }

  async waiveNoShowFee(userId: number, barbershopId: number, id: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const fee = await this.prisma.noShowFee.findFirst({ where: { id, barbershopId } });
    if (!fee) throw new NotFoundException('Taxa não encontrada');
    await this.prisma.noShowFee.update({
      where: { id },
      data: { status: 'WAIVED' },
    });
    return true;
  }

  async getBarbershopReferrals(userId: number, barbershopId: number) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const referrals = await this.prisma.customerReferral.findMany({
      where: { networkId: barbershop.networkId },
      include: { referrer: true, referred: true },
      orderBy: { createdAt: 'desc' },
    });
    return referrals.map((r) => ({
      id: r.id,
      referrerId: r.referrerId,
      referrerName: r.referrer.name,
      referredId: r.referredId,
      referredName: r.referred.name,
      pointsAwarded: r.pointsAwarded,
      completedAt: r.completedAt?.toISOString(),
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // ============ ASSINATURA RECORRENTE DO CLIENTE ============
  //
  // Ver comentário no schema (model ClientSubscriptionPlan) — cobrança
  // automática mensal via Stripe Subscriptions na conta da própria
  // plataforma (sem Stripe Connect). Métodos "staff" (dono/funcionário,
  // gate por ensureBarbershopAccess/ensureModuleAccess) cuidam da oferta e
  // do relatório de repasse; métodos "client" (clientAccountId, sem
  // ensureBarbershopAccess pois o cliente não é da equipe) cuidam de
  // assinar/cancelar.

  async getSubscriptionPlans(userId: number, barbershopId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const plans = await this.prisma.clientSubscriptionPlan.findMany({
      where: { barbershopId },
      include: { service: true },
      orderBy: { name: 'asc' },
    });
    return plans.map((p) => ({ ...p, serviceName: p.service?.name ?? null }));
  }

  async createSubscriptionPlan(
    userId: number,
    barbershopId: number,
    data: { serviceId: number; name: string; price: number; sessionsPerCycle?: number },
  ) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    await this.ensureModuleAccess(barbershopId, 'subscriptions');
    const service = await this.prisma.barbershopService.findFirst({
      where: { id: data.serviceId, barbershopId },
    });
    if (!service) throw new NotFoundException('Serviço não encontrado');

    const product = await this.stripeService.createProduct(
      `${barbershop.name} — ${data.name}`,
      `Assinatura recorrente (${service.name})`,
    );
    const price = await this.stripeService.createPrice(
      product.id,
      Math.round(data.price * 100),
      barbershop.currency.toLowerCase(),
      { interval: 'month' },
    );

    const plan = await this.prisma.clientSubscriptionPlan.create({
      data: {
        barbershopId,
        serviceId: data.serviceId,
        name: data.name,
        price: new Decimal(data.price),
        sessionsPerCycle: data.sessionsPerCycle ?? null,
        stripeProductId: product.id,
        stripePriceId: price.id,
      },
      include: { service: true },
    });
    return { ...plan, serviceName: plan.service?.name ?? null };
  }

  async updateSubscriptionPlan(
    userId: number,
    barbershopId: number,
    id: number,
    data: Partial<{ name: string; price: number; sessionsPerCycle: number; isActive: boolean }>,
  ) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const plan = await this.prisma.clientSubscriptionPlan.findFirst({
      where: { id, barbershopId },
    });
    if (!plan) throw new NotFoundException('Plano não encontrado');

    let stripePriceId = plan.stripePriceId;
    // Stripe Price é imutável — se o valor mudou, cria um Price novo e
    // aponta o plano pra ele (assinaturas já ativas continuam no Price
    // antigo, o que é o comportamento correto: não muda o valor de quem já
    // assinou).
    if (data.price != null && Number(plan.price) !== data.price && plan.stripeProductId) {
      const newPrice = await this.stripeService.createPrice(
        plan.stripeProductId,
        Math.round(data.price * 100),
        barbershop.currency.toLowerCase(),
        { interval: 'month' },
      );
      stripePriceId = newPrice.id;
    }

    const { price, ...rest } = data;
    const updated = await this.prisma.clientSubscriptionPlan.update({
      where: { id },
      data: {
        ...rest,
        price: price != null ? new Decimal(price) : undefined,
        stripePriceId,
      },
      include: { service: true },
    });
    return { ...updated, serviceName: updated.service?.name ?? null };
  }

  async deleteSubscriptionPlan(userId: number, barbershopId: number, id: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const plan = await this.prisma.clientSubscriptionPlan.findFirst({
      where: { id, barbershopId },
    });
    if (!plan) throw new NotFoundException('Plano não encontrado');
    await this.prisma.clientSubscriptionPlan.update({ where: { id }, data: { isActive: false } });
    return true;
  }

  async getBarbershopSubscribers(userId: number, barbershopId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const subs = await this.prisma.clientSubscription.findMany({
      where: { barbershopId },
      include: { clientAccount: true, plan: { include: { service: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return subs.map((s) => this.toClientSubscriptionResult(s));
  }

  /** Relatório de repasse: quanto foi cobrado dos clientes e quanto é devido à barbearia (taxa da plataforma já descontada). Não transfere nada — só calcula. */
  async getSubscriptionRevenueReport(
    userId: number,
    barbershopId: number,
    startDate?: string,
    endDate?: string,
  ) {
    const shop = await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const payments = await this.prisma.clientSubscriptionPayment.findMany({
      where: {
        status: 'SUCCEEDED',
        subscription: { barbershopId },
        createdAt: reportPeriod(safeTimeZone(shop.timezone), startDate, endDate),
      },
    });
    const grossAmount = payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const platformFeeAmount = grossAmount * (PLATFORM_SUBSCRIPTION_FEE_PERCENT / 100);
    return {
      paymentsCount: payments.length,
      grossAmount,
      platformFeePercentage: PLATFORM_SUBSCRIPTION_FEE_PERCENT,
      platformFeeAmount,
      netOwedToBarbershop: grossAmount - platformFeeAmount,
    };
  }

  private toClientSubscriptionResult(s: any) {
    return {
      id: s.id,
      barbershopId: s.barbershopId,
      clientAccountId: s.clientAccountId,
      clientName: s.clientAccount?.name ?? null,
      clientEmail: s.clientAccount?.email ?? null,
      planId: s.planId,
      planName: s.plan?.name ?? null,
      serviceName: s.plan?.service?.name ?? null,
      price: s.plan ? Number(s.plan.price) : null,
      sessionsPerCycle: s.plan?.sessionsPerCycle ?? null,
      status: s.status,
      currentPeriodStart: s.currentPeriodStart?.toISOString(),
      currentPeriodEnd: s.currentPeriodEnd?.toISOString(),
      usedThisCycle: s.usedThisCycle,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      createdAt: s.createdAt.toISOString(),
    };
  }

  /** Aciona o SetupIntent do cliente na conta da plataforma (não Connect) pra ele salvar o cartão via Stripe Elements antes de assinar. */
  async createClientSubscriptionSetupIntent(clientAccountId: number) {
    const clientAccount = await this.prisma.clientAccount.findUnique({
      where: { id: clientAccountId },
    });
    if (!clientAccount) throw new NotFoundException('Conta não encontrada');

    let stripeCustomerId = clientAccount.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await this.stripeService.createCustomer(
        clientAccount.email,
        clientAccount.name,
        {
          clientAccountId: String(clientAccountId),
        },
      );
      stripeCustomerId = customer.id;
      await this.prisma.clientAccount.update({
        where: { id: clientAccountId },
        data: { stripeCustomerId },
      });
    }

    const setupIntent = await this.stripeService.createSetupIntent(stripeCustomerId);
    return { clientSecret: setupIntent.client_secret };
  }

  async subscribeToPlan(
    clientAccountId: number,
    barbershopId: number,
    planId: number,
    paymentMethodId: string,
  ) {
    const clientAccount = await this.prisma.clientAccount.findUnique({
      where: { id: clientAccountId },
    });
    if (!clientAccount?.stripeCustomerId) {
      throw new BadRequestException('Salve um cartão antes de assinar');
    }
    const plan = await this.prisma.clientSubscriptionPlan.findFirst({
      where: { id: planId, barbershopId, isActive: true },
    });
    if (!plan?.stripePriceId) throw new NotFoundException('Plano não encontrado');

    // Dois cliques (ou duas abas) juntos passavam os dois pela checagem e
    // criavam DUAS assinaturas no Stripe — cobrança em dobro todo mês. Agora
    // a checagem, a criação no Stripe e o registro ficam sob uma trava por
    // cliente+plano, e o Stripe recebe uma chave de idempotência (que muda a
    // cada assinatura nova, pra poder assinar de novo depois de cancelar).
    const { stripeSubscription, subscription } = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`client-sub:${clientAccountId}:${planId}`}))`;
        const existing = await tx.clientSubscription.findFirst({
          where: {
            clientAccountId,
            planId,
            status: { in: ['INCOMPLETE', 'ACTIVE', 'PAST_DUE'] },
          },
        });
        if (existing) {
          throw new BadRequestException('Você já tem uma assinatura ativa neste plano');
        }
        const previous = await tx.clientSubscription.count({ where: { clientAccountId, planId } });

        await this.stripeService.attachPaymentMethod(
          paymentMethodId,
          clientAccount.stripeCustomerId!,
        );
        await this.stripeService.setDefaultPaymentMethod(
          clientAccount.stripeCustomerId!,
          paymentMethodId,
        );
        const stripeSubscription = await this.stripeService.createSubscription(
          clientAccount.stripeCustomerId!,
          plan.stripePriceId!,
          {
            clientAccountId: String(clientAccountId),
            barbershopId: String(barbershopId),
            planId: String(planId),
          },
          `client-sub:${clientAccountId}:${planId}:${previous + 1}`,
        );

        const subscription = await tx.clientSubscription.create({
          data: {
            barbershopId,
            clientAccountId,
            planId,
            stripeSubscriptionId: stripeSubscription.id,
            status: stripeSubscription.status === 'active' ? 'ACTIVE' : 'INCOMPLETE',
            currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
            currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
          },
        });
        return { stripeSubscription, subscription };
      },
      // A chamada ao Stripe fica dentro da trava
      { timeout: 30_000, maxWait: 30_000 },
    );

    const latestInvoice = stripeSubscription.latest_invoice as any;
    const paymentIntent = latestInvoice?.payment_intent as any;
    return {
      id: subscription.id,
      status: subscription.status,
      clientSecret: paymentIntent?.client_secret ?? null,
    };
  }

  async getMySubscriptions(clientAccountId: number) {
    const subs = await this.prisma.clientSubscription.findMany({
      where: { clientAccountId },
      include: { clientAccount: true, plan: { include: { service: true } }, barbershop: true },
      orderBy: { createdAt: 'desc' },
    });
    return subs.map((s) => ({
      ...this.toClientSubscriptionResult(s),
      barbershopName: s.barbershop.name,
    }));
  }

  async cancelMySubscription(clientAccountId: number, subscriptionId: number) {
    const subscription = await this.prisma.clientSubscription.findFirst({
      where: { id: subscriptionId, clientAccountId },
    });
    if (!subscription) throw new NotFoundException('Assinatura não encontrada');
    await this.stripeService.updateSubscription(subscription.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
    await this.prisma.clientSubscription.update({
      where: { id: subscriptionId },
      data: { cancelAtPeriodEnd: true },
    });
    return true;
  }

  /** Staff registra que o cliente usou uma sessão da assinatura neste ciclo (mesmo padrão manual de debitClientPackageSession — não é acionado automaticamente pelo agendamento). */
  async redeemClientSubscriptionSession(
    userId: number,
    barbershopId: number,
    subscriptionId: number,
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const subscription = await this.prisma.clientSubscription.findFirst({
      where: { id: subscriptionId, barbershopId },
      include: { plan: true },
    });
    if (!subscription) throw new NotFoundException('Assinatura não encontrada');
    if (subscription.status !== 'ACTIVE') {
      throw new BadRequestException('Assinatura não está ativa');
    }
    const limit = subscription.plan.sessionsPerCycle;
    // Baixa condicional: dois cliques juntos (ou dois barbeiros) não passam
    // do limite — antes os dois liam o mesmo saldo e gravavam +1 cada
    const { count } = await this.prisma.clientSubscription.updateMany({
      where: {
        id: subscriptionId,
        status: 'ACTIVE',
        ...(limit != null ? { usedThisCycle: { lt: limit } } : {}),
      },
      data: { usedThisCycle: { increment: 1 } },
    });
    if (count === 0) {
      throw new BadRequestException('Assinatura não tem sessões restantes neste ciclo');
    }
    const updated = await this.prisma.clientSubscription.findUniqueOrThrow({
      where: { id: subscriptionId },
      include: { clientAccount: true, plan: { include: { service: true } } },
    });
    return this.toClientSubscriptionResult(updated);
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
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId);
    const where: any = { barbershopId };
    if (filters?.status) where.status = filters.status;
    const walkIns = await this.prisma.walkIn.findMany({
      where,
      include: { services: { include: { service: true } }, customer: true, barber: true },
      orderBy: [{ status: 'asc' }, { queuePosition: 'asc' }],
      take: filters?.limit ?? 50,
      skip: filters?.offset ?? 0,
    });
    const canSee = await this.contactVisibility(userId, barbershop);
    return walkIns.map((w) => this.hideWalkInContact(canSee, w));
  }

  async updateWalkInStatus(userId: number, barbershopId: number, walkInId: number, status: string) {
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
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId);
    if (data.customerId) await this.ensureCustomerOfNetwork(barbershop.networkId, data.customerId);
    if (data.barberId) await this.ensureBarberOfBarbershop(barbershopId, data.barberId);
    // Conta do horário: uma venda só por horário, e o sinal já pago (online
    // ou na mão) é descontado do que se cobra agora
    let depositPaidOnAppointment = 0;
    if (data.appointmentId) {
      const appt = await this.prisma.appointment.findFirst({
        where: { id: data.appointmentId, barbershopId },
        select: {
          id: true,
          status: true,
          depositPaid: true,
          depositAmount: true,
          sale: { select: { id: true } },
        },
      });
      if (!appt) throw new NotFoundException('Agendamento não encontrado');
      if (appt.sale) {
        throw new BadRequestException(`Este atendimento já foi cobrado (venda #${appt.sale.id})`);
      }
      if (['CANCELLED', 'NO_SHOW', 'PENDING_PAYMENT'].includes(appt.status)) {
        throw new BadRequestException('Este horário não pode ser cobrado');
      }
      if (appt.depositPaid) depositPaidOnAppointment = Number(appt.depositAmount ?? 0);
    }
    await this.ensureItemsOfBarbershop(
      barbershopId,
      data.items.filter((i) => i.serviceId).map((i) => i.serviceId as number),
      data.items.filter((i) => i.productId).map((i) => i.productId as number),
    );
    const discount = data.discountAmount ?? 0;
    const tax = data.taxAmount ?? 0;

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
      const customerForRedemption = await this.prisma.customer.findUnique({
        where: { id: data.customerId },
      });
      if (!customerForRedemption) throw new NotFoundException('Cliente não encontrado');
      if (customerForRedemption.loyaltyPoints < data.loyaltyPointsRedeemed) {
        throw new BadRequestException('Cliente não tem pontos de fidelidade suficientes');
      }
      const pointValue = barbershop?.network.loyaltyPointValue ?? 0;
      loyaltyDiscountAmount = data.loyaltyPointsRedeemed * pointValue;
    }

    const afterDiscounts = Math.max(0, data.total - giftCardAmountApplied - loyaltyDiscountAmount);
    const depositApplied = Math.min(depositPaidOnAppointment, afterDiscounts);
    const finalTotal = Math.round((afterDiscounts - depositApplied) * 100) / 100;

    // Vincula a venda ao caixa aberto no momento, se houver um — é o que
    // permite reconciliar o fechamento de caixa depois (ver
    // closeCashSession). Uma venda feita sem caixa aberto simplesmente não
    // entra na conferência de dinheiro físico, mas continua contando no
    // dashboard financeiro (que não depende de sessão de caixa).
    const openSession = await this.prisma.cashSession.findFirst({
      where: { barbershopId, status: 'OPEN' },
    });
    const created = this.prisma.$transaction(async (tx) => {
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
          loyaltyDiscountAmount:
            loyaltyDiscountAmount > 0 ? new Decimal(loyaltyDiscountAmount) : null,
          depositApplied: depositApplied > 0 ? new Decimal(depositApplied) : null,
        },
      });
      // Cobrou o atendimento: ele está concluído
      if (data.appointmentId) {
        await tx.appointment.updateMany({
          where: { id: data.appointmentId, status: { in: ['CONFIRMED', 'IN_PROGRESS'] } },
          data: { status: 'COMPLETED' },
        });
      }

      // Baixa condicional ("só se ainda tiver saldo"), dentro da transação:
      // a checagem lá em cima é de antes — duas vendas simultâneas passavam
      // as duas por ela e os pontos/saldo eram gastos duas vezes (o cliente
      // ficava com pontos negativos).
      if (giftCard) {
        const debited = await tx.giftCard.updateMany({
          where: { id: giftCard.id, remainingValue: { gte: giftCardAmountApplied } },
          data: { remainingValue: { decrement: giftCardAmountApplied } },
        });
        if (debited.count === 0) {
          throw new BadRequestException(
            'O saldo do cartão-presente mudou enquanto a venda era registrada. Tente de novo.',
          );
        }
      }
      if (data.loyaltyPointsRedeemed && data.customerId) {
        const debited = await tx.customer.updateMany({
          where: { id: data.customerId, loyaltyPoints: { gte: data.loyaltyPointsRedeemed } },
          data: { loyaltyPoints: { decrement: data.loyaltyPointsRedeemed } },
        });
        if (debited.count === 0) {
          throw new BadRequestException('Cliente não tem pontos de fidelidade suficientes');
        }
      }

      // Concede pontos de fidelidade só quando a venda já está paga — evita
      // dar crédito por algo que ainda pode não se concretizar (PENDING).
      if (
        data.paymentStatus === 'PAID' &&
        data.customerId &&
        barbershop?.network.loyaltyEnabled &&
        barbershop.network.loyaltyPointsPerCurrencyUnit
      ) {
        const pointsEarned = Math.floor(
          finalTotal * barbershop.network.loyaltyPointsPerCurrencyUnit,
        );
        if (pointsEarned > 0) {
          await tx.customer.update({
            where: { id: data.customerId },
            data: { loyaltyPoints: { increment: pointsEarned } },
          });
          await tx.sale.update({
            where: { id: sale.id },
            data: { loyaltyPointsEarned: pointsEarned },
          });
        }
      }

      // Indicação entre clientes: o referrer só ganha o bônus quando o
      // indicado completa a PRIMEIRA venda paga (não no cadastro) — evita
      // indicação fake sem gasto real. Um cliente só pode ter uma indicação
      // pendente (referredId é único), então não há risco de premiar mais de
      // uma vez por engano em vendas futuras.
      if (data.paymentStatus === 'PAID' && data.customerId && barbershop?.network.loyaltyEnabled) {
        const referral = await tx.customerReferral.findUnique({
          where: { referredId: data.customerId },
        });
        if (referral && !referral.completedAt) {
          const paidSalesCount = await tx.sale.count({
            where: { customerId: data.customerId, paymentStatus: 'PAID' },
          });
          if (paidSalesCount === 1) {
            const bonusPoints = barbershop.network.referralBonusPoints;
            if (bonusPoints > 0) {
              await tx.customer.update({
                where: { id: referral.referrerId },
                data: { loyaltyPoints: { increment: bonusPoints } },
              });
            }
            await tx.customerReferral.update({
              where: { id: referral.id },
              data: { completedAt: new Date(), pointsAwarded: bonusPoints },
            });
          }
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
    // Duas pessoas cobrando o mesmo horário ao mesmo tempo: a venda é única
    return created.catch((err) => {
      if ((err as { code?: string })?.code === 'P2002' && data.appointmentId) {
        throw new BadRequestException('Este atendimento já foi cobrado');
      }
      throw err;
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
    const shop = await this.ensureBarbershopAccess(userId, barbershopId);
    const where: any = { barbershopId };
    if (filters?.customerId) where.customerId = filters.customerId;
    if (filters?.barberId) where.barberId = filters.barberId;
    // Barbeiro vê só as próprias vendas (o faturamento da unidade é do dono
    // e do gerente)
    const ownBarberId = await this.ownBarberIdIfBarber(userId, shop);
    if (ownBarberId !== null) where.barberId = ownBarberId;
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
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
      if (data.discountAmount !== undefined)
        updateData.discountAmount = new Decimal(data.discountAmount);
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const sessions = await this.prisma.cashSession.findMany({
      where: { barbershopId },
      include: { openedBy: true, closedBy: true },
      orderBy: { openedAt: 'desc' },
      take: limit,
    });
    return sessions.map((s) => this.toCashSessionResult(s));
  }

  async openCashSession(userId: number, barbershopId: number, openingBalance: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'reception');
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'reception');
    const session = await this.prisma.cashSession.findFirst({
      where: { barbershopId, status: 'OPEN' },
    });
    if (!session) {
      throw new NotFoundException('Nenhum caixa aberto para esta barbearia');
    }
    const [cashSales, cashExpenses, cashRent] = await Promise.all([
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
      // Aluguel da cadeira recebido em dinheiro também está na gaveta
      this.prisma.chairRentPayment.aggregate({
        where: { cashSessionId: session.id, method: 'CASH', status: 'SUCCEEDED' },
        _sum: { amount: true },
      }),
    ]);
    const openingBalance = Number(session.openingBalance);
    const cashIn = Number(cashSales._sum.total ?? 0) + Number(cashRent._sum.amount ?? 0);
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const existing = await this.prisma.expense.findFirst({
      where: { id: expenseId, barbershopId },
    });
    if (!existing) throw new NotFoundException('Despesa não encontrada');
    await this.prisma.expense.delete({ where: { id: expenseId } });
    return true;
  }

  // ============ FINANCIAL DASHBOARD ============

  async getFinancialSummary(userId: number, barbershopId: number, from: Date, to: Date) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const timeZone = safeTimeZone(barbershop.timezone);
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
    // Aluguel da cadeira que o espaço recebeu direto (PIX, dinheiro...). O
    // que entra pelo cartão fica na plataforma até o repasse
    const rent = await this.prisma.chairRentPayment.aggregate({
      where: {
        link: { hostBarbershopId: barbershopId },
        status: 'SUCCEEDED',
        method: { not: 'CARD' },
        paidAt: { gte: from, lte: to },
      },
      _sum: { amount: true },
    });
    const chairRentIncome = Number(rent._sum.amount ?? 0);

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
      // Dia no fuso da unidade — em UTC, venda depois das 21h em Brasília
      // caía no dia seguinte do gráfico
      const key = toZonedParts(s.createdAt, timeZone).dateStr;
      byDay.set(key, (byDay.get(key) ?? 0) + Number(s.total));
    });
    const sortedDays = Array.from(byDay.keys()).sort();

    return {
      totalRevenue,
      totalExpenses,
      chairRentIncome,
      netProfit: totalRevenue + chairRentIncome - totalExpenses,
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'basic');
    return this.prisma.resource.findMany({
      where: { barbershopId },
      orderBy: { name: 'asc' },
    });
  }

  async createResource(
    userId: number,
    barbershopId: number,
    data: { name: string; type?: string },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const resource = await this.prisma.resource.findFirst({
      where: { id: resourceId, barbershopId },
    });
    if (!resource) throw new NotFoundException('Recurso não encontrado');
    return this.prisma.resource.update({ where: { id: resourceId }, data });
  }

  async deleteResource(userId: number, barbershopId: number, resourceId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const resource = await this.prisma.resource.findFirst({
      where: { id: resourceId, barbershopId },
    });
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
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
    // Baixa condicional no banco (mesma ideia dos pontos de fidelidade):
    // débitos simultâneos não passam do total de sessões do pacote
    const debited = await this.prisma.$executeRaw`
      UPDATE "ClientPackage"
      SET "usedSessions" = "usedSessions" + 1,
          status = CASE WHEN "usedSessions" + 1 >= "totalSessions" THEN 'COMPLETED' ELSE 'ACTIVE' END,
          "updatedAt" = NOW()
      WHERE id = ${clientPackageId} AND status = 'ACTIVE' AND "usedSessions" < "totalSessions"`;
    if (debited === 0) {
      throw new BadRequestException('Pacote não tem sessões restantes');
    }
    const updated = await this.prisma.clientPackage.findUniqueOrThrow({
      where: { id: clientPackageId },
      include: { servicePackage: { include: { service: true } } },
    });
    return this.toClientPackageResult(updated);
  }

  // ============ FICHA DE ANAMNESE / CONSENTIMENTO ============

  async createConsentForm(
    userId: number,
    barbershopId: number,
    data: {
      customerId: number;
      formType: string;
      category?: string;
      answers?: string;
      expiresAt?: string;
    },
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const form = await this.prisma.consentForm.findFirst({ where: { id, barbershopId } });
    if (!form) throw new NotFoundException('Ficha não encontrada');
    await this.prisma.consentForm.delete({ where: { id } });
    return true;
  }

  // ============ COMISSÃO ============

  async getCommissionRules(userId: number, barbershopId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
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
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const rule = await this.prisma.commissionRule.findFirst({ where: { id, barbershopId } });
    if (!rule) throw new NotFoundException('Regra de comissão não encontrada');
    await this.prisma.commissionRule.delete({ where: { id } });
    return true;
  }

  async getCommissionReport(userId: number, barbershopId: number, from: Date, to: Date) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    return this.computeCommissions(barbershopId, from, to);
  }

  /**
   * Comissão de cada profissional nas vendas pagas do período (regras da
   * unidade: do profissional por tipo > do profissional "tudo" > da unidade
   * por tipo > da unidade "tudo"). Sem checagem de acesso: quem chama checa.
   * Usado no relatório de comissões e no pagamento da equipe.
   */
  async computeCommissions(barbershopId: number, from: Date, to: Date) {
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
      {
        salesCount: number;
        totalServiceSales: number;
        totalProductSales: number;
        serviceCommission: number;
        productCommission: number;
      }
    >();

    for (const sale of sales) {
      const barberId = sale.barberId as number;
      if (!byBarber.has(barberId)) {
        byBarber.set(barberId, {
          salesCount: 0,
          totalServiceSales: 0,
          totalProductSales: 0,
          serviceCommission: 0,
          productCommission: 0,
        });
      }
      const acc = byBarber.get(barberId)!;
      acc.salesCount++;
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
      salesCount: acc.salesCount,
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

  // ============ RELATÓRIOS AVANÇADOS (plano Premium) ============

  async getAdvancedReports(userId: number, barbershopId: number, from: Date, to: Date) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    await this.ensureModuleAccess(barbershopId, 'reports');

    const [appointments, saleItems, customersInPeriod] = await Promise.all([
      // Taxa de não-comparecimento: só entre agendamentos que de fato
      // chegaram no horário marcado (COMPLETED ou NO_SHOW) — CANCELLED e
      // outros status não representam "cliente não apareceu".
      this.prisma.appointment.findMany({
        where: {
          barbershopId,
          startAt: { gte: from, lte: to },
          status: { in: ['COMPLETED', 'NO_SHOW'] },
        },
        include: {
          barber: { select: { id: true, name: true } },
          services: { include: { service: { select: { id: true, name: true } } } },
        },
      }),
      this.prisma.saleItem.findMany({
        where: {
          sale: { barbershopId, paymentStatus: 'PAID', createdAt: { gte: from, lte: to } },
        },
        include: {
          service: { select: { id: true, name: true } },
          product: { select: { id: true, name: true } },
        },
      }),
      this.prisma.sale.findMany({
        where: {
          barbershopId,
          paymentStatus: 'PAID',
          createdAt: { gte: from, lte: to },
          customerId: { not: null },
        },
        select: { customerId: true },
        distinct: ['customerId'],
      }),
    ]);

    // --- Taxa de não-comparecimento geral, por barbeiro e por serviço ---
    let totalNoShow = 0;
    const byBarber = new Map<number, { name: string; noShow: number; completed: number }>();
    const byService = new Map<number, { name: string; noShow: number; completed: number }>();

    for (const appt of appointments) {
      const isNoShow = appt.status === 'NO_SHOW';
      if (isNoShow) totalNoShow++;

      if (!byBarber.has(appt.barberId)) {
        byBarber.set(appt.barberId, { name: appt.barber.name, noShow: 0, completed: 0 });
      }
      const barberAcc = byBarber.get(appt.barberId)!;
      if (isNoShow) barberAcc.noShow++;
      else barberAcc.completed++;

      for (const s of appt.services) {
        if (!s.service) continue;
        if (!byService.has(s.service.id)) {
          byService.set(s.service.id, { name: s.service.name, noShow: 0, completed: 0 });
        }
        const serviceAcc = byService.get(s.service.id)!;
        if (isNoShow) serviceAcc.noShow++;
        else serviceAcc.completed++;
      }
    }

    const toRate = (noShow: number, completed: number) =>
      noShow + completed > 0 ? noShow / (noShow + completed) : 0;

    const noShowByBarber = Array.from(byBarber.entries())
      .map(([barberId, acc]) => ({
        barberId,
        barberName: acc.name,
        noShowCount: acc.noShow,
        completedCount: acc.completed,
        rate: toRate(acc.noShow, acc.completed),
      }))
      .sort((a, b) => b.rate - a.rate);

    const noShowByService = Array.from(byService.entries())
      .map(([serviceId, acc]) => ({
        serviceId,
        serviceName: acc.name,
        noShowCount: acc.noShow,
        completedCount: acc.completed,
        rate: toRate(acc.noShow, acc.completed),
      }))
      .sort((a, b) => b.rate - a.rate);

    // --- Serviços e produtos mais vendidos (por receita) ---
    const serviceSales = new Map<number, { name: string; quantity: number; revenue: number }>();
    const productSales = new Map<number, { name: string; quantity: number; revenue: number }>();

    for (const item of saleItems) {
      if (item.itemType === 'SERVICE' && item.service) {
        if (!serviceSales.has(item.service.id)) {
          serviceSales.set(item.service.id, { name: item.service.name, quantity: 0, revenue: 0 });
        }
        const acc = serviceSales.get(item.service.id)!;
        acc.quantity += item.quantity;
        acc.revenue += Number(item.totalPrice);
      } else if (item.itemType === 'PRODUCT' && item.product) {
        if (!productSales.has(item.product.id)) {
          productSales.set(item.product.id, { name: item.product.name, quantity: 0, revenue: 0 });
        }
        const acc = productSales.get(item.product.id)!;
        acc.quantity += item.quantity;
        acc.revenue += Number(item.totalPrice);
      }
    }

    const topServices = Array.from(serviceSales.entries())
      .map(([serviceId, acc]) => ({
        serviceId,
        serviceName: acc.name,
        quantity: acc.quantity,
        revenue: acc.revenue,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    const topProducts = Array.from(productSales.entries())
      .map(([productId, acc]) => ({
        productId,
        productName: acc.name,
        quantity: acc.quantity,
        revenue: acc.revenue,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // --- Retenção: dos clientes que compraram no período, quantos já
    // tinham comprado antes dele (retornando) vs. primeira compra (novos) ---
    const customerIds = customersInPeriod.map((s) => s.customerId as number);
    const priorSales =
      customerIds.length > 0
        ? await this.prisma.sale.findMany({
            where: {
              barbershopId,
              paymentStatus: 'PAID',
              customerId: { in: customerIds },
              createdAt: { lt: from },
            },
            select: { customerId: true },
            distinct: ['customerId'],
          })
        : [];
    const returningSet = new Set(priorSales.map((s) => s.customerId));
    const totalCustomers = customerIds.length;
    const returningCustomers = returningSet.size;
    const newCustomers = totalCustomers - returningCustomers;

    return {
      totalNoShow,
      totalCompletedOrNoShow: appointments.length,
      noShowRate: toRate(totalNoShow, appointments.length - totalNoShow),
      noShowByBarber,
      noShowByService,
      topServices,
      topProducts,
      newCustomers,
      returningCustomers,
      retentionRate: totalCustomers > 0 ? returningCustomers / totalCustomers : 0,
    };
  }
}
