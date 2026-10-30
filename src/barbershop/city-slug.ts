/** Cidade comparável: sem acento, sem caixa, espaços viram hífen. */
export function slugifyCity(city: string): string {
  return city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function citySlugsOf(cities: string[]): string[] {
  const out: string[] = [];
  for (const city of cities) {
    const slug = slugifyCity(city);
    if (slug && !out.includes(slug)) out.push(slug);
  }
  return out;
}
