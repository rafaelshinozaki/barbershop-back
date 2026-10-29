/** Texto de busca sem os curingas do LIKE (% _ \). Vazio não casa com ninguém. */
export function literalSearch(raw: string | null | undefined): string {
  return (raw ?? '').replace(/[%_\\]/g, '').trim();
}
