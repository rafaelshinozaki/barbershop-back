import type { Prisma } from '@prisma/client';

/** Um campo alterado, como texto (a tela formata pelo nome do campo) */
export type ChangeField = { field: string; before: string | null; after: string | null };

/** Valor guardado (JSON) como texto pra tela formatar pelo campo */
function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  return String(value);
}

export function toChangeFields(changes: Prisma.JsonValue): ChangeField[] {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return [];
  return Object.entries(changes as Record<string, unknown>).map(([field, pair]) => {
    const [before, after] = Array.isArray(pair) ? pair : [null, null];
    return { field, before: asText(before), after: asText(after) };
  });
}
