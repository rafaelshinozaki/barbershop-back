/**
 * Selos (item 11 do roadmap), no estilo do Airbnb: aparecem porque o
 * histórico sustenta e somem quando deixa de sustentar. Não se compram.
 * Tudo aqui é calculado na hora, a partir do que já está no banco.
 */

/** Nota alta: média de pelo menos 4,8 em pelo menos 10 avaliações */
export const TOP_RATED = { minAverage: 4.8, minReviews: 10 };
/** Experiente (profissional): 100 atendimentos concluídos */
export const EXPERIENCED_MIN = 100;
/** Clientes fiéis: metade volta, com pelo menos 20 clientes diferentes */
export const LOYAL = { minShare: 0.5, minClients: 20 };
/** Unidade procurada: 500 atendimentos concluídos */
export const POPULAR_MIN = 500;
/** Cliente que comparece: 95% com pelo menos 5 atendimentos concluídos */
export const RELIABLE = { minRate: 95, minCompleted: 5 };
/** Cliente pontual: média de pontualidade de pelo menos 4,5 em 3 avaliações */
export const PUNCTUAL = { minAverage: 4.5, minRatings: 3 };

export type ProfessionalBadge = 'top_rated' | 'experienced' | 'loyal_clients';
export type UnitBadge = 'top_rated' | 'popular';
export type ClientBadge = 'reliable' | 'punctual';

const topRated = (average: number | null | undefined, count: number) =>
  average != null && count >= TOP_RATED.minReviews && average >= TOP_RATED.minAverage;

export function professionalBadges(facts: {
  averageRating: number | null;
  reviewCount: number;
  completed: number;
  uniqueClients: number;
  returningClients: number;
}): ProfessionalBadge[] {
  const badges: ProfessionalBadge[] = [];
  if (topRated(facts.averageRating, facts.reviewCount)) badges.push('top_rated');
  if (facts.completed >= EXPERIENCED_MIN) badges.push('experienced');
  if (
    facts.uniqueClients >= LOYAL.minClients &&
    facts.returningClients / facts.uniqueClients >= LOYAL.minShare
  ) {
    badges.push('loyal_clients');
  }
  return badges;
}

export function unitBadges(facts: {
  averageRating: number | null;
  reviewCount: number;
  completed: number;
}): UnitBadge[] {
  const badges: UnitBadge[] = [];
  if (topRated(facts.averageRating, facts.reviewCount)) badges.push('top_rated');
  if (facts.completed >= POPULAR_MIN) badges.push('popular');
  return badges;
}

export function clientBadges(facts: {
  attendanceRate: number | null;
  completed: number;
  punctuality: number | null;
  ratingCount: number;
}): ClientBadge[] {
  const badges: ClientBadge[] = [];
  if (
    facts.attendanceRate != null &&
    facts.completed >= RELIABLE.minCompleted &&
    facts.attendanceRate >= RELIABLE.minRate
  ) {
    badges.push('reliable');
  }
  if (
    facts.punctuality != null &&
    facts.ratingCount >= PUNCTUAL.minRatings &&
    facts.punctuality >= PUNCTUAL.minAverage
  ) {
    badges.push('punctual');
  }
  return badges;
}
