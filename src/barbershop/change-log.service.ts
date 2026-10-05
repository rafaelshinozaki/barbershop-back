import { ForbiddenException, Injectable } from '@nestjs/common';
import type { ChangeLog, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';
import { toChangeFields, type ChangeField } from './change-log';

export { toChangeFields, type ChangeField };

export type ChangeLogFilters = {
  entityType?: string | null;
  actorId?: number | null;
  from?: Date | null;
  to?: Date | null;
  limit?: number | null;
  offset?: number | null;
};

/** Quem fez, como o dono vê: a equipe da plataforma aparece sem o nome */
export type ActorKind = 'user' | 'client' | 'platform' | 'system';

export type ChangeLogEntry = {
  id: number;
  createdAt: Date;
  entityType: string;
  entityId: string;
  entityName: string | null;
  action: string;
  changes: ChangeField[];
  actorKind: ActorKind;
  actorId: number | null;
  actorName: string | null;
  reason: string | null;
};

const MAX_LIMIT = 100;

/** O que o profissional vê no histórico: o que é da agenda dele */
export const OWN_AGENDA_ENTITIES = ['Appointment', 'BarberSchedule', 'BarberTimeOff', 'Barber'];

/**
 * Como o dono vê quem fez: a equipe da plataforma vira "Equipe da
 * plataforma" com o motivo, sem o nome do funcionário (decisão de
 * 2026-09-29; o nome fica no registro interno).
 */
export function presentActor(
  row: Pick<ChangeLog, 'actorType' | 'origin' | 'actorId' | 'actorName' | 'reason'>,
): {
  actorKind: ActorKind;
  actorId: number | null;
  actorName: string | null;
  reason: string | null;
} {
  if (row.actorType === 'staff' || row.origin === 'backoffice') {
    return { actorKind: 'platform', actorId: null, actorName: null, reason: row.reason };
  }
  if (row.actorType === 'user' || row.actorType === 'client') {
    return {
      actorKind: row.actorType,
      actorId: row.actorId,
      actorName: row.actorName,
      reason: null,
    };
  }
  return { actorKind: 'system', actorId: null, actorName: null, reason: null };
}

/**
 * Histórico de alterações da unidade (tela Histórico): o que o gatilho do
 * banco gravou para a unidade e para a rede dela (clientes e dados da rede).
 * Dono e gerente veem tudo; o profissional (barbeiro e básico), só a própria
 * agenda: agendamentos, escala, folgas e o próprio cadastro. A recepção não vê.
 */
@Injectable()
export class ChangeLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly barbershops: BarbershopService,
  ) {}

  /** Que linhas a pessoa pode ver nesta unidade */
  private async scope(userId: number, barbershopId: number): Promise<Prisma.ChangeLogWhereInput> {
    const shop = await this.barbershops.ensureAccess(userId, barbershopId, 'basic');
    if (shop.accessLevel === 'owner' || shop.accessLevel === 'manager') {
      return { OR: [{ barbershopId }, { barbershopId: null, networkId: shop.networkId }] };
    }
    const own = await this.barbershops.ownAgendaBarberId(userId, shop);
    if (own === null) {
      throw new ForbiddenException('Seu cargo nesta unidade não permite essa ação.');
    }
    return {
      barbershopId,
      barberIds: { has: own },
      entityType: { in: OWN_AGENDA_ENTITIES },
    };
  }

  async list(userId: number, barbershopId: number, filters: ChangeLogFilters = {}) {
    const scope = await this.scope(userId, barbershopId);
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), MAX_LIMIT);
    const where: Prisma.ChangeLogWhereInput = {
      AND: [scope],
      ...(filters.entityType ? { entityType: filters.entityType } : {}),
      ...(filters.actorId
        ? { actorId: filters.actorId, actorType: { in: ['user', 'client'] } }
        : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lt: filters.to } : {}),
            },
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.changeLog.count({ where }),
      this.prisma.changeLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: Math.max(filters.offset ?? 0, 0),
      }),
    ]);
    const items = await this.enrich(rows);
    return { total, items };
  }

  /** Quem aparece no histórico da unidade (filtro "pessoa"), sem a equipe da plataforma */
  async actors(userId: number, barbershopId: number) {
    const scope = await this.scope(userId, barbershopId);
    const rows = await this.prisma.changeLog.groupBy({
      by: ['actorId', 'actorName', 'actorType'],
      where: {
        AND: [scope],
        actorType: { in: ['user', 'client'] },
        actorId: { not: null },
      },
      _max: { createdAt: true },
    });
    const byId = new Map<number, { id: number; name: string | null; kind: string }>();
    for (const r of rows) {
      if (r.actorId == null || byId.has(r.actorId)) continue;
      byId.set(r.actorId, { id: r.actorId, name: r.actorName, kind: r.actorType });
    }
    return [...byId.values()].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  }

  /**
   * Nome legível onde o gatilho só tem id: agendamento vira "cliente —
   * data", e profissional/cliente trocados aparecem pelo nome.
   */
  private async enrich(rows: ChangeLog[]): Promise<ChangeLogEntry[]> {
    const entries = rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      entityType: row.entityType,
      entityId: row.entityId,
      entityName: row.entityName,
      action: row.action,
      changes: toChangeFields(row.changes),
      ...presentActor(row),
    }));

    const appointmentIds = entries
      .filter((e) => e.entityType === 'Appointment')
      .map((e) => Number(e.entityId))
      .filter(Number.isInteger);
    const barberIds = new Set<number>();
    const customerIds = new Set<number>();
    for (const e of entries) {
      if (e.entityType !== 'Appointment') continue;
      for (const c of e.changes) {
        const ids =
          c.field === 'barberId' ? barberIds : c.field === 'customerId' ? customerIds : null;
        if (!ids) continue;
        for (const v of [c.before, c.after]) if (v && /^\d+$/.test(v)) ids.add(Number(v));
      }
    }
    type Named = { id: number; name: string };
    const none = <T>(): Promise<T[]> => Promise.resolve([]);
    const [appointments, barbers, customers] = await Promise.all([
      appointmentIds.length
        ? this.prisma.appointment.findMany({
            where: { id: { in: appointmentIds } },
            select: { id: true, customer: { select: { name: true } } },
          })
        : none<{ id: number; customer: { name: string } | null }>(),
      barberIds.size
        ? this.prisma.barber.findMany({
            where: { id: { in: [...barberIds] } },
            select: { id: true, name: true },
          })
        : none<Named>(),
      customerIds.size
        ? this.prisma.customer.findMany({
            where: { id: { in: [...customerIds] } },
            select: { id: true, name: true },
          })
        : none<Named>(),
    ]);
    const customerOfAppointment = new Map(
      appointments.map((a) => [String(a.id), a.customer?.name ?? null]),
    );
    const barberName = new Map(barbers.map((b) => [String(b.id), b.name]));
    const customerName = new Map(customers.map((c) => [String(c.id), c.name]));

    return entries.map((e) => {
      if (e.entityType !== 'Appointment') return e;
      return {
        ...e,
        entityName: e.entityName ?? customerOfAppointment.get(e.entityId) ?? null,
        changes: e.changes.map((c) => {
          const names =
            c.field === 'barberId' ? barberName : c.field === 'customerId' ? customerName : null;
          if (!names) return c;
          return {
            ...c,
            before: c.before ? names.get(c.before) ?? c.before : null,
            after: c.after ? names.get(c.after) ?? c.after : null,
          };
        }),
      };
    });
  }
}
