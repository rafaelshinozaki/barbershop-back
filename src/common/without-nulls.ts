/**
 * Tira os campos null de um input do GraphQL. Campo opcional pode chegar como
 * null do cliente; no Prisma, null em coluna obrigatória quebra, e em update
 * apagaria o valor. Sem o campo, o Prisma não mexe nele.
 */
export type WithoutNulls<T> = { [K in keyof T]: Exclude<T[K], null> };

export function withoutNulls<T extends object>(input: T): WithoutNulls<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== null),
  ) as WithoutNulls<T>;
}
