import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { StaffActor } from './actor';

export const PRIVACY_KINDS = ['access', 'correction', 'deletion', 'portability', 'other'] as const;
export const PRIVACY_CHANNELS = ['email', 'support', 'other'] as const;
export const PRIVACY_STATUSES = ['open', 'in_progress', 'done', 'rejected'] as const;
/** Prazo da LGPD (art. 19, II) */
export const PRIVACY_DEADLINE_DAYS = 15;

const DAY = 86_400_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type NewPrivacyRequest = {
  kind: string;
  channel: string;
  requesterName: string;
  requesterEmail: string;
  details: string;
  supportTicketId?: number | null;
};

/**
 * Pedidos do titular (LGPD) que chegam por e-mail ou suporte. A equipe do
 * Suporte registra, liga à conta (pelo e-mail) e responde dentro de 15
 * dias. Exclusão de conta sai pela ficha da pessoa ("Apagar conta", com a
 * confirmação de um Administrador); aqui fica o registro do pedido e da
 * resposta.
 */
@Injectable()
export class PrivacyRequestService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: NewPrivacyRequest, actor: StaffActor, now = new Date()) {
    if (!(PRIVACY_KINDS as readonly string[]).includes(input.kind)) {
      throw new BadRequestException('Tipo de pedido inválido');
    }
    if (!(PRIVACY_CHANNELS as readonly string[]).includes(input.channel)) {
      throw new BadRequestException('Canal inválido');
    }
    const email = input.requesterEmail.trim().toLowerCase();
    if (!EMAIL.test(email)) throw new BadRequestException('E-mail inválido');
    if (!input.requesterName.trim()) throw new BadRequestException('Informe o nome');
    if (!input.details.trim()) throw new BadRequestException('Descreva o pedido');
    // Liga à conta da plataforma e à área do cliente com o mesmo e-mail
    const [user, client] = await Promise.all([
      this.prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' }, deleted_at: null },
        select: { id: true },
      }),
      this.prisma.clientAccount.findFirst({
        where: { email, deletedAt: null },
        select: { id: true },
      }),
    ]);
    return this.prisma.privacyRequest.create({
      data: {
        kind: input.kind,
        channel: input.channel,
        requesterName: input.requesterName.trim().slice(0, 200),
        requesterEmail: email,
        details: input.details.trim().slice(0, 5000),
        supportTicketId: input.supportTicketId ?? null,
        userId: user?.id ?? null,
        clientAccountId: client?.id ?? null,
        dueAt: new Date(now.getTime() + PRIVACY_DEADLINE_DAYS * DAY),
        createdById: actor.id || null,
        createdByEmail: actor.email,
      },
    });
  }

  async list(filter: { status?: string | null; overdue?: boolean | null }, now = new Date()) {
    return this.prisma.privacyRequest.findMany({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.overdue ? { status: { in: ['open', 'in_progress'] }, dueAt: { lt: now } } : {}),
      },
      // Os que vencem antes primeiro
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      take: 200,
    });
  }

  /** Muda o andamento; concluir ou recusar exige a resposta dada ao titular */
  async update(
    id: number,
    input: { status: string; response?: string | null },
    actor: StaffActor,
    now = new Date(),
  ) {
    if (!(PRIVACY_STATUSES as readonly string[]).includes(input.status)) {
      throw new BadRequestException('Situação inválida');
    }
    const row = await this.prisma.privacyRequest.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Pedido não encontrado');
    if (row.status === 'done' || row.status === 'rejected') {
      throw new BadRequestException('Este pedido já foi encerrado');
    }
    const closing = input.status === 'done' || input.status === 'rejected';
    const response = input.response?.trim() || null;
    if (closing && !response) {
      throw new BadRequestException('Registre a resposta dada ao titular');
    }
    return this.prisma.privacyRequest.update({
      where: { id },
      data: {
        status: input.status,
        response: response?.slice(0, 5000) ?? row.response,
        ...(closing
          ? { resolvedAt: now, resolvedById: actor.id || null, resolvedByEmail: actor.email }
          : {}),
      },
    });
  }
}
