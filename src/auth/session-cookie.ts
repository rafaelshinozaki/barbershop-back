import type { Response } from 'express';
import type { JwtService } from '@nestjs/jwt';

/**
 * Duração da sessão do painel (dono/equipe):
 * - "Lembrar de mim": 30 dias, cookie que sobrevive a fechar o navegador;
 * - sem marcar: 12 horas, cookie de sessão (some ao fechar o navegador).
 * Nos dois casos a sessão se renova enquanto a pessoa usa o sistema
 * (renewIfStale), então quem usa todo dia não é deslogado no meio do uso.
 */
export const REMEMBER_TTL_SECONDS = 30 * 24 * 3600;
export const SESSION_TTL_SECONDS = 12 * 3600;
/** Renova o token quando ele já passou dessa idade (evita reemitir a cada pedido) */
const RENEW_AFTER_SECONDS = { remember: 24 * 3600, session: 3600 };

export type SessionPayload = {
  userId: number;
  email: string;
  sessionToken: string;
  /** "Lembrar de mim" marcado */
  remember?: boolean;
};

export function setAuthCookie(
  jwt: JwtService,
  res: Response,
  payload: SessionPayload,
  isProduction: boolean,
) {
  const remember = Boolean(payload.remember);
  const ttl = remember ? REMEMBER_TTL_SECONDS : SESSION_TTL_SECONDS;
  const token = jwt.sign(
    { userId: payload.userId, email: payload.email, sessionToken: payload.sessionToken, remember },
    { expiresIn: `${ttl}s` },
  );
  res.cookie('Authentication', token, {
    httpOnly: true,
    secure: isProduction, // true em produção (HTTPS)
    sameSite: isProduction ? 'none' : 'lax', // 'none' necessário pra front e API em domínios diferentes
    path: '/',
    // Sem "expires" o cookie é de sessão: o navegador apaga ao fechar
    ...(remember ? { expires: new Date(Date.now() + ttl * 1000) } : {}),
  });
  return token;
}

/** Token válido mas já "velho": emite outro igual, com prazo renovado */
export function renewIfStale(
  jwt: JwtService,
  res: Response | undefined,
  decoded: SessionPayload & { iat?: number },
  isProduction: boolean,
  now = Date.now(),
) {
  if (!res || !decoded.iat || !decoded.sessionToken) return false;
  const age = now / 1000 - decoded.iat;
  const limit = decoded.remember ? RENEW_AFTER_SECONDS.remember : RENEW_AFTER_SECONDS.session;
  if (age < limit) return false;
  setAuthCookie(jwt, res, decoded, isProduction);
  return true;
}
