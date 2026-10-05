/**
 * Qual sessão um token representa. Todos os JWTs do back são assinados com o
 * mesmo JWT_SECRET (sessão da equipe, sessão do cliente, state do OAuth das
 * redes sociais), então a assinatura sozinha não diz o tipo: um token só vale
 * como sessão da equipe com `userId` inteiro e `sessionToken`, e como sessão
 * do cliente com `clientAccountId` inteiro. Sem isso, o cookie do cliente (ou
 * o state do OAuth) passava como sessão da equipe e a busca do usuário com id
 * vazio caía no primeiro usuário do banco.
 */

const positiveInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;

export type StaffClaims = { userId: number; sessionToken: string };
export type ClientClaims = { clientAccountId: number; v: number };

export function staffClaims(decoded: unknown): StaffClaims | null {
  if (!decoded || typeof decoded !== 'object') return null;
  const d = decoded as Record<string, unknown>;
  if ('clientAccountId' in d) return null;
  if (!positiveInt(d.userId)) return null;
  if (typeof d.sessionToken !== 'string' || !d.sessionToken) return null;
  return { userId: d.userId, sessionToken: d.sessionToken };
}

export function clientClaims(decoded: unknown): ClientClaims | null {
  if (!decoded || typeof decoded !== 'object') return null;
  const d = decoded as Record<string, unknown>;
  if ('userId' in d) return null;
  if (!positiveInt(d.clientAccountId)) return null;
  return { clientAccountId: d.clientAccountId, v: Number.isInteger(d.v) ? (d.v as number) : 0 };
}

/**
 * Token da sessão da equipe: o cabeçalho Bearer ou o cookie `Authentication`
 * pelo nome exato (nada de procurar "Authentication=" no cabeçalho, que acha
 * o `ClientAuthentication`).
 */
export function staffSessionToken(req: {
  headers?: Record<string, unknown>;
  cookies?: Record<string, string | undefined>;
}): string | undefined {
  const header = req.headers?.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim() || undefined;
  }
  if (req.cookies) return req.cookies.Authentication || undefined;
  // WebSocket do GraphQL (assinaturas) não passa pelo cookie-parser: lê o
  // cabeçalho cru, pelo nome exato do cookie
  const raw = req.headers?.cookie;
  return typeof raw === 'string' ? cookieValue(raw, 'Authentication') : undefined;
}

/** Valor de um cookie pelo nome exato ("ClientAuthentication" não é "Authentication") */
export function cookieValue(header: string, name: string): string | undefined {
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(value) || undefined;
    } catch {
      return value || undefined;
    }
  }
  return undefined;
}
