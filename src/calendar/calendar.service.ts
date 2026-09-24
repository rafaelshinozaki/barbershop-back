import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AccessLevel, BarbershopService } from '../barbershop/barbershop.service';
import { verifyAppointmentToken } from '../barbershop/appointment-link';
import { appointmentEvent } from './calendar-links';
import { buildCalendar, IcsEvent } from './ics';

export type FeedScope = 'MINE' | 'ALL';
const FEED_SCOPES: FeedScope[] = ['MINE', 'ALL'];
const SEES_WHOLE_SCHEDULE: AccessLevel[] = ['reception', 'manager', 'owner'];
const DAY = 86_400_000;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Integração com calendários (Google Agenda, Apple, Outlook...) sem login em
 * nenhum deles:
 * - cliente: "adicionar à agenda" — .ics do agendamento pelo mesmo link
 *   assinado de gerenciar, e links do Google/Outlook;
 * - equipe: link secreto de agenda (iCal) pra assinar uma vez; os horários
 *   aparecem e se atualizam sozinhos.
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly barbershopService: BarbershopService,
  ) {}

  // ---- cliente ----

  /** .ics de um agendamento, pelo link assinado (o mesmo de gerenciar). */
  async appointmentIcs(token: string) {
    const id = verifyAppointmentToken(token);
    const appt = id
      ? await this.prisma.appointment.findUnique({
          where: { id },
          include: {
            barbershop: { select: { name: true, address: true, city: true, state: true } },
            barber: { select: { name: true } },
            services: { include: { service: { select: { name: true } } } },
          },
        })
      : null;
    if (!appt) throw new NotFoundException('Agendamento não encontrado');
    const cancelled = appt.status === 'CANCELLED';
    return buildCalendar([appointmentEvent(appt)], {
      // Cancelado: o app apaga o evento que o cliente já tinha adicionado
      method: cancelled ? 'CANCEL' : 'PUBLISH',
    });
  }

  // ---- equipe: agenda assinável ----

  private async ensureCanUse(userId: number, barbershopId: number, scope: FeedScope) {
    if (!FEED_SCOPES.includes(scope)) throw new BadRequestException('Tipo de agenda inválido');
    const shop = await this.barbershopService.ensureAccess(userId, barbershopId, 'basic');
    const level = (shop as unknown as { accessLevel: AccessLevel }).accessLevel;
    if (scope === 'ALL') {
      if (!SEES_WHOLE_SCHEDULE.includes(level)) {
        throw new BadRequestException('Seu cargo não vê a agenda da unidade inteira');
      }
      return;
    }
    const me = await this.prisma.barber.findFirst({
      where: { barbershopId, userId, isActive: true },
      select: { id: true, staffType: true },
    });
    if (!me || me.staffType === 'reception') {
      throw new BadRequestException('Você não tem agenda própria nesta unidade');
    }
  }

  async listFeeds(userId: number, barbershopId: number) {
    await this.barbershopService.ensureAccess(userId, barbershopId, 'basic');
    const feeds = await this.prisma.calendarFeed.findMany({
      where: { userId, barbershopId },
      orderBy: { scope: 'asc' },
    });
    return feeds.map((f) => ({
      scope: f.scope,
      createdAt: f.createdAt,
      lastAccessAt: f.lastAccessAt,
    }));
  }

  /**
   * Cria (ou troca) o link. O token só aparece aqui — no banco fica o hash;
   * gerar de novo invalida o anterior (link vazou, trocou de celular...).
   */
  async createFeed(userId: number, barbershopId: number, scope: FeedScope) {
    await this.ensureCanUse(userId, barbershopId, scope);
    const token = randomBytes(24).toString('base64url');
    await this.prisma.calendarFeed.upsert({
      where: { userId_barbershopId_scope: { userId, barbershopId, scope } },
      create: { userId, barbershopId, scope, tokenHash: hash(token) },
      update: { tokenHash: hash(token), createdAt: new Date(), lastAccessAt: null },
    });
    return { scope, path: `/calendar/feed/${token}.ics` };
  }

  async deleteFeed(userId: number, barbershopId: number, scope: FeedScope) {
    await this.barbershopService.ensureAccess(userId, barbershopId, 'basic');
    await this.prisma.calendarFeed.deleteMany({ where: { userId, barbershopId, scope } });
    return true;
  }

  /**
   * O feed em si (o app de agenda busca de tempos em tempos). O acesso é
   * conferido de novo a cada leitura: quem saiu da equipe ou mudou de cargo
   * para de ver. Contato do cliente só pra quem vê a agenda inteira.
   */
  async feedIcs(token: string) {
    const feed = await this.prisma.calendarFeed.findUnique({
      where: { tokenHash: hash(token) },
      include: { barbershop: true },
    });
    if (!feed) throw new NotFoundException('Agenda não encontrada');
    const scope = feed.scope as FeedScope;
    try {
      await this.ensureCanUse(feed.userId, feed.barbershopId, scope);
    } catch {
      throw new NotFoundException('Agenda não encontrada');
    }
    let barberId: number | undefined;
    if (scope === 'MINE') {
      barberId = (await this.prisma.barber.findFirst({
        where: { barbershopId: feed.barbershopId, userId: feed.userId, isActive: true },
        select: { id: true },
      }))!.id;
    }
    const now = Date.now();
    const appointments = await this.prisma.appointment.findMany({
      where: {
        barbershopId: feed.barbershopId,
        ...(barberId ? { barberId } : {}),
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        startAt: { gte: new Date(now - 30 * DAY), lte: new Date(now + 180 * DAY) },
      },
      include: {
        customer: { select: { name: true, phone: true } },
        barber: { select: { name: true } },
        services: { include: { service: { select: { name: true } } } },
      },
      orderBy: { startAt: 'asc' },
      take: 5000,
    });
    const shop = feed.barbershop;
    const location = `${shop.address}, ${shop.city} - ${shop.state}`;
    const events: IcsEvent[] = appointments.map((a) => {
      const services = a.services
        .map((s) => s.service?.name)
        .filter(Boolean)
        .join(', ');
      const lines = [
        services && `Serviço: ${services}`,
        scope === 'ALL' && `Profissional: ${a.barber.name}`,
        scope === 'ALL' && a.customer.phone && `Telefone: ${a.customer.phone}`,
        a.notes && `Obs.: ${a.notes}`,
      ].filter(Boolean);
      return {
        uid: `appointment-${a.id}@barbershop`,
        start: a.startAt,
        end: a.endAt,
        summary:
          scope === 'ALL'
            ? `${a.customer.name} — ${a.barber.name}`
            : `${a.customer.name}${services ? ` — ${services}` : ''}`,
        description: lines.join('\n'),
        location,
        sequence: Math.floor(a.updatedAt.getTime() / 1000),
        updatedAt: a.updatedAt,
      };
    });
    // Registro de uso sem escrever a cada leitura
    if (!feed.lastAccessAt || now - feed.lastAccessAt.getTime() > 3_600_000) {
      await this.prisma.calendarFeed
        .update({ where: { id: feed.id }, data: { lastAccessAt: new Date() } })
        .catch(() => undefined);
    }
    return buildCalendar(events, {
      name: scope === 'ALL' ? shop.name : `${shop.name} — minha agenda`,
      refreshHours: 1,
    });
  }
}
