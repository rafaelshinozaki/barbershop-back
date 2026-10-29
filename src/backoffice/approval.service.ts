import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountDeletionService } from '../barbershop/account-deletion.service';
import { AppPaymentsService, type AppPaymentKind } from '../barbershop/app-payments.service';
import { BackofficeService } from './backoffice.service';
import type { StaffActor } from './actor';

export const APPROVAL_ACTIONS = ['user.delete', 'payment.refund', 'email.mass'] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

/** E-mail para mais gente que isso (somando as últimas 24 h) pede confirmação */
export const MASS_EMAIL_LIMIT = 1000;
const MASS_EMAIL_WINDOW_MS = 24 * 60 * 60_000;

/** Pedido pendente por mais que isso não confirma mais. */
export const APPROVAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const TEAM_ROLES = ['SystemAdmin', 'SystemManager'];

/** Estorno acima disso (em reais) pede confirmação. Padrão R$ 500 */
export function refundApprovalLimit(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.BACKOFFICE_REFUND_APPROVAL_LIMIT;
  const value = Number(raw);
  return raw && Number.isFinite(value) && value >= 0 ? value : 500;
}

/** Limites por moeda: `BACKOFFICE_REFUND_APPROVAL_LIMITS=BRL:500,USD:100,EUR:90`. */
export function refundLimitsByCurrency(env: NodeJS.ProcessEnv = process.env): Map<string, number> {
  const map = new Map<string, number>();
  for (const part of (env.BACKOFFICE_REFUND_APPROVAL_LIMITS ?? '').split(',')) {
    const [code, amount] = part.split(':').map((piece) => piece.trim());
    const value = Number(amount);
    if (code && /^[A-Za-z]{3}$/.test(code) && Number.isFinite(value) && value >= 0) {
      map.set(code.toUpperCase(), value);
    }
  }
  return map;
}

/**
 * Estorno sem confirmação só cabe no limite daquela moeda. Real sem linha na
 * tabela usa o número antigo. Moeda sem limite pede confirmação sempre.
 */
export function refundExceedsLimit(
  total: number,
  currency: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const code = currency.trim().toUpperCase() || 'BRL';
  const limits = refundLimitsByCurrency(env);
  if (limits.has(code)) return total > (limits.get(code) as number);
  if (code === 'BRL') return total > refundApprovalLimit(env);
  return true;
}

export type ApprovalOutcome = { done: boolean; approvalId: number | null };

function sameApprovalTarget(action: string, left: unknown, right: unknown) {
  const a = (left ?? {}) as Record<string, unknown>;
  const b = (right ?? {}) as Record<string, unknown>;
  if (action === 'payment.refund') return a.kind === b.kind && Number(a.id) === Number(b.id);
  if (action === 'user.delete') return Number(a.userId) === Number(b.userId);
  if (action === 'email.mass') {
    const ids = (value: unknown) =>
      (Array.isArray(value) ? value : [])
        .map((id) => Number(id))
        .sort((x, y) => x - y)
        .join(',');
    return ids(a.userIds) === ids(b.userIds) && a.subject === b.subject;
  }
  return false;
}

type Payloads = {
  'user.delete': { userId: number };
  'payment.refund': { kind: AppPaymentKind; id: number; amount: number | null; reason: string };
  'email.mass': {
    userIds: number[];
    subject: string;
    message: string;
    actionUrl?: string;
    actionText?: string;
    type?: string;
  };
};

/**
 * Ação sem volta pedida por quem não é Administrador vira um pedido de
 * confirmação. Outro Administrador (nunca quem pediu) aprova, e aí ela é
 * executada; ou recusa, com uma nota. Tudo fica no registro de ações.
 */
@Injectable()
export class ApprovalService {
  private readonly logger = new Logger(ApprovalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountDeletionService,
    private readonly payments: AppPaymentsService,
    private readonly backoffice: BackofficeService,
  ) {}

  /**
   * Envio direto de e-mail por quem não é Administrador: cabe no limite se a
   * soma das últimas 24 h (com este) não passar de 1.000 pessoas. Cabendo,
   * já fica anotado; um envio por vez por pessoa (trava), pra dois pedaços
   * ao mesmo tempo não passarem juntos. Retorna o id da anotação, ou null se
   * precisa de confirmação.
   */
  async reserveDirectEmail(actor: StaffActor, recipients: number): Promise<number | null> {
    if (recipients > MASS_EMAIL_LIMIT) return null;
    const since = new Date(Date.now() - MASS_EMAIL_WINDOW_MS);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`email-send:${actor.email}`}))`;
      const sent = await tx.backofficeEmailSend.aggregate({
        where: { requestedByEmail: actor.email, createdAt: { gte: since } },
        _sum: { recipients: true },
      });
      if ((sent._sum.recipients ?? 0) + recipients > MASS_EMAIL_LIMIT) return null;
      const row = await tx.backofficeEmailSend.create({
        data: { requestedByEmail: actor.email, recipients },
      });
      return row.id;
    });
  }

  /** O envio falhou: a anotação sai e não conta no limite */
  async releaseDirectEmail(id: number) {
    await this.prisma.backofficeEmailSend.deleteMany({ where: { id } });
  }

  async request<A extends ApprovalAction>(
    action: A,
    payload: Payloads[A],
    summary: string,
    reason: string,
    actor: StaffActor,
  ): Promise<ApprovalOutcome> {
    if (!reason || reason.trim().length < 5) throw new BadRequestException('Informe o motivo');
    await this.expireStale();
    const open = await this.prisma.backofficeApproval.findMany({
      where: { action, status: 'pending' },
      select: { payload: true },
    });
    if (open.some((row) => sameApprovalTarget(action, payload, row.payload))) {
      throw new BadRequestException('Já existe um pedido igual pendente.');
    }
    const row = await this.prisma.backofficeApproval.create({
      data: {
        action,
        payload: payload as unknown as Prisma.InputJsonValue,
        summary: summary.slice(0, 300),
        reason: reason.trim().slice(0, 1000),
        requestedById: actor.id || null,
        requestedByEmail: actor.email,
        requestedByRole: actor.role,
      },
    });
    return { done: false, approvalId: row.id };
  }

  /** Administrador vê todos; o resto, só os que pediu */
  async list(actor: StaffActor, status?: string | null) {
    return this.prisma.backofficeApproval.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(actor.admin ? {} : { requestedByEmail: actor.email }),
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
    });
  }

  async pendingCount(actor: StaffActor) {
    if (!actor.admin) return 0;
    return this.prisma.backofficeApproval.count({ where: { status: 'pending' } });
  }

  async decide(id: number, approve: boolean, note: string | null | undefined, actor: StaffActor) {
    if (!actor.admin) throw new ForbiddenException('Só um Administrador confirma');
    const row = await this.prisma.backofficeApproval.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Pedido não encontrado');
    if (row.status !== 'pending') throw new BadRequestException('Este pedido já foi decidido');
    if (row.requestedByEmail.toLowerCase() === actor.email.toLowerCase()) {
      throw new ForbiddenException('Quem pediu não confirma o próprio pedido');
    }
    if (row.createdAt.getTime() < Date.now() - APPROVAL_TTL_MS) {
      await this.prisma.backofficeApproval.updateMany({
        where: { id, status: 'pending' },
        data: { status: 'expired', decidedAt: new Date() },
      });
      throw new BadRequestException('Este pedido venceu.');
    }
    if (!(await this.requesterOnTeam(row.requestedById, row.requestedByEmail))) {
      throw new BadRequestException('Quem pediu não está mais na equipe.');
    }
    const decided = {
      decidedById: actor.id || null,
      decidedByEmail: actor.email,
      decidedAt: new Date(),
      decisionNote: note?.trim().slice(0, 1000) || null,
    };
    // Condicional: dois Administradores ao mesmo tempo, só um decide
    const claimed = await this.prisma.backofficeApproval.updateMany({
      where: { id, status: 'pending' },
      data: { ...decided, status: approve ? 'executing' : 'rejected' },
    });
    if (claimed.count !== 1) throw new BadRequestException('Este pedido já foi decidido');
    if (!approve) return this.prisma.backofficeApproval.findUniqueOrThrow({ where: { id } });
    try {
      await this.execute(row.action as ApprovalAction, row.payload as never);
      return await this.prisma.backofficeApproval.update({
        where: { id },
        data: { status: 'executed' },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Pedido #${id} (${row.action}) falhou: ${message}`);
      return this.prisma.backofficeApproval.update({
        where: { id },
        data: { status: 'failed', error: message.slice(0, 500) },
      });
    }
  }

  /** Quem pediu desiste enquanto ainda está pendente. */
  async cancel(id: number, actor: StaffActor) {
    const row = await this.prisma.backofficeApproval.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Pedido não encontrado');
    if (row.requestedByEmail.toLowerCase() !== actor.email.toLowerCase()) {
      throw new ForbiddenException('Só quem pediu cancela o próprio pedido.');
    }
    const claimed = await this.prisma.backofficeApproval.updateMany({
      where: { id, status: 'pending' },
      data: {
        status: 'cancelled',
        decidedById: actor.id || null,
        decidedByEmail: actor.email,
        decidedAt: new Date(),
        decisionNote: 'Cancelado por quem pediu.',
      },
    });
    if (claimed.count !== 1) throw new BadRequestException('Este pedido já foi decidido');
    return this.prisma.backofficeApproval.findUniqueOrThrow({ where: { id } });
  }

  private async expireStale() {
    await this.prisma.backofficeApproval.updateMany({
      where: { status: 'pending', createdAt: { lt: new Date(Date.now() - APPROVAL_TTL_MS) } },
      data: { status: 'expired', decidedAt: new Date() },
    });
  }

  /** Sem ficha, o pedido antigo (id que não é usuário) segue. Ficha inativa ou fora da equipe, não. */
  private async requesterOnTeam(userId: number | null, email: string) {
    const who = userId
      ? await this.prisma.user.findUnique({
          where: { id: userId },
          select: { isActive: true, deleted_at: true, role: { select: { name: true } } },
        })
      : await this.prisma.user.findFirst({
          where: { email: { equals: email, mode: 'insensitive' } },
          select: { isActive: true, deleted_at: true, role: { select: { name: true } } },
        });
    if (!who) return true;
    return who.isActive && !who.deleted_at && TEAM_ROLES.includes(who.role?.name ?? '');
  }

  /**
   * Pedido já confirmado pela API do backoffice (status executing): executa
   * aqui, onde ficam a Stripe, os arquivos e os e-mails, e grava o
   * resultado. Pedido em outro status é ignorado (comando repetido não
   * executa de novo o que já terminou).
   */
  async executeConfirmed(id: number) {
    const row = await this.prisma.backofficeApproval.findUnique({ where: { id } });
    if (!row || row.status !== 'executing') {
      this.logger.warn(
        `Pedido #${id} não está esperando execução (${row?.status ?? 'não existe'})`,
      );
      return;
    }
    // Marca como feito antes de executar, num passo só: se o job for
    // entregue de novo (o processo caiu no meio), a ação não roda duas vezes
    // (no máximo uma: apagar conta, estorno e e-mail em massa não têm volta)
    const claimed = await this.prisma.backofficeApproval.updateMany({
      where: { id, status: 'executing' },
      data: { status: 'executed' },
    });
    if (claimed.count !== 1) return;
    try {
      await this.execute(row.action as ApprovalAction, row.payload as never);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Pedido #${id} (${row.action}) falhou: ${message}`);
      await this.prisma.backofficeApproval.update({
        where: { id },
        data: { status: 'failed', error: message.slice(0, 500) },
      });
    }
  }

  private async execute<A extends ApprovalAction>(action: A, payload: Payloads[A]) {
    if (action === 'user.delete') {
      await this.accounts.deleteByStaff((payload as Payloads['user.delete']).userId);
    } else if (action === 'payment.refund') {
      const p = payload as Payloads['payment.refund'];
      await this.payments.refund(p.kind, p.id, p.amount, p.reason);
    } else if (action === 'email.mass') {
      await this.backoffice.sendEmailNotification(payload as Payloads['email.mass']);
    } else {
      throw new BadRequestException(`Ação desconhecida: ${String(action)}`);
    }
  }
}
