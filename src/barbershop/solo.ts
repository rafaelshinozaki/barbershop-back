import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { monthRangeUtc, safeTimeZone, toZonedParts } from '../common/timezone.util';
import { isProActive } from './pro';

/** Atendimentos solo concluídos no mês, de graça, para sempre. */
export const SOLO_SERVICE_LIMIT = 30;

/** Unidades de produto vendidas no mês, na mesma regra da cota de atendimentos. */
export const SOLO_PRODUCT_LIMIT = 30;

export const SOLO_BLOCKED_MESSAGE =
  'Pelo segundo mês seguido você passou de 30 atendimentos por conta própria. Os que já estão marcados continuam. Novos ficam pausados neste mês.';

export const SOLO_PRODUCT_BLOCKED_MESSAGE =
  'Pelo segundo mês seguido você passou de 30 produtos vendidos por conta própria. Esta venda não entra.';

export const SOLO_STAFF_MESSAGE =
  'No modo por conta própria a agenda é de uma pessoa só. Com equipe, cadastre um estabelecimento.';

export type SoloDecision = {
  limit: number;
  completed: number;
  remaining: number;
  nearLimit: boolean;
  /** Primeiro mês seguido acima do teto: ainda dá para passar. */
  grace: boolean;
  /** Segundo mês seguido acima do teto: o que é novo para naquele mês. */
  blocked: boolean;
};

/**
 * A cota olha o que já foi concluído ou vendido, não o que está só marcado.
 * O primeiro mês acima do teto é tolerado. No mês seguinte, se passar de
 * novo, o que for novo naquele mês para.
 */
export function soloDecision(
  completedThisMonth: number,
  completedPreviousMonth: number,
  limit: number,
): SoloDecision {
  const over = completedThisMonth >= limit;
  const previousOver = completedPreviousMonth >= limit;
  const blocked = over && previousOver;
  const nearFrom = Math.ceil(limit * 0.8);
  return {
    limit,
    completed: completedThisMonth,
    remaining: Math.max(0, limit - completedThisMonth),
    nearLimit: completedThisMonth >= nearFrom && !over,
    grace: over && !blocked,
    blocked,
  };
}

type Db = PrismaService;

async function completedInRange(
  db: Db,
  ownerUserId: number,
  range: { start: Date; end: Date },
): Promise<number> {
  const shop = { practiceKind: 'solo', ownerUserId };
  const [appointments, walkIns] = await Promise.all([
    db.appointment.count({
      where: {
        status: 'COMPLETED',
        source: { not: 'HISTORY' },
        startAt: { gte: range.start, lt: range.end },
        barbershop: shop,
      },
    }),
    db.walkIn.count({
      where: {
        status: 'COMPLETED',
        barbershop: shop,
        OR: [
          { servedAt: { gte: range.start, lt: range.end } },
          { servedAt: null, createdAt: { gte: range.start, lt: range.end } },
        ],
      },
    }),
  ]);
  return appointments + walkIns;
}

async function productsInRange(
  db: Db,
  ownerUserId: number,
  range: { start: Date; end: Date },
): Promise<number> {
  const sum = await db.saleItem.aggregate({
    where: {
      itemType: 'PRODUCT',
      sale: {
        paymentStatus: { not: 'REFUNDED' },
        createdAt: { gte: range.start, lt: range.end },
        barbershop: { practiceKind: 'solo', ownerUserId },
      },
    },
    _sum: { quantity: true },
  });
  return sum._sum.quantity ?? 0;
}

export type SoloUsage = {
  services: SoloDecision;
  products: SoloDecision;
};

/** Uso das duas cotas no mês de calendário de `when`, no fuso da agenda. */
export async function soloUsage(db: Db, ownerUserId: number, timeZone: string, when: Date): Promise<SoloUsage> {
  const zone = safeTimeZone(timeZone);
  const [year, month] = toZonedParts(when, zone).dateStr.split('-').map(Number);
  const previous = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const currentRange = monthRangeUtc(year, month, zone);
  const previousRange = monthRangeUtc(previous.year, previous.month, zone);
  const [services, servicesBefore, products, productsBefore] = await Promise.all([
    completedInRange(db, ownerUserId, currentRange),
    completedInRange(db, ownerUserId, previousRange),
    productsInRange(db, ownerUserId, currentRange),
    productsInRange(db, ownerUserId, previousRange),
  ]);
  return {
    services: soloDecision(services, servicesBefore, SOLO_SERVICE_LIMIT),
    products: soloDecision(products, productsBefore, SOLO_PRODUCT_LIMIT),
  };
}

export function productUnits(
  items: Array<{ itemType?: string; productId?: number | null; quantity?: number }>,
): number {
  return items.reduce((sum, item) => {
    if (item.itemType === 'PRODUCT' || item.productId) return sum + Math.max(0, item.quantity ?? 0);
    return sum;
  }, 0);
}

/** Estabelecimento comum não entra na cota. Agenda solo, só quando o mês está fechado. */
export async function assertSoloBookingAllowed(db: Db, barbershopId: number, when: Date) {
  const shop = await db.barbershop.findUnique({
    where: { id: barbershopId },
    select: { practiceKind: true, ownerUserId: true, timezone: true },
  });
  if (!shop || shop.practiceKind !== 'solo' || shop.ownerUserId == null) return;
  if (await hasActivePro(db, shop.ownerUserId, when)) return;
  const usage = await soloUsage(db, shop.ownerUserId, shop.timezone, when);
  if (usage.services.blocked) throw new BadRequestException(SOLO_BLOCKED_MESSAGE);
}

/** Estabelecimento comum não entra. No solo, venda nova de produto para quando a cota do mês fechou. */
export async function assertSoloProductSaleAllowed(db: Db, barbershopId: number, when: Date, units: number) {
  if (units <= 0) return;
  const shop = await db.barbershop.findUnique({
    where: { id: barbershopId },
    select: { practiceKind: true, ownerUserId: true, timezone: true },
  });
  if (!shop || shop.practiceKind !== 'solo' || shop.ownerUserId == null) return;
  if (await hasActivePro(db, shop.ownerUserId, when)) return;
  const usage = await soloUsage(db, shop.ownerUserId, shop.timezone, when);
  if (usage.products.blocked) throw new BadRequestException(SOLO_PRODUCT_BLOCKED_MESSAGE);
}

async function hasActivePro(db: Db, userId: number, when: Date) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { proUntil: true } });
  return isProActive(user?.proUntil, when);
}

/** Sem segundo profissional, recepção ou gerente. */
export async function assertSoloSinglePerson(db: Db, barbershopId: number) {
  const shop = await db.barbershop.findUnique({
    where: { id: barbershopId },
    select: { practiceKind: true },
  });
  if (shop?.practiceKind === 'solo') throw new BadRequestException(SOLO_STAFF_MESSAGE);
}
