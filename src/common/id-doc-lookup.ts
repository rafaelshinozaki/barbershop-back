import { Prisma } from '@prisma/client';
import { idDocLookupDigits } from './id-doc';

type Db = { $queryRaw: Prisma.TransactionClient['$queryRaw'] } & {
  user: Prisma.TransactionClient['user'];
};

const BRAZIL = ['br', 'bra', 'brasil', 'brazil'];

/** Os nomes do mesmo país como podem estar gravados no endereço ("BR", "Brasil"...) */
export function countryAliases(country?: string | null): string[] {
  const c = (country ?? '').trim().toLowerCase();
  if (!c) return [];
  return BRAZIL.includes(c) ? BRAZIL : [c];
}

/**
 * Já existe conta local com este documento? Compara pelos dígitos (CPF com ou
 * sem máscara é o mesmo). Com país, vale o mesmo país do endereço — ou conta
 * sem endereço (não dá pra dizer que é de outro país).
 */
export async function idDocTaken(
  db: Db,
  documentNumber: string,
  country?: string | null,
  exceptUserId?: number,
): Promise<boolean> {
  const aliases = countryAliases(country);
  const digits = idDocLookupDigits(documentNumber);
  const except = exceptUserId != null ? Prisma.sql`AND u.id <> ${exceptUserId}` : Prisma.empty;
  if (digits) {
    const countrySql = aliases.length
      ? Prisma.sql`AND (a.id IS NULL OR lower(btrim(COALESCE(a.country, ''))) IN (${Prisma.join(
          aliases,
        )}))`
      : Prisma.empty;
    const rows = await db.$queryRaw<{ id: number }[]>`
      SELECT u.id
      FROM "User" u
      LEFT JOIN "Address" a ON a."userId" = u.id
      WHERE u.provider = 'local'
        AND regexp_replace(COALESCE(u."idDocNumber", ''), '\\D', '', 'g') = ${digits}
        ${except}
        ${countrySql}
      LIMIT 1
    `;
    return rows.length > 0;
  }
  const existing = await db.user.findFirst({
    where: {
      provider: 'local',
      idDocNumber: { equals: documentNumber.trim(), mode: 'insensitive' },
      ...(exceptUserId != null ? { id: { not: exceptUserId } } : {}),
      ...(aliases.length
        ? {
            OR: [
              { address: { is: null } },
              { address: { is: { country: { in: aliases, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    },
    select: { id: true },
  });
  return !!existing;
}
