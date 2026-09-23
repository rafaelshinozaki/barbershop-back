// Origens liberadas pro front — usadas pelo CORS (main.ts) e pela conexão
// WebSocket das subscriptions (app.module.ts). No WebSocket a checagem é
// ainda mais importante: o navegador não aplica CORS ao handshake, e a
// autenticação é por cookie — sem checar a Origin, qualquer site poderia
// abrir o socket com o cookie do usuário e ler os eventos dele.
const STATIC_ORIGINS = [
  'http://localhost:5173', // front em dev
  'http://localhost:3020', // front em dev
  'http://localhost:5000', // front em dev
  'http://localhost:5174', // front em dev (porta alternativa)
  'http://localhost:5175', // front em dev (porta alternativa)
  'http://localhost:5176', // front em dev (porta alternativa)
  'http://localhost:5177', // front em dev (porta alternativa)
  'http://localhost:5178', // front em dev (porta alternativa)
  'https://barbershop-front-ten.vercel.app', // domínio Vercel (produção)
  'https://barbershop.zeero.dev.br', // domínio de produção
  'https://zeero.dev.br', // domínio alternativo
];

export function corsOriginList(frontendUrl?: string): string[] {
  return [frontendUrl || 'http://localhost:5173', ...STATIC_ORIGINS];
}

// Subdomínio próprio de barbearia (ex.: barbeariavintage.<domínio da
// plataforma>, ou barbeariavintage.localhost em dev) não cabe numa lista
// fixa — libera qualquer host terminando em ".localhost" ou em
// ".${tenantRootDomain}" quando configurado.
export function isTenantSubdomainOrigin(origin: string, tenantRootDomain?: string): boolean {
  try {
    const hostname = new URL(origin).hostname;
    if (hostname.endsWith('.localhost')) return true;
    if (tenantRootDomain && hostname.endsWith(`.${tenantRootDomain}`)) return true;
    return false;
  } catch {
    return false;
  }
}

export function isAllowedOrigin(
  origin: string,
  frontendUrl?: string,
  tenantRootDomain?: string,
): boolean {
  return (
    corsOriginList(frontendUrl).includes(origin) ||
    isTenantSubdomainOrigin(origin, tenantRootDomain)
  );
}
