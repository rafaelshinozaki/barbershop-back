import { randomUUID } from 'crypto';
import * as Sentry from '@sentry/nestjs';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Só o formato de um id (uuid, ulid…): o cabeçalho vem de fora, não entra texto livre */
const VALID = /^[A-Za-z0-9._:-]{8,100}$/;

type Req = { headers?: Record<string, string | string[] | undefined>; requestId?: string };
type Res = { setHeader(name: string, value: string): unknown };

/** O id que o front (ou a API do backoffice) mandou, se tiver formato de id; senão, um novo */
export function pickRequestId(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value && VALID.test(value) ? value : randomUUID();
}

/**
 * Id do request de ponta a ponta: o front gera, a API do backoffice repassa,
 * este back devolve no cabeçalho e marca no Sentry, na trilha do Axiom e no
 * registro de ações. "A tela deu erro às 14:32" leva a tudo daquele request.
 */
export function requestIdMiddleware(req: Req, res: Res, next: () => void): void {
  const id = pickRequestId(req.headers?.[REQUEST_ID_HEADER]);
  req.requestId = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  if (Sentry.getClient()) Sentry.getIsolationScope().setTag('request_id', id);
  next();
}

export const requestIdOf = (req: Req | undefined): string | undefined => req?.requestId;
