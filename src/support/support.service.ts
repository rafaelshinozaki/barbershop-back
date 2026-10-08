import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/email/email.service';
import { normalizeLang } from '@/email/language';
import { RealtimeService } from '@/realtime/realtime.service';
import { PushService } from '@/push/push.service';
import { NotificationType } from '@/notifications/dto/create-notification.dto';
import { BackofficeArea } from '../auth/backoffice-areas';
import { Role } from '@/auth/interfaces/roles';
import { supportTicketUrl, verifySupportToken } from '@/barbershop/appointment-link';
import { backofficeUrl } from '../common/cors-origins';
import { assertCaptcha } from '../common/captcha';

export const SUPPORT_CATEGORIES = ['account', 'booking', 'payment', 'safety', 'other'] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];
export const SUPPORT_STATUSES = ['open', 'answered', 'closed'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

const MAX_SUBJECT = 150;
const MAX_BODY = 5000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Pedidos anônimos para o mesmo e-mail: o formulário não vira disparo em massa */
const PUBLIC_TICKETS_PER_EMAIL = 3;
const PUBLIC_TICKET_WINDOW_MS = 24 * 60 * 60 * 1000;
const QUEUE_SIZE = 200;

const ADMIN_TEXT = {
  pt: { title: 'Novo pedido de suporte', message: 'Há um pedido novo na fila.' },
  en: { title: 'New support request', message: 'There is a new request in the queue.' },
  es: { title: 'Nueva solicitud de soporte', message: 'Hay una solicitud nueva en la fila.' },
};

export type SupportRequester = { userId?: number | null; clientAccountId?: number | null };

/**
 * Suporte humano: "Fale com a gente" (visitante, cliente ou equipe) abre um
 * pedido; a equipe da plataforma responde pela fila do backoffice e a
 * resposta vai por e-mail com o link do pedido, onde quem pediu acompanha e
 * responde sem login. Sai 24 meses depois da última atividade.
 */
@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly realtime: RealtimeService,
    private readonly push: PushService,
  ) {}

  private text(value: string | null | undefined, max: number, label: string) {
    const v = (value ?? '').trim();
    if (!v) throw new BadRequestException(`${label} é obrigatório`);
    if (v.length > max) throw new BadRequestException(`${label} com no máximo ${max} caracteres`);
    return v;
  }

  async create(
    input: {
      name: string;
      email: string;
      category: string;
      subject: string;
      message: string;
      language?: string | null;
      captchaToken?: string | null;
    },
    requester: SupportRequester = {},
  ) {
    const name = this.text(input.name, 120, 'Nome');
    const email = this.text(input.email, 254, 'E-mail').toLowerCase();
    if (!EMAIL_RE.test(email)) throw new BadRequestException('E-mail inválido');
    if (!SUPPORT_CATEGORIES.includes(input.category as SupportCategory)) {
      throw new BadRequestException('Assunto inválido');
    }
    const subject = this.text(input.subject, MAX_SUBJECT, 'Título');
    const body = this.text(input.message, MAX_BODY, 'Mensagem');
    // Sem conta da equipe: captcha (se configurado) e teto por destinatário
    if (!requester.userId) {
      await assertCaptcha(input.captchaToken);
      await this.assertPublicRecipientLimit(email);
    }
    const ticket = await this.prisma.supportTicket.create({
      data: {
        name,
        email,
        category: input.category,
        subject,
        language: input.language ? normalizeLang(input.language) : null,
        userId: requester.userId ?? null,
        clientAccountId: requester.clientAccountId ?? null,
        messages: { create: { side: 'requester', body } },
      },
    });
    await this.sendRequesterEmail(ticket, 'support_received', null);
    await this.notifyAdmins();
    return { id: ticket.id };
  }

  /** Mesmo endereço não recebe vários e-mails de confirmação no mesmo dia */
  private async assertPublicRecipientLimit(email: string) {
    const since = new Date(Date.now() - PUBLIC_TICKET_WINDOW_MS);
    const count = await this.prisma.supportTicket.count({
      where: { email, userId: null, createdAt: { gte: since } },
    });
    if (count >= PUBLIC_TICKETS_PER_EMAIL) {
      throw new HttpException(
        'Muitos pedidos para este e-mail. Tente novamente amanhã.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  // ---- quem pediu (pelo link do e-mail) ----

  private async byToken(token: string) {
    const id = verifySupportToken(token);
    const ticket = id
      ? await this.prisma.supportTicket.findUnique({
          where: { id },
          include: { messages: { orderBy: { createdAt: 'asc' } } },
        })
      : null;
    if (!ticket) throw new NotFoundException('Pedido não encontrado');
    return ticket;
  }

  async forRequester(token: string) {
    const t = await this.byToken(token);
    return {
      id: t.id,
      subject: t.subject,
      category: t.category,
      status: t.status,
      createdAt: t.createdAt,
      messages: t.messages.map((m) => ({
        id: m.id,
        createdAt: m.createdAt,
        side: m.side,
        body: m.body,
      })),
    };
  }

  async requesterReply(token: string, body: string) {
    const t = await this.byToken(token);
    const text = this.text(body, MAX_BODY, 'Mensagem');
    const now = new Date();
    // Responder reabre o pedido fechado
    await this.prisma.supportTicket.update({
      where: { id: t.id },
      data: {
        status: 'open',
        closedAt: null,
        lastActivityAt: now,
        messages: { create: { side: 'requester', body: text } },
      },
    });
    await this.notifyAdmins();
    return true;
  }

  // ---- equipe da plataforma ----

  async queue(status?: string | null) {
    const include = {
      messages: { orderBy: { createdAt: 'asc' as const } },
      clientAccount: { select: { id: true as const, suspendedAt: true as const } },
    };
    const filtered =
      status && SUPPORT_STATUSES.includes(status as SupportStatus) ? status : null;
    // Sem filtro, os abertos entram antes do take: um chamado antigo esperando
    // resposta não some atrás de 200 fechados recentes
    const tickets = filtered
      ? await this.prisma.supportTicket.findMany({
          where: { status: filtered },
          orderBy: { lastActivityAt: 'desc' },
          take: QUEUE_SIZE,
          include,
        })
      : await this.openFirst(include);
    return tickets.map((t) => this.presentTicket(t));
  }

  private async openFirst(include: {
    messages: { orderBy: { createdAt: 'asc' } };
    clientAccount: { select: { id: true; suspendedAt: true } };
  }) {
    const open = await this.prisma.supportTicket.findMany({
      where: { status: 'open' },
      orderBy: { lastActivityAt: 'desc' },
      take: QUEUE_SIZE,
      include,
    });
    const restTake = QUEUE_SIZE - open.length;
    if (restTake <= 0) return open;
    const rest = await this.prisma.supportTicket.findMany({
      where: { status: { in: ['answered', 'closed'] } },
      orderBy: { lastActivityAt: 'desc' },
      take: restTake,
      include,
    });
    const rank: Record<string, number> = { answered: 0, closed: 1 };
    rest.sort(
      (a, b) => rank[a.status] - rank[b.status] || b.lastActivityAt.getTime() - a.lastActivityAt.getTime(),
    );
    return [...open, ...rest];
  }

  private presentTicket(t: {
    id: number;
    createdAt: Date;
    lastActivityAt: Date;
    status: string;
    category: string;
    subject: string;
    name: string;
    email: string;
    userId: number | null;
    clientAccount: { id: number; suspendedAt: Date | null } | null;
    messages: { id: number; createdAt: Date; side: string; body: string }[];
  }) {
    return {
      id: t.id,
      createdAt: t.createdAt,
      lastActivityAt: t.lastActivityAt,
      status: t.status,
      category: t.category,
      subject: t.subject,
      name: t.name,
      email: t.email,
      fromStaff: t.userId != null,
      clientAccountId: t.clientAccount?.id ?? null,
      clientSuspended: !!t.clientAccount?.suspendedAt,
      messages: t.messages.map((m) => ({
        id: m.id,
        createdAt: m.createdAt,
        side: m.side,
        body: m.body,
      })),
    };
  }

  async answer(adminUserId: number, ticketId: number, body: string, close = false) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Pedido não encontrado');
    const text = this.text(body, MAX_BODY, 'Resposta');
    const now = new Date();
    const updated = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: close ? 'closed' : 'answered',
        closedAt: close ? now : null,
        lastActivityAt: now,
        messages: { create: { side: 'support', body: text, authorUserId: adminUserId } },
      },
    });
    await this.sendRequesterEmail(updated, 'support_reply', text);
    return true;
  }

  async setStatus(ticketId: number, status: string) {
    if (!SUPPORT_STATUSES.includes(status as SupportStatus)) {
      throw new BadRequestException('Situação inválida');
    }
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Pedido não encontrado');
    await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status, closedAt: status === 'closed' ? new Date() : null },
    });
    return true;
  }

  /**
   * E-mail da resposta pra quem pediu, quando a resposta foi gravada pela API
   * do backoffice (comando support.reply_email). Pedido que não existe mais:
   * nada a avisar.
   */
  async emailReply(ticketId: number, reply: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) {
      this.logger.warn(`Resposta do pedido ${ticketId}: pedido não existe mais`);
      return;
    }
    await this.sendRequesterEmail(ticket, 'support_reply', reply);
  }

  /** Quantos esperam resposta (pro menu do backoffice) */
  openCount() {
    return this.prisma.supportTicket.count({ where: { status: 'open' } });
  }

  private async sendRequesterEmail(
    ticket: { id: number; name: string; email: string; subject: string; language: string | null },
    template: 'support_received' | 'support_reply',
    reply: string | null,
  ) {
    const received = template === 'support_received';
    try {
      await this.email.sendCustomerEmail(
        null,
        template,
        {
          // Confirmação não repete nome nem assunto: quem manda escolhe os dois,
          // e o e-mail ia para qualquer endereço
          FullName: received ? undefined : ticket.name.split(' ')[0],
          Subject: received ? undefined : ticket.subject,
          Reply: reply,
          TicketURL: supportTicketUrl(ticket.id),
          TicketId: ticket.id,
          AppName: 'Barbershop',
          SupportEmail: 'suporte@barbershop.com.br',
          Year: new Date().getFullYear(),
        },
        received
          ? {
              pt: `Recebemos seu pedido #${ticket.id}`,
              en: `We received your request #${ticket.id}`,
              es: `Recibimos tu solicitud #${ticket.id}`,
            }
          : {
              pt: `Resposta ao seu pedido #${ticket.id}`,
              en: `Reply to your request #${ticket.id}`,
              es: `Respuesta a tu solicitud #${ticket.id}`,
            },
        received ? 'support-received' : 'support-reply',
        ticket.email,
        normalizeLang(ticket.language),
      );
    } catch (error) {
      this.logger.warn(`E-mail do suporte não enviado (pedido ${ticket.id}): ${error}`);
    }
  }

  /** Sininho da equipe da plataforma (admin e quem da equipe tem a área Suporte) */
  private async notifyAdmins() {
    const admins = await this.prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          { role: { name: Role.SYSTEM_ADMIN } },
          {
            role: { name: Role.SYSTEM_MANAGER },
            backofficeAreas: { has: BackofficeArea.SUPPORT },
          },
        ],
      },
      select: { id: true, userSystemConfig: { select: { language: true } } },
    });
    if (!admins.length) return;
    const data = admins.map((u) => {
      const text = ADMIN_TEXT[normalizeLang(u.userSystemConfig?.language)];
      return {
        userId: u.id,
        title: text.title,
        message: text.message,
        type: NotificationType.INFO,
        actionUrl: `${backofficeUrl()}/support`,
      };
    });
    await this.prisma.userNotification.createMany({ data });
    for (const n of data) this.realtime.notifyUsers([n.userId], 'CREATED', n.title);
    await this.push
      .sendToUsers(
        admins.map((u) => u.id),
        (lang) => ({
          title: ADMIN_TEXT[lang].title,
          body: ADMIN_TEXT[lang].message,
          url: `${backofficeUrl()}/support`,
          tag: 'support',
        }),
      )
      .catch((error) => this.logger.warn(`Push do suporte não enviado: ${error}`));
  }
}
