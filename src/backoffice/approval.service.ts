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

/** E-mail para mais gente que isso pede confirmação */
export const MASS_EMAIL_LIMIT = 1000;

/** Estorno acima disso (em reais) pede confirmação. Padrão R$ 500 */
export function refundApprovalLimit(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.BACKOFFICE_REFUND_APPROVAL_LIMIT;
  const value = Number(raw);
  return raw && Number.isFinite(value) && value >= 0 ? value : 500;
}

export type ApprovalOutcome = { done: boolean; approvalId: number | null };

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

  async request<A extends ApprovalAction>(
    action: A,
    payload: Payloads[A],
    summary: string,
    reason: string,
    actor: StaffActor,
  ): Promise<ApprovalOutcome> {
    if (!reason || reason.trim().length < 5) throw new BadRequestException('Informe o motivo');
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
    try {
      await this.execute(row.action as ApprovalAction, row.payload as never);
      await this.prisma.backofficeApproval.updateMany({
        where: { id, status: 'executing' },
        data: { status: 'executed' },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Pedido #${id} (${row.action}) falhou: ${message}`);
      await this.prisma.backofficeApproval.updateMany({
        where: { id, status: 'executing' },
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
