import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationQueueService } from '../queue/notification-queue.service';
import { RealtimeService } from '../realtime/realtime.service';
import { langForCountry, LOCALE, normalizeLang } from '../email/language';
import { appointmentManageUrl, verifyAppointmentToken } from './appointment-link';
import { BarbershopService, currentEngagement, type AccessLevel } from './barbershop.service';
import { NotificationType } from '../notifications/dto/create-notification.dto';
import { ModerationService } from './moderation.service';
import { PushService } from '../push/push.service';

export type ChatKind = 'unit' | 'professional';
export const CHAT_KINDS: ChatKind[] = ['unit', 'professional'];
const MAX_BODY = 2000;
/** E-mail pro cliente: no máximo um a cada 30 minutos por conversa */
const CLIENT_EMAIL_EVERY_MS = 30 * 60_000;
const DESK_LEVELS: AccessLevel[] = ['reception', 'manager', 'owner'];
const INBOX_SIZE = 50;

/** Quem está vendo: o cliente (pela conta ou pelo link do e-mail) ou alguém da equipe */
export type ChatViewer =
  | { side: 'client'; clientAccountId?: number | null; manageToken?: string | null }
  | { side: 'staff'; userId: number };

type Appt = NonNullable<Awaited<ReturnType<ChatService['loadAppointment']>>>;

const CLIENT_PUSH_TEXT = {
  pt: {
    title: 'Nova mensagem',
    message: (from: string) => `${from} respondeu sobre o seu atendimento.`,
  },
  en: {
    title: 'New message',
    message: (from: string) => `${from} replied about your appointment.`,
  },
  es: { title: 'Nuevo mensaje', message: (from: string) => `${from} respondió sobre tu cita.` },
};

const INBOX_TEXT = {
  pt: { title: 'Nova mensagem', message: (who: string) => `${who} mandou uma mensagem.` },
  en: { title: 'New message', message: (who: string) => `${who} sent a message.` },
  es: { title: 'Nuevo mensaje', message: (who: string) => `${who} envió un mensaje.` },
};

/**
 * Chat preso ao atendimento (item 11), como o do pedido no iFood: uma
 * conversa do cliente com a unidade (não existe no modo solo) e outra com o
 * profissional que atende. Cada uma só de quem participa: a unidade
 * (recepção pra cima) não lê a do profissional, e o profissional não lê a
 * da unidade, salvo quando é a mesma pessoa. O telefone segue oculto.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly barbershops: BarbershopService,
    private readonly queue: NotificationQueueService,
    private readonly realtime: RealtimeService,
    private readonly moderation: ModerationService,
    private readonly push: PushService,
  ) {}

  private loadAppointment(appointmentId: number) {
    return this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        startAt: true,
        status: true,
        barbershop: {
          select: {
            id: true,
            name: true,
            practiceKind: true,
            country: true,
            timezone: true,
            ownerUserId: true,
          },
        },
        barber: { select: { id: true, name: true, userId: true } },
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            clientAccountId: true,
            blockedAt: true,
            clientAccount: {
              select: {
                id: true,
                email: true,
                name: true,
                language: true,
                deletedAt: true,
                suspendedAt: true,
              },
            },
          },
        },
      },
    });
  }

  /** Conversas que existem pra esse atendimento (no modo solo, só a do profissional) */
  private kindsOf(appt: Appt): ChatKind[] {
    return appt.barbershop.practiceKind === 'solo' ? ['professional'] : ['unit', 'professional'];
  }

  /** Quais conversas desse atendimento quem está vendo pode abrir */
  private async allowedKinds(appt: Appt, viewer: ChatViewer): Promise<ChatKind[]> {
    const kinds = this.kindsOf(appt);
    if (viewer.side === 'client') {
      const account = appt.customer.clientAccount;
      // Conta ligada suspensa ou excluída: o link do e-mail também não entra
      if (account && (account.deletedAt || account.suspendedAt)) return [];
      const byToken = viewer.manageToken && verifyAppointmentToken(viewer.manageToken) === appt.id;
      const byAccount =
        !!viewer.clientAccountId && appt.customer.clientAccountId === viewer.clientAccountId;
      return byToken || byAccount ? kinds : [];
    }
    const out: ChatKind[] = [];
    const needsLevel = kinds.includes('unit') || appt.barber.userId === viewer.userId;
    const level = needsLevel
      ? await this.barbershops.getMyAccessLevel(viewer.userId, appt.barbershop.id)
      : null;
    if (kinds.includes('unit') && level && DESK_LEVELS.includes(level)) out.push('unit');
    // Quem saiu da unidade (ou freelancer fora do período) não lê a conversa
    if (appt.barber.userId === viewer.userId && level) out.push('professional');
    return out;
  }

  private async appointmentFor(appointmentId: number, viewer: ChatViewer, barbershopId?: number) {
    const appt = await this.loadAppointment(appointmentId);
    if (!appt || (barbershopId != null && appt.barbershop.id !== barbershopId)) {
      throw new NotFoundException('Agendamento não encontrado');
    }
    const kinds = await this.allowedKinds(appt, viewer);
    if (!kinds.length) throw new NotFoundException('Agendamento não encontrado');
    return { appt, kinds };
  }

  /** Nome do outro lado, como aparece no título da conversa */
  private titleFor(appt: Appt, kind: ChatKind, viewer: ChatViewer) {
    if (viewer.side === 'staff') return appt.customer.name;
    return kind === 'unit' ? appt.barbershop.name : appt.barber.name;
  }

  /**
   * As conversas do atendimento que quem está vendo pode abrir, com as
   * mensagens. Abrir marca como lidas as do outro lado.
   */
  async threads(appointmentId: number, viewer: ChatViewer, barbershopId?: number) {
    const { appt, kinds } = await this.appointmentFor(appointmentId, viewer, barbershopId);
    const threads = await this.prisma.chatThread.findMany({
      where: { appointmentId, kind: { in: kinds } },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    const now = new Date();
    const readField = viewer.side === 'client' ? 'clientReadAt' : 'staffReadAt';
    const opened = threads.filter((t) => t.messages.length);
    if (opened.length) {
      await this.prisma.chatThread.updateMany({
        where: { id: { in: opened.map((t) => t.id) } },
        data: { [readField]: now },
      });
    }
    return kinds.map((kind) => {
      const thread = threads.find((t) => t.kind === kind);
      return {
        appointmentId,
        kind,
        title: this.titleFor(appt, kind, viewer),
        startAt: appt.startAt,
        // Cancelado, encerrado pela moderação ou cliente bloqueado pela unidade: só leitura
        canSend:
          appt.status !== 'CANCELLED' &&
          !thread?.closedAt &&
          !(viewer.side === 'client' && appt.customer.blockedAt),
        reported: !!thread?.retainUntil,
        closed: !!thread?.closedAt,
        blocked: !!appt.customer.blockedAt,
        messages: (thread?.messages ?? []).map((m) => ({
          id: m.id,
          createdAt: m.createdAt,
          side: m.senderSide,
          body: m.body,
          mine: m.senderSide === viewer.side,
        })),
      };
    });
  }

  async send(
    appointmentId: number,
    kind: string,
    body: string,
    viewer: ChatViewer,
    barbershopId?: number,
  ) {
    if (!CHAT_KINDS.includes(kind as ChatKind)) throw new BadRequestException('Conversa inválida');
    const text = (body ?? '').trim();
    if (!text) throw new BadRequestException('Escreva a mensagem');
    if (text.length > MAX_BODY) {
      throw new BadRequestException(`Mensagem com no máximo ${MAX_BODY} caracteres`);
    }
    const { appt, kinds } = await this.appointmentFor(appointmentId, viewer, barbershopId);
    if (!kinds.includes(kind as ChatKind)) throw new ForbiddenException('Conversa indisponível');
    if (appt.status === 'CANCELLED') {
      throw new BadRequestException('Atendimento cancelado: a conversa não recebe mensagens.');
    }
    if (viewer.side === 'client' && appt.customer.blockedAt) {
      throw new ForbiddenException('A unidade não recebe mensagens deste cliente.');
    }
    const existing = await this.prisma.chatThread.findUnique({
      where: { appointmentId_kind: { appointmentId, kind } },
      select: { closedAt: true },
    });
    if (existing?.closedAt) {
      throw new BadRequestException('Conversa encerrada pela moderação.');
    }
    const now = new Date();
    const thread = await this.prisma.chatThread.upsert({
      where: { appointmentId_kind: { appointmentId, kind } },
      create: {
        appointmentId,
        kind,
        barbershopId: appt.barbershop.id,
        customerId: appt.customer.id,
        barberId: kind === 'professional' ? appt.barber.id : null,
        lastMessageAt: now,
        ...(viewer.side === 'client' ? { clientReadAt: now } : { staffReadAt: now }),
      },
      update: {
        lastMessageAt: now,
        ...(viewer.side === 'client' ? { clientReadAt: now } : { staffReadAt: now }),
      },
    });
    const message = await this.prisma.chatMessage.create({
      data: {
        threadId: thread.id,
        senderSide: viewer.side,
        senderUserId: viewer.side === 'staff' ? viewer.userId : null,
        body: text,
      },
    });
    if (viewer.side === 'client') await this.notifyStaff(appt, kind as ChatKind);
    else await this.notifyClient(appt, kind as ChatKind, thread);
    return {
      id: message.id,
      createdAt: message.createdAt,
      side: viewer.side,
      body: text,
      mine: true,
    };
  }

  /** Cliente escreveu: aviso no sininho de quem participa do outro lado */
  private async notifyStaff(appt: Appt, kind: ChatKind) {
    let userIds: number[];
    if (kind === 'professional') {
      const userId = appt.barber.userId;
      const level = userId
        ? await this.barbershops.getMyAccessLevel(userId, appt.barbershop.id)
        : null;
      userIds = userId && level ? [userId] : [];
    } else {
      const desk = await this.prisma.barber.findMany({
        where: {
          barbershopId: appt.barbershop.id,
          ...currentEngagement(),
          userId: { not: null },
          staffType: { in: ['reception', 'manager'] },
        },
        select: { userId: true },
      });
      userIds = [
        ...(appt.barbershop.ownerUserId ? [appt.barbershop.ownerUserId] : []),
        ...desk.flatMap((b) => (b.userId != null ? [b.userId] : [])),
      ];
    }
    userIds = [...new Set(userIds)];
    if (!userIds.length) return;
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, userSystemConfig: { select: { language: true } } },
    });
    const who = appt.customer.name.split(' ')[0];
    const data = users.map((u) => {
      const text = INBOX_TEXT[normalizeLang(u.userSystemConfig?.language)];
      return {
        userId: u.id,
        title: text.title,
        message: text.message(who),
        // Valor do enum do sininho (outro valor quebra a lista inteira)
        type: NotificationType.INFO,
        actionUrl: `/messages?appointment=${appt.id}`,
      };
    });
    await this.prisma.userNotification.createMany({ data });
    for (const n of data) this.realtime.notifyUsers([n.userId], 'CREATED', n.title);
    // No celular também (sem o texto da mensagem, como no e-mail)
    await this.push
      .sendToUsers(
        users.map((u) => u.id),
        (lang) => ({
          title: INBOX_TEXT[lang].title,
          body: INBOX_TEXT[lang].message(who),
          url: `/messages?appointment=${appt.id}`,
          tag: `chat-${appt.id}`,
        }),
      )
      .catch((error) => this.logger.warn(`Push do chat não enviado: ${error}`));
  }

  /** Equipe escreveu: e-mail pro cliente (sem o texto), no máximo um a cada 30 minutos */
  private async notifyClient(
    appt: Appt,
    kind: ChatKind,
    thread: { id: number; clientNotifiedAt: Date | null },
  ) {
    const account = appt.customer.clientAccount?.deletedAt ? null : appt.customer.clientAccount;
    const from = kind === 'unit' ? appt.barbershop.name : appt.barber.name;
    // Celular: a cada mensagem (a mesma tag substitui a anterior), sem o texto
    if (account) {
      await this.push
        .sendToClient(account.id, (lang) => ({
          title: CLIENT_PUSH_TEXT[lang].title,
          body: CLIENT_PUSH_TEXT[lang].message(from),
          url: `${appointmentManageUrl(appt.id)}#chat`,
          tag: `chat-${appt.id}-${kind}`,
        }))
        .catch((error) => this.logger.warn(`Push do chat não enviado: ${error}`));
    }
    const to = account?.email ?? appt.customer.email;
    if (!to) return;
    const now = Date.now();
    if (thread.clientNotifiedAt && now - thread.clientNotifiedAt.getTime() < CLIENT_EMAIL_EVERY_MS)
      return;
    await this.prisma.chatThread.update({
      where: { id: thread.id },
      data: { clientNotifiedAt: new Date(now) },
    });
    const lang = account?.language
      ? normalizeLang(account.language)
      : langForCountry(appt.barbershop.country);
    try {
      await this.queue.email(
        {
          kind: 'customer',
          loggedAgainstUserId: appt.barbershop.ownerUserId ?? 0,
          template: 'chat_message',
          context: {
            FullName: (account?.name ?? appt.customer.name).split(' ')[0],
            From: kind === 'unit' ? appt.barbershop.name : appt.barber.name,
            When: appt.startAt.toLocaleString(LOCALE[lang], {
              dateStyle: 'short',
              timeStyle: 'short',
              timeZone: appt.barbershop.timezone,
            }),
            ChatURL: `${appointmentManageUrl(appt.id)}#chat`,
            AppName: 'Barbershop',
            SupportEmail: 'suporte@barbershop.com.br',
            Year: new Date().getFullYear(),
          },
          subject: {
            pt: `Nova mensagem de ${kind === 'unit' ? appt.barbershop.name : appt.barber.name}`,
            en: `New message from ${kind === 'unit' ? appt.barbershop.name : appt.barber.name}`,
            es: `Nuevo mensaje de ${kind === 'unit' ? appt.barbershop.name : appt.barber.name}`,
          },
          meta: 'chat-message',
          to,
          lang,
        },
        `chat:${thread.id}:${now}`,
      );
    } catch (error) {
      this.logger.warn(`Aviso de mensagem não enviado (conversa ${thread.id}): ${error}`);
    }
  }

  /**
   * Denunciar a conversa (quem participa dela): vai pra fila de moderação e
   * o texto fica guardado até a decisão, mesmo depois dos 12 meses.
   */
  async report(
    appointmentId: number,
    kind: string,
    input: { reason: string; details?: string | null },
    viewer: ChatViewer,
    barbershopId?: number,
  ) {
    const { kinds } = await this.appointmentFor(appointmentId, viewer, barbershopId);
    if (!kinds.includes(kind as ChatKind)) throw new ForbiddenException('Conversa indisponível');
    const thread = await this.prisma.chatThread.findUnique({
      where: { appointmentId_kind: { appointmentId, kind } },
      select: { id: true },
    });
    if (!thread) throw new NotFoundException('Conversa sem mensagens');
    const reporter =
      viewer.side === 'staff'
        ? `staff:${viewer.userId}`
        : `client:${viewer.clientAccountId ?? viewer.manageToken ?? ''}`;
    return this.moderation.reportChatThread(thread.id, input, reporter);
  }

  /** Caixa de entrada da equipe: as conversas de que a pessoa participa, mais recentes primeiro */
  async staffInbox(userId: number) {
    const shops = await this.prisma.barber.findMany({
      where: { userId, ...currentEngagement() },
      select: { id: true, barbershopId: true },
    });
    const owned = await this.prisma.barbershop.findMany({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    const shopIds = [...new Set([...shops.map((s) => s.barbershopId), ...owned.map((s) => s.id)])];
    const deskShops: number[] = [];
    for (const id of shopIds) {
      const level = await this.barbershops.getMyAccessLevel(userId, id);
      if (level && DESK_LEVELS.includes(level)) deskShops.push(id);
    }
    const threads = await this.prisma.chatThread.findMany({
      where: {
        lastMessageAt: { not: null },
        OR: [
          { kind: 'unit', barbershopId: { in: deskShops } },
          { kind: 'professional', barberId: { in: shops.map((s) => s.id) } },
        ],
      },
      orderBy: { lastMessageAt: 'desc' },
      take: INBOX_SIZE,
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        appointment: {
          select: {
            startAt: true,
            barbershop: { select: { id: true, name: true } },
            customer: { select: { name: true } },
          },
        },
      },
    });
    const unread = await this.unreadCounts(threads, 'staff');
    return threads.map((t) => ({
      appointmentId: t.appointmentId,
      barbershopId: t.appointment.barbershop.id,
      kind: t.kind,
      title: t.appointment.customer.name,
      subtitle: t.appointment.barbershop.name,
      startAt: t.appointment.startAt,
      lastMessageAt: t.lastMessageAt,
      lastMessage: t.messages[0]?.body ?? null,
      unread: unread.get(t.id) ?? 0,
    }));
  }

  /** Caixa de entrada do cliente (conta com e-mail confirmado ligada às fichas) */
  async clientInbox(clientAccountId: number) {
    const threads = await this.prisma.chatThread.findMany({
      where: {
        lastMessageAt: { not: null },
        appointment: { customer: { clientAccountId } },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: INBOX_SIZE,
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        appointment: {
          select: {
            startAt: true,
            barbershop: { select: { id: true, name: true } },
            barber: { select: { name: true } },
          },
        },
      },
    });
    const unread = await this.unreadCounts(threads, 'client');
    return threads.map((t) => ({
      appointmentId: t.appointmentId,
      barbershopId: t.appointment.barbershop.id,
      kind: t.kind,
      title: t.kind === 'unit' ? t.appointment.barbershop.name : t.appointment.barber.name,
      subtitle: t.appointment.barbershop.name,
      startAt: t.appointment.startAt,
      lastMessageAt: t.lastMessageAt,
      lastMessage: t.messages[0]?.body ?? null,
      unread: unread.get(t.id) ?? 0,
    }));
  }

  /** Mensagens do outro lado depois da última leitura de quem está vendo */
  private async unreadCounts(
    threads: Array<{ id: number; clientReadAt: Date | null; staffReadAt: Date | null }>,
    side: 'client' | 'staff',
  ) {
    const out = new Map<number, number>();
    for (const t of threads) {
      const readAt = side === 'client' ? t.clientReadAt : t.staffReadAt;
      const count = await this.prisma.chatMessage.count({
        where: {
          threadId: t.id,
          senderSide: side === 'client' ? 'staff' : 'client',
          ...(readAt ? { createdAt: { gt: readAt } } : {}),
        },
      });
      out.set(t.id, count);
    }
    return out;
  }
}
