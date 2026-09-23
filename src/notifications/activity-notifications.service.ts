import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationQueueService } from '../queue/notification-queue.service';
import { NotificationType } from './dto/create-notification.dto';

/** Categorias de atividade — cada uma tem `<categoria>Email` e `<categoria>InApp` em NotificationPreference. */
export type ActivityCategory = 'appointments' | 'sales' | 'inventory' | 'team' | 'reviews';

type Lang = 'pt' | 'en' | 'es';

// Usuário sem linha de preferência: mesmos padrões do banco
const DEFAULTS: Record<ActivityCategory, { email: boolean; inApp: boolean }> = {
  appointments: { email: false, inApp: true },
  sales: { email: false, inApp: true },
  inventory: { email: true, inApp: true },
  team: { email: true, inApp: true },
  reviews: { email: false, inApp: true },
};

const LOCALE: Record<Lang, string> = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' };

interface Shop {
  id: number;
  name: string;
  timezone: string;
  currency: string;
}

interface Fmt {
  lang: Lang;
  date: (d: Date) => string;
  money: (v: unknown) => string;
}

interface Text {
  title: string;
  message: string;
}

type Texts = Record<Lang, Text>;

const ACTION_TEXT: Record<string, Record<Lang, string>> = {
  appointments: { pt: 'Ver agenda', en: 'View schedule', es: 'Ver agenda' },
  'walk-ins': { pt: 'Ver fila', en: 'View queue', es: 'Ver fila' },
  sales: { pt: 'Ver vendas', en: 'View sales', es: 'Ver ventas' },
  inventory: { pt: 'Ver estoque', en: 'View inventory', es: 'Ver inventario' },
  barbers: { pt: 'Ver equipe', en: 'View team', es: 'Ver equipo' },
  overview: { pt: 'Ver unidade', en: 'View location', es: 'Ver sucursal' },
};

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!),
  );

/**
 * Avisos do sistema sobre o que acontece nas unidades (agendamento novo,
 * atendimento concluído, venda, estoque baixo, alguém entrou na equipe,
 * avaliação nova) — no sininho e/ou por e-mail, conforme as preferências de
 * cada um.
 *
 * Quem recebe: dono da franquia, dono da unidade, gerentes da unidade e o
 * barbeiro envolvido — nunca quem fez a ação. Tudo best-effort e fora da
 * requisição: falha aqui não pode desfazer a venda/agendamento já salvos.
 */
@Injectable()
export class ActivityNotificationsService {
  private readonly logger = new Logger(ActivityNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly queue: NotificationQueueService,
    private readonly config: ConfigService,
  ) {}

  // ============ EVENTOS ============

  /** Agendamento novo. `actorUserId` nulo = cliente agendou pela página pública. */
  appointmentCreated(appointmentId: number, actorUserId: number | null) {
    return this.run('appointmentCreated', async () => {
      const appt = await this.loadAppointment(appointmentId);
      if (!appt) return;
      const online = actorUserId === null;
      await this.deliver(appt.barbershopId, 'appointments', {
        barberId: appt.barberId,
        actorUserId,
        path: 'appointments',
        type: NotificationType.INFO,
        key: `appt-created:${appointmentId}`,
        build: (f) => {
          const v = {
            c: appt.customer.name,
            b: appt.barber.name,
            s: appt.services,
            d: f.date(appt.startAt),
          };
          return online
            ? {
                pt: {
                  title: 'Novo agendamento online',
                  message: `${v.c} agendou ${v.s} com ${v.b} para ${v.d}.`,
                },
                en: {
                  title: 'New online booking',
                  message: `${v.c} booked ${v.s} with ${v.b} for ${v.d}.`,
                },
                es: {
                  title: 'Nueva reserva online',
                  message: `${v.c} reservó ${v.s} con ${v.b} para el ${v.d}.`,
                },
              }
            : {
                pt: { title: 'Novo agendamento', message: `${v.c}: ${v.s} com ${v.b} em ${v.d}.` },
                en: { title: 'New appointment', message: `${v.c}: ${v.s} with ${v.b} on ${v.d}.` },
                es: { title: 'Nueva cita', message: `${v.c}: ${v.s} con ${v.b} el ${v.d}.` },
              };
        },
      });
    });
  }

  /** Atendimento concluído, cancelado ou falta do cliente. Outros status não avisam. */
  appointmentStatusChanged(appointmentId: number, status: string, actorUserId: number | null) {
    if (!['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(status)) return Promise.resolve();
    return this.run('appointmentStatusChanged', async () => {
      const appt = await this.loadAppointment(appointmentId);
      if (!appt) return;
      await this.deliver(appt.barbershopId, 'appointments', {
        barberId: appt.barberId,
        actorUserId,
        path: 'appointments',
        type: status === 'COMPLETED' ? NotificationType.SUCCESS : NotificationType.WARNING,
        key: `appt-${status.toLowerCase()}:${appointmentId}`,
        build: (f) => {
          const v = {
            c: appt.customer.name,
            b: appt.barber.name,
            s: appt.services,
            d: f.date(appt.startAt),
          };
          if (status === 'COMPLETED') {
            return {
              pt: { title: 'Atendimento concluído', message: `${v.b} concluiu ${v.s} de ${v.c}.` },
              en: { title: 'Service completed', message: `${v.b} completed ${v.s} for ${v.c}.` },
              es: { title: 'Servicio completado', message: `${v.b} completó ${v.s} de ${v.c}.` },
            };
          }
          if (status === 'CANCELLED') {
            return {
              pt: {
                title: 'Agendamento cancelado',
                message: `O horário de ${v.c} com ${v.b} em ${v.d} foi cancelado.`,
              },
              en: {
                title: 'Appointment cancelled',
                message: `${v.c}'s appointment with ${v.b} on ${v.d} was cancelled.`,
              },
              es: {
                title: 'Cita cancelada',
                message: `La cita de ${v.c} con ${v.b} el ${v.d} fue cancelada.`,
              },
            };
          }
          return {
            pt: {
              title: 'Cliente não compareceu',
              message: `${v.c} faltou ao horário de ${v.d} com ${v.b}.`,
            },
            en: {
              title: 'Customer no-show',
              message: `${v.c} missed the ${v.d} appointment with ${v.b}.`,
            },
            es: {
              title: 'Cliente no se presentó',
              message: `${v.c} no asistió a la cita del ${v.d} con ${v.b}.`,
            },
          };
        },
      });
    });
  }

  /** Cliente chegou sem horário marcado (fila de walk-in). */
  walkInCreated(walkInId: number, actorUserId: number | null) {
    return this.run('walkInCreated', async () => {
      const walkIn = await this.prisma.walkIn.findUnique({
        where: { id: walkInId },
        select: {
          barbershopId: true,
          barberId: true,
          customerName: true,
          barber: { select: { name: true } },
        },
      });
      if (!walkIn) return;
      const c = walkIn.customerName;
      const b = walkIn.barber?.name;
      await this.deliver(walkIn.barbershopId, 'appointments', {
        barberId: walkIn.barberId,
        actorUserId,
        path: 'walk-ins',
        type: NotificationType.INFO,
        key: `walkin:${walkInId}`,
        build: () => ({
          pt: {
            title: 'Cliente na fila',
            message: b
              ? `${c} chegou sem horário e aguarda ${b}.`
              : `${c} chegou sem horário e entrou na fila.`,
          },
          en: {
            title: 'Walk-in customer',
            message: b
              ? `${c} walked in and is waiting for ${b}.`
              : `${c} walked in and joined the queue.`,
          },
          es: {
            title: 'Cliente en la fila',
            message: b
              ? `${c} llegó sin cita y espera a ${b}.`
              : `${c} llegó sin cita y entró en la fila.`,
          },
        }),
      });
    });
  }

  /** Venda registrada — e estoque baixo, se a venda derrubou algum produto abaixo do mínimo. */
  saleCreated(saleId: number, actorUserId: number | null) {
    return this.run('saleCreated', async () => {
      const sale = await this.prisma.sale.findUnique({
        where: { id: saleId },
        select: {
          barbershopId: true,
          barberId: true,
          total: true,
          customer: { select: { name: true } },
          barber: { select: { name: true } },
        },
      });
      if (!sale) return;
      const c = sale.customer?.name;
      const b = sale.barber?.name;
      await this.deliver(sale.barbershopId, 'sales', {
        barberId: sale.barberId,
        actorUserId,
        path: 'sales',
        type: NotificationType.SUCCESS,
        key: `sale:${saleId}`,
        build: (f) => {
          const t = f.money(sale.total);
          return {
            pt: {
              title: 'Nova venda',
              message: `Venda de ${t}${c ? ` para ${c}` : ''}${b ? ` (${b})` : ''}.`,
            },
            en: {
              title: 'New sale',
              message: `Sale of ${t}${c ? ` to ${c}` : ''}${b ? ` (${b})` : ''}.`,
            },
            es: {
              title: 'Nueva venta',
              message: `Venta de ${t}${c ? ` a ${c}` : ''}${b ? ` (${b})` : ''}.`,
            },
          };
        },
      });
      await this.lowStockAfterSale(saleId, sale.barbershopId);
    });
  }

  /** Funcionário aceitou o convite e entrou na equipe. */
  memberJoined(barberId: number, newUserId: number) {
    return this.run('memberJoined', async () => {
      const barber = await this.prisma.barber.findUnique({
        where: { id: barberId },
        select: { barbershopId: true, name: true, staffType: true },
      });
      if (!barber) return;
      const manager = barber.staffType === 'manager';
      await this.deliver(barber.barbershopId, 'team', {
        actorUserId: newUserId,
        path: 'barbers',
        type: NotificationType.SUCCESS,
        key: `member:${barberId}`,
        build: (_f, shop) => ({
          pt: {
            title: 'Novo membro na equipe',
            message: `${barber.name} aceitou o convite e entrou em ${shop.name} como ${
              manager ? 'gerente' : 'barbeiro'
            }.`,
          },
          en: {
            title: 'New team member',
            message: `${barber.name} accepted the invite and joined ${shop.name} as ${
              manager ? 'manager' : 'barber'
            }.`,
          },
          es: {
            title: 'Nuevo miembro del equipo',
            message: `${barber.name} aceptó la invitación y entró en ${shop.name} como ${
              manager ? 'gerente' : 'barbero'
            }.`,
          },
        }),
      });
    });
  }

  /** Cliente avaliou a unidade (nova ou atualizada). */
  reviewPosted(
    barbershopId: number,
    clientAccountId: number,
    rating: number,
    comment?: string | null,
  ) {
    return this.run('reviewPosted', async () => {
      const client = await this.prisma.clientAccount.findUnique({
        where: { id: clientAccountId },
        select: { name: true },
      });
      const name = client?.name?.trim() || '—';
      const text = comment?.trim();
      const quote = text ? ` “${text.length > 140 ? `${text.slice(0, 140)}…` : text}”` : '';
      await this.deliver(barbershopId, 'reviews', {
        actorUserId: null,
        path: 'overview',
        type:
          rating >= 4
            ? NotificationType.SUCCESS
            : rating <= 2
            ? NotificationType.WARNING
            : NotificationType.INFO,
        key: `review:${barbershopId}:${clientAccountId}:${Date.now()}`,
        build: (_f, shop) => ({
          pt: {
            title: `Nova avaliação: ${rating}★`,
            message: `${name} avaliou ${shop.name} com ${rating} de 5.${quote}`,
          },
          en: {
            title: `New review: ${rating}★`,
            message: `${name} rated ${shop.name} ${rating} out of 5.${quote}`,
          },
          es: {
            title: `Nueva reseña: ${rating}★`,
            message: `${name} calificó ${shop.name} con ${rating} de 5.${quote}`,
          },
        }),
      });
    });
  }

  // ============ INTERNOS ============

  /** Nunca rejeita — quem chama pode ignorar a promessa (os testes esperam por ela). */
  private run(event: string, fn: () => Promise<void>): Promise<void> {
    return fn().catch((err) => {
      this.logger.warn(`Aviso de atividade (${event}) não enviado: ${err.message}`);
    });
  }

  private async loadAppointment(id: number) {
    const appt = await this.prisma.appointment.findUnique({
      where: { id },
      select: {
        barbershopId: true,
        barberId: true,
        startAt: true,
        customer: { select: { name: true } },
        barber: { select: { name: true } },
        services: { select: { service: { select: { name: true } } } },
      },
    });
    if (!appt) return null;
    return { ...appt, services: appt.services.map((s) => s.service.name).join(', ') || '—' };
  }

  /**
   * Estoque baixo: só avisa o produto que CRUZOU o mínimo nesta venda
   * (antes acima, depois igual ou abaixo) — não repete a cada venda de um
   * produto que já estava baixo.
   */
  private async lowStockAfterSale(saleId: number, barbershopId: number) {
    const movements = await this.prisma.inventoryMovement.findMany({
      where: { referenceType: 'SALE', referenceId: String(saleId) },
      select: {
        quantityBefore: true,
        quantityAfter: true,
        inventoryItem: {
          select: { id: true, minQuantity: true, unit: true, product: { select: { name: true } } },
        },
      },
    });
    for (const m of movements) {
      const min = m.inventoryItem.minQuantity;
      if (min === null) continue;
      const before = Number(m.quantityBefore);
      const after = Number(m.quantityAfter);
      if (!(before > Number(min) && after <= Number(min))) continue;
      const product = m.inventoryItem.product.name;
      await this.deliver(barbershopId, 'inventory', {
        actorUserId: null,
        path: 'inventory',
        type: NotificationType.WARNING,
        key: `low-stock:${m.inventoryItem.id}:${saleId}`,
        build: (f, shop) => {
          const q = after.toLocaleString(LOCALE[f.lang]);
          const mn = Number(min).toLocaleString(LOCALE[f.lang]);
          return {
            pt: {
              title: 'Estoque baixo',
              message: `${product} está com ${q} em ${shop.name} (mínimo ${mn}).`,
            },
            en: {
              title: 'Low stock',
              message: `${product} is down to ${q} at ${shop.name} (minimum ${mn}).`,
            },
            es: {
              title: 'Inventario bajo',
              message: `${product} tiene ${q} en ${shop.name} (mínimo ${mn}).`,
            },
          };
        },
      });
    }
  }

  private async deliver(
    barbershopId: number,
    category: ActivityCategory,
    opts: {
      barberId?: number | null;
      actorUserId: number | null;
      path: string;
      type: NotificationType;
      /** Identifica o evento — evita e-mail duplicado se o mesmo aviso for disparado duas vezes */
      key: string;
      build: (f: Fmt, shop: Shop) => Texts;
    },
  ) {
    const shop = await this.prisma.barbershop.findUnique({
      where: { id: barbershopId },
      select: {
        id: true,
        name: true,
        timezone: true,
        currency: true,
        ownerUserId: true,
        network: { select: { ownerUserId: true } },
        barbers: {
          where: {
            isActive: true,
            userId: { not: null },
            OR: [{ staffType: 'manager' }, ...(opts.barberId ? [{ id: opts.barberId }] : [])],
          },
          select: { userId: true },
        },
      },
    });
    if (!shop) return;

    const recipientIds = new Set<number>();
    for (const id of [
      shop.network.ownerUserId,
      shop.ownerUserId,
      ...shop.barbers.map((b) => b.userId),
    ]) {
      if (id && id !== opts.actorUserId) recipientIds.add(id);
    }
    if (recipientIds.size === 0) return;

    const users = await this.prisma.user.findMany({
      where: { id: { in: [...recipientIds] } },
      select: {
        id: true,
        email: true,
        fullName: true,
        notificationPreference: true,
        userSystemConfig: { select: { language: true } },
      },
    });

    const frontendUrl = (
      this.config.get<string>('FRONTEND_URL') || 'http://localhost:5173'
    ).replace(/\/$/, '');
    const path = `/barbershops/${barbershopId}/${opts.path}`;
    const textsByLang = new Map<Lang, Text>();
    const textFor = (lang: Lang) => {
      if (!textsByLang.has(lang))
        textsByLang.set(lang, opts.build(this.formatter(lang, shop), shop)[lang]);
      return textsByLang.get(lang)!;
    };

    const inApp: Array<{
      userId: number;
      title: string;
      message: string;
      type: NotificationType;
      actionUrl: string;
      actionText: string;
    }> = [];

    for (const user of users) {
      const pref = user.notificationPreference as unknown as Record<
        string,
        boolean | undefined
      > | null;
      const wantsInApp = pref?.[`${category}InApp`] ?? DEFAULTS[category].inApp;
      const wantsEmail = pref?.[`${category}Email`] ?? DEFAULTS[category].email;
      if (!wantsInApp && !wantsEmail) continue;

      const lang = this.langOf(user.userSystemConfig?.language);
      const text = textFor(lang);
      const actionText = ACTION_TEXT[opts.path][lang];
      if (wantsInApp) {
        inApp.push({ userId: user.id, ...text, type: opts.type, actionUrl: path, actionText });
      }
      if (wantsEmail && user.email) {
        await this.queue.email(
          {
            kind: 'user',
            userId: user.id,
            template: 'admin_notification',
            context: {
              title: text.title,
              message: escapeHtml(text.message),
              actionUrl: `${frontendUrl}${path}`,
              actionText,
              type: opts.type,
              fullName: user.fullName,
            },
            subject: `${text.title} · ${shop.name}`,
            meta: `activity:${category}`,
            to: user.email,
          },
          `activity:${opts.key}:${user.id}`,
        );
      }
    }

    if (inApp.length > 0) {
      await this.prisma.userNotification.createMany({ data: inApp });
      for (const n of inApp) this.realtime.notifyUsers([n.userId], 'CREATED', n.title);
    }
  }

  private langOf(language?: string | null): Lang {
    const l = (language || 'pt').slice(0, 2).toLowerCase();
    return l === 'en' || l === 'es' ? l : 'pt';
  }

  private formatter(lang: Lang, shop: Shop): Fmt {
    const locale = LOCALE[lang];
    let dateFmt: Intl.DateTimeFormat;
    try {
      dateFmt = new Intl.DateTimeFormat(locale, {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: shop.timezone,
      });
    } catch {
      dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });
    }
    let moneyFmt: Intl.NumberFormat;
    try {
      moneyFmt = new Intl.NumberFormat(locale, { style: 'currency', currency: shop.currency });
    } catch {
      moneyFmt = new Intl.NumberFormat(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
    return { lang, date: (d) => dateFmt.format(d), money: (v) => moneyFmt.format(Number(v)) };
  }
}
