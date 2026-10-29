/** Idade mínima para entrar na equipe. No Brasil o trabalho é a partir de 16; aprendiz (14) não é um cargo. */
export const WORK_MINIMUM_AGE = 16;

/** Anos completos, com dia e mês. Data inválida devolve null. */
export function completedYears(value: string, today = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const birth = new Date(year, month - 1, day);
  if (birth.getFullYear() !== year || birth.getMonth() !== month - 1 || birth.getDate() !== day) {
    return null;
  }
  let age = today.getFullYear() - year;
  const monthDiff = today.getMonth() - (month - 1);
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < day)) age -= 1;
  return age;
}

/** Anos completos a partir de uma data (coluna @db.Date vem à meia-noite UTC). */
export function ageInYears(birthdate: Date, today = new Date()): number | null {
  const y = birthdate.getUTCFullYear();
  const m = String(birthdate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(birthdate.getUTCDate()).padStart(2, '0');
  return completedYears(`${y}-${m}-${d}`, today);
}

/** Faixa do painel. Menor de 18 entra na própria faixa. */
export function ageBand(birthdate: Date | null | undefined, today = new Date()): string {
  if (!birthdate) return 'Não informado';
  const age = ageInYears(birthdate, today);
  if (age == null || age < 0) return 'Não informado';
  if (age < 18) return 'menos de 18';
  if (age <= 25) return '18-25';
  if (age <= 35) return '26-35';
  if (age <= 45) return '36-45';
  if (age <= 55) return '46-55';
  if (age <= 65) return '56-65';
  return '65+';
}

/** Nascimento que cai na faixa, pela data completa (não só o ano). */
export function birthdateFilterForBand(
  band: string,
  today = new Date(),
): { gt?: Date; lte?: Date } | null {
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();
  const on = (years: number) => new Date(Date.UTC(y - years, m, d));
  if (band === 'menos de 18') return { gt: on(18) };
  if (band === '65+') return { lte: on(65) };
  const match = /^(\d+)-(\d+)$/.exec(band);
  if (!match) return null;
  return { gt: on(Number(match[2]) + 1), lte: on(Number(match[1])) };
}
