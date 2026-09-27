import { toZonedParts } from '../common/timezone.util';
import { DEFAULT_WORKING_HOURS, parseBusinessHours, WEEKDAY_KEYS } from './working-hours';

/**
 * Busca pública por localização: distância, raio, "aberto agora" e ordem.
 * Sem PostGIS: um retângulo em volta do ponto (latitude/longitude com
 * índice) corta os candidatos no banco e a distância exata sai daqui.
 */

export const DEFAULT_RADIUS_KM = 25;
export const MAX_RADIUS_KM = 200;
const EARTH_KM = 6371;
const KM_PER_DEGREE = 111.32;

export type SearchSort = 'relevance' | 'distance' | 'rating' | 'price';
export const SEARCH_SORTS: SearchSort[] = ['relevance', 'distance', 'rating', 'price'];

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return EARTH_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Raio pedido dentro do permitido (sem raio = o padrão) */
export function clampRadius(radiusKm?: number | null): number {
  if (radiusKm == null || !Number.isFinite(radiusKm) || radiusKm <= 0) return DEFAULT_RADIUS_KM;
  return Math.min(radiusKm, MAX_RADIUS_KM);
}

/** Retângulo que contém o círculo (perto dos polos, a longitude toda) */
export function boundingBox(lat: number, lng: number, radiusKm: number) {
  const dLat = radiusKm / KM_PER_DEGREE;
  const cos = Math.cos((lat * Math.PI) / 180);
  const dLng = cos > 0.01 ? radiusKm / (KM_PER_DEGREE * cos) : 180;
  return {
    minLat: Math.max(-90, lat - dLat),
    maxLat: Math.min(90, lat + dLat),
    minLng: dLng >= 180 ? -180 : lng - dLng,
    maxLng: dLng >= 180 ? 180 : lng + dLng,
  };
}

/** Longitude no retângulo, inclusive quando ele cruza o antimeridiano (±180) */
export function lngInBox(lng: number, box: { minLng: number; maxLng: number }): boolean {
  if (box.minLng < -180) return lng >= box.minLng + 360 || lng <= box.maxLng;
  if (box.maxLng > 180) return lng >= box.minLng || lng <= box.maxLng - 360;
  return lng >= box.minLng && lng <= box.maxLng;
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/**
 * Aberta agora, no fuso da unidade: fechamento/horário especial do dia vale
 * por cima do horário da semana (o da unidade ou o padrão).
 */
export function isOpenAt(
  shop: {
    businessHours?: string | null;
    timezone: string;
    closures?: Array<{ date: string; openTime: string | null; closeTime: string | null }>;
  },
  now = new Date(),
): boolean {
  const { dateStr, dayOfWeek, minutesOfDay } = toZonedParts(now, shop.timezone);
  const closure = shop.closures?.find((c) => c.date === dateStr);
  let hours: { start: string; end: string } | null;
  if (closure) {
    hours =
      closure.openTime && closure.closeTime
        ? { start: closure.openTime, end: closure.closeTime }
        : null;
  } else {
    const week =
      parseBusinessHours(shop.businessHours) ??
      WEEKDAY_KEYS.map((_, i) => DEFAULT_WORKING_HOURS[i]);
    hours = week[dayOfWeek];
  }
  if (!hours) return false;
  return minutesOfDay >= toMinutes(hours.start) && minutesOfDay < toMinutes(hours.end);
}

type Rankable = {
  name: string;
  isFeatured?: boolean;
  distanceKm: number | null;
  averageRating: number | null;
  reviewCount: number;
  minPrice?: number | null;
};

const nullsLast = (a: number | null | undefined, b: number | null | undefined, dir: 1 | -1) => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return (a - b) * dir;
};

/**
 * Ordem da busca. O destaque pago vem primeiro na ordem "relevância" (a
 * padrão); nas ordens escolhidas pelo cliente (distância, nota, preço) vale
 * só o critério escolhido. Relevância: mais perto primeiro quando há ponto;
 * sem ponto, a nota (com peso pela quantidade de avaliações) e o nome.
 */
export function rankResults<T extends Rankable>(
  items: T[],
  sort: SearchSort,
  hasPoint: boolean,
): T[] {
  const score = (r: T) =>
    r.averageRating == null ? 0 : r.averageRating * (1 - 1 / Math.sqrt(r.reviewCount + 1));
  const byName = (a: T, b: T) => a.name.localeCompare(b.name);
  const compare: Record<SearchSort, (a: T, b: T) => number> = {
    distance: (a, b) => nullsLast(a.distanceKm, b.distanceKm, 1) || byName(a, b),
    rating: (a, b) =>
      nullsLast(a.averageRating, b.averageRating, -1) ||
      b.reviewCount - a.reviewCount ||
      byName(a, b),
    price: (a, b) => nullsLast(a.minPrice, b.minPrice, 1) || byName(a, b),
    relevance: (a, b) =>
      (hasPoint ? nullsLast(a.distanceKm, b.distanceKm, 1) : score(b) - score(a)) || byName(a, b),
  };
  return [...items].sort((a, b) => {
    if (sort === 'relevance' && !!a.isFeatured !== !!b.isFeatured) return a.isFeatured ? -1 : 1;
    return compare[sort](a, b);
  });
}
