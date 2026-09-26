/** Panorama da carreira: junta o que a mesma pessoa fez em todas as unidades. */

export type CommissionRulePick = {
  barberId: number | null;
  barbershopId: number;
  itemType: string;
  percentage: number;
};

/** Regra do vínculo (serviço, senão tudo) e, se não houver, a padrão da unidade. */
export function pickCommissionPercent(
  rules: CommissionRulePick[],
  barberId: number,
  barbershopId: number,
): number | null {
  const pick = (list: CommissionRulePick[]) =>
    list.find((rule) => rule.itemType === 'SERVICE') ??
    list.find((rule) => rule.itemType === 'ALL');
  const own = pick(rules.filter((rule) => rule.barberId === barberId));
  const shop = pick(
    rules.filter((rule) => rule.barberId == null && rule.barbershopId === barbershopId),
  );
  const chosen = own ?? shop;
  return chosen ? chosen.percentage : null;
}

export type CareerPlaceInput = {
  barberId: number;
  shopId: number;
  shopName: string;
  staffType: string | null;
  active: boolean;
  startedAt: Date;
  endedAt: Date | null;
  commissionPercent: number | null;
};

export type CareerVisitInput = {
  customerId: number;
  status: string;
  hour: number;
  currency: string;
  services: { name: string; quantity: number; unitPrice: number }[];
};

export type CareerPayoutInput = {
  currency: string;
  total: number;
  commission: number;
  tips: number;
};

/** Da ficha antiga, só o primeiro nome. O resto não sai da unidade. */
export function firstNameOnly(name: string): string {
  const [first] = name.trim().split(/\s+/);
  return first ?? '';
}

export function slugifyName(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'profissional';
}

/** Atendimento numa unidade da qual a pessoa já saiu: sem sobrenome, contato ou id. */
export function visiblePastVisit(input: {
  shopName: string;
  occurredAt: Date;
  customerName: string;
}) {
  return {
    shopName: input.shopName,
    occurredAt: input.occurredAt,
    firstName: firstNameOnly(input.customerName),
  };
}

export type CareerOverview = {
  places: CareerPlaceInput[];
  completedAppointments: number;
  noShows: number;
  uniqueClients: number;
  returningClients: number;
  busiestHour: number | null;
  topServices: { name: string; count: number }[];
  byCurrency: {
    currency: string;
    revenue: number;
    paid: number;
    commission: number;
    tips: number;
  }[];
};

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Só atendimento concluído entra em faturamento, serviços, clientes e horário.
 * Falta conta à parte. Cancelado não entra.
 */
export function buildCareerOverview(input: {
  places: CareerPlaceInput[];
  visits: CareerVisitInput[];
  payouts: CareerPayoutInput[];
}): CareerOverview {
  const completed = input.visits.filter((visit) => visit.status === 'COMPLETED');
  const byCustomer = new Map<number, number>();
  const hours = new Map<number, number>();
  const services = new Map<string, number>();
  const moneyByCurrency = new Map<
    string,
    { revenue: number; paid: number; commission: number; tips: number }
  >();
  const bucket = (currency: string) => {
    const current = moneyByCurrency.get(currency) ?? {
      revenue: 0,
      paid: 0,
      commission: 0,
      tips: 0,
    };
    moneyByCurrency.set(currency, current);
    return current;
  };

  for (const visit of completed) {
    byCustomer.set(visit.customerId, (byCustomer.get(visit.customerId) ?? 0) + 1);
    hours.set(visit.hour, (hours.get(visit.hour) ?? 0) + 1);
    let revenue = 0;
    for (const service of visit.services) {
      const count = service.quantity > 0 ? service.quantity : 1;
      services.set(service.name, (services.get(service.name) ?? 0) + count);
      revenue += count * service.unitPrice;
    }
    bucket(visit.currency).revenue += revenue;
  }
  for (const payout of input.payouts) {
    const row = bucket(payout.currency);
    row.paid += payout.total;
    row.commission += payout.commission;
    row.tips += payout.tips;
  }

  let busiestHour: number | null = null;
  let busiestCount = 0;
  for (const [hour, count] of hours) {
    const earlierTie = count === busiestCount && (busiestHour == null || hour < busiestHour);
    if (count > busiestCount || earlierTie) {
      busiestHour = hour;
      busiestCount = count;
    }
  }

  return {
    places: [...input.places].sort(
      (a, b) =>
        Number(b.active) - Number(a.active) || b.startedAt.getTime() - a.startedAt.getTime(),
    ),
    completedAppointments: completed.length,
    noShows: input.visits.filter((visit) => visit.status === 'NO_SHOW').length,
    uniqueClients: byCustomer.size,
    returningClients: [...byCustomer.values()].filter((count) => count >= 2).length,
    busiestHour,
    topServices: [...services.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 5),
    byCurrency: [...moneyByCurrency.entries()]
      .map(([currency, row]) => ({
        currency,
        revenue: money(row.revenue),
        paid: money(row.paid),
        commission: money(row.commission),
        tips: money(row.tips),
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
  };
}
