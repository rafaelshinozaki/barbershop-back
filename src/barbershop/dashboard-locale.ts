import { safeTimeZone } from '../common/timezone.util';

export type ShopLocale = {
  id: number;
  timezone: string | null;
  currency: string | null;
};

/** Unidades que compartilham fuso e moeda entram na mesma soma. */
export type LocaleGroup = {
  timeZone: string;
  currency: string;
  ids: number[];
};

export function localeGroups(shops: ShopLocale[]): LocaleGroup[] {
  const map = new Map<string, LocaleGroup>();
  for (const shop of shops) {
    const timeZone = safeTimeZone(shop.timezone);
    const currency = shop.currency?.trim() || 'BRL';
    const key = `${timeZone}\0${currency}`;
    const group = map.get(key);
    if (group) group.ids.push(shop.id);
    else map.set(key, { timeZone, currency, ids: [shop.id] });
  }
  return [...map.values()];
}

export function moneyByCurrency(rows: Array<{ currency: string; amount: number }>) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.amount);
  }
  return [...totals.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}
