import { randomBytes } from 'crypto';
import type { Response } from 'express';
import type { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Sessão da área do cliente (item 272). Antes o cookie valia JWT_EXPIRATION
 * (1 hora) sem renovar, e "Sair" só apagava o cookie: o token copiado seguia
 * entrando até vencer. Agora a sessão tem prazo próprio, se renova enquanto
 * a pessoa usa, e o token leva o id dela (`sid`): "Sair" apaga só esta.
 */
export const CLIENT_SESSION_TTL_SECONDS = 30 * 24 * 3600;
/** Renova o cookie quando o token passou dessa idade (não a cada pedido) */
const CLIENT_RENEW_AFTER_SECONDS = 24 * 3600;

type Db = Pick<PrismaService, 'clientSession'>;

export type ClientCookiePayload = {
  clientAccountId: number;
  email: string;
  v: number;
  sid: string;
};

function setClientCookie(
  jwt: JwtService,
  res: Response,
  payload: ClientCookiePayload,
  isProduction: boolean,
) {
  const token = jwt.sign(payload, { expiresIn: `${CLIENT_SESSION_TTL_SECONDS}s` });
  res.cookie('ClientAuthentication', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
    expires: new Date(Date.now() + CLIENT_SESSION_TTL_SECONDS * 1000),
  });
  return token;
}

/** Abre uma sessão nova e grava o cookie */
export async function openClientSession(
  db: Db,
  jwt: JwtService,
  res: Response,
  account: { id: number; email: string; sessionVersion: number },
  isProduction: boolean,
) {
  const sid = randomBytes(24).toString('base64url');
  await db.clientSession.create({ data: { sid, clientAccountId: account.id } });
  return setClientCookie(
    jwt,
    res,
    { clientAccountId: account.id, email: account.email, v: account.sessionVersion, sid },
    isProduction,
  );
}

/**
 * A sessão do token ainda existe? Token sem `sid` é de antes da tabela e vale
 * só até vencer (prazo antigo, de uma hora).
 */
export async function clientSessionAlive(
  db: Db,
  clientAccountId: number,
  sid: string | undefined,
): Promise<boolean> {
  if (!sid) return true;
  const session = await db.clientSession.findUnique({ where: { sid } });
  return !!session && session.clientAccountId === clientAccountId;
}

/** Em uso: com o token já "velho", emite outro igual e marca o uso */
export async function renewClientSessionIfStale(
  db: Db,
  jwt: JwtService,
  res: Response | undefined,
  decoded: Partial<ClientCookiePayload> & { iat?: number },
  isProduction: boolean,
  now = Date.now(),
) {
  if (!res || !decoded.iat || !decoded.sid || !decoded.clientAccountId) return false;
  if (now / 1000 - decoded.iat < CLIENT_RENEW_AFTER_SECONDS) return false;
  setClientCookie(
    jwt,
    res,
    {
      clientAccountId: decoded.clientAccountId,
      email: decoded.email ?? '',
      v: decoded.v ?? 0,
      sid: decoded.sid,
    },
    isProduction,
  );
  await db.clientSession.updateMany({
    where: { sid: decoded.sid },
    data: { lastUsedAt: new Date(now) },
  });
  return true;
}
