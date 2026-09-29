import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

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
    return {
      total,
      items: items.map((i) => ({
        ...i,
        args: i.args === null ? null : JSON.stringify(i.args),
      })),
    };
  }
}
