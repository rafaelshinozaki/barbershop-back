import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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

export const SUPPORT_CATEGORIES = ['account', 'booking', 'payment', 'safety', 'other'] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];
export const SUPPORT_STATUSES = ['open', 'answered', 'closed'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

const MAX_SUBJECT = 150;
const MAX_BODY = 5000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ADMIN_TEXT = {
  pt: { title: 'Novo pedido de suporte', message: (s: string) => `"${s}" espera resposta.` },
  en: { title: 'New support request', message: (s: string) => `"${s}" is waiting for a reply.` },
  es: { title: 'Nueva solicitud de soporte', message: (s: string) => `"${s}" espera respuesta.` },
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
    await this.notifyAdmins(subject);
    return { id: ticket.id };
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
    await this.notifyAdmins(t.subject);
    return true;
  }

  // ---- equipe da plataforma ----

  async queue(status?: string | null) {
    const where = status && SUPPORT_STATUSES.includes(status as SupportStatus) ? { status } : {};
    const tickets = await this.prisma.supportTicket.findMany({
      where,
      orderBy: { lastActivityAt: 'desc' },
      take: 200,
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        clientAccount: { select: { id: true, suspendedAt: true } },
      },
    });
    // Esperando resposta primeiro
    const order: Record<string, number> = { open: 0, answered: 1, closed: 2 };
    return tickets
      .sort((a, b) => order[a.status] - order[b.status])
      .map((t) => ({
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
      }));
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
          FullName: ticket.name.split(' ')[0],
          Subject: ticket.subject,
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
  private async notifyAdmins(subject: string) {
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
        message: text.message(subject.slice(0, 80)),
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
          body: ADMIN_TEXT[lang].message(subject.slice(0, 80)),
          url: `${backofficeUrl()}/support`,
          tag: 'support',
        }),
      )
      .catch((error) => this.logger.warn(`Push do suporte não enviado: ${error}`));
  }
}
