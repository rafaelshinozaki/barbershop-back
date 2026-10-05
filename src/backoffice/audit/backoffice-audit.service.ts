import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toChangeFields, type ChangeField } from '../../barbershop/change-log';

/** Chaves com segredo: o valor não vai pro registro. */
const SECRET_KEY = /pass|token|secret|cvc|cvv|cardnumber|otp/i;
const MAX_STRING = 300;
const MAX_ITEMS = 20;
const MAX_DEPTH = 4;
const MAX_JSON = 4000;

/**
 * Cópia dos dados da operação pro registro: sem senha/token/código, textos e
 * listas cortados (importar 5 mil usuários não vira um registro gigante).
 */
export function sanitizeAuditArgs(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}… (${value.length})` : value;
  }
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return '…';
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((v) => sanitizeAuditArgs(v, depth + 1));
    return value.length > MAX_ITEMS ? [...items, `… +${value.length - MAX_ITEMS}`] : items;
  }
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY.test(key) ? '[oculto]' : sanitizeAuditArgs(v, depth + 1);
  }
  return out;
}

export interface AuditEntry {
  actorId?: number | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  operation: string;
  area?: string | null;
  args?: unknown;
  success: boolean;
  error?: string | null;
  /** Mesmo id do Sentry e da trilha: liga a ação ao que aconteceu no request */
  requestId?: string | null;
}

export interface AuditFilters {
  actorId?: number | null;
  operation?: string | null;
  limit?: number | null;
  offset?: number | null;
}

@Injectable()
export class BackofficeAuditService {
  private readonly logger = new Logger(BackofficeAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry) {
    let args = sanitizeAuditArgs(entry.args ?? null);
    if (args !== null && JSON.stringify(args).length > MAX_JSON) {
      args = { cortado: true, parte: JSON.stringify(args).slice(0, MAX_JSON) };
    }
    try {
      await this.prisma.backofficeAuditLog.create({
        data: {
          actorId: entry.actorId ?? null,
          actorEmail: entry.actorEmail ?? '',
          actorRole: entry.actorRole ?? '',
          operation: entry.operation.slice(0, 200),
          area: entry.area ?? null,
          args: args === null ? Prisma.JsonNull : (args as Prisma.InputJsonValue),
          success: entry.success,
          error: entry.error ? entry.error.slice(0, 500) : null,
          requestId: entry.requestId ?? null,
        },
      });
    } catch (error) {
      // Registro que falha não derruba a operação, mas aparece no log
      this.logger.error(`Registro de ação não gravado (${entry.operation}): ${error}`);
    }
  }

  async list(filters: AuditFilters = {}) {
    const where: Prisma.BackofficeAuditLogWhereInput = {
      ...(filters.actorId ? { actorId: filters.actorId } : {}),
      ...(filters.operation?.trim()
        ? { operation: { contains: filters.operation.trim(), mode: 'insensitive' } }
        : {}),
    };
    const take = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const skip = Math.max(filters.offset ?? 0, 0);
    const [total, items] = await Promise.all([
      this.prisma.backofficeAuditLog.count({ where }),
      this.prisma.backofficeAuditLog.findMany({
        where,
        orderBy: { id: 'desc' },
        take,
        skip,
      }),
    ]);
    const changes = await this.changesOf(items.map((i) => i.requestId));
    return {
      total,
      items: items.map((i) => ({
        ...i,
        args: i.args === null ? null : JSON.stringify(i.args),
        changes: (i.requestId && changes.get(i.requestId)) || [],
      })),
    };
  }

  /**
   * O que cada ação mudou de fato: as linhas do histórico de alterações
   * gravadas no mesmo request (mesmo id), com a unidade afetada.
   */
  private async changesOf(requestIds: (string | null)[]): Promise<Map<string, AuditChange[]>> {
    const ids = [...new Set(requestIds.filter((id): id is string => !!id))];
    const byRequest = new Map<string, AuditChange[]>();
    if (!ids.length) return byRequest;
    const rows = await this.prisma.changeLog.findMany({
      where: { requestId: { in: ids } },
      orderBy: { id: 'asc' },
      take: 1000,
    });
    const shopIds = [
      ...new Set(rows.map((r) => r.barbershopId).filter((id): id is number => id != null)),
    ];
    const shops = shopIds.length
      ? await this.prisma.barbershop.findMany({
          where: { id: { in: shopIds } },
          select: { id: true, name: true },
        })
      : [];
    const shopName = new Map(shops.map((s) => [s.id, s.name]));
    for (const r of rows) {
      if (!r.requestId) continue;
      const list = byRequest.get(r.requestId) ?? [];
      list.push({
        entityType: r.entityType,
        entityId: r.entityId,
        entityName: r.entityName,
        action: r.action,
        barbershopId: r.barbershopId,
        barbershopName: r.barbershopId != null ? shopName.get(r.barbershopId) ?? null : null,
        fields: toChangeFields(r.changes),
      });
      byRequest.set(r.requestId, list);
    }
    return byRequest;
  }
}

export type AuditChange = {
  entityType: string;
  entityId: string;
  entityName: string | null;
  action: string;
  barbershopId: number | null;
  barbershopName: string | null;
  fields: ChangeField[];
};
