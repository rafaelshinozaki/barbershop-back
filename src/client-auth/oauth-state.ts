import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';

/**
 * `state` do login social do cliente (Google, Facebook, Apple). Sem ele, um
 * link de retorno do provedor montado por outra pessoa (com o código da
 * conta Google dela) ligava essa conta à de quem estivesse logado — e depois
 * ela entrava na conta da vítima. Na ida, um valor aleatório vai pro provedor
 * e num cookie curto; na volta, os dois têm que bater.
 */
export const OAUTH_STATE_COOKIE = 'ClientOAuthState';
const COOKIE_PATH = '/client-auth';

const isCallback = (req: Request) => /\/redirect\/?$/.test(req.path);

const cookieOptions = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProduction,
    // A Apple volta com um POST de outro site: só SameSite=None leva o cookie
    sameSite: (isProduction ? 'none' : 'lax') as 'none' | 'lax',
    path: COOKIE_PATH,
  };
};

/** Opções do passport: na ida, gera o state e guarda no cookie */
export function oauthStateOptions(context: ExecutionContext): { state?: string } {
  const req = context.switchToHttp().getRequest<Request>();
  if (isCallback(req)) return {};
  const res = context.switchToHttp().getResponse<Response>();
  const state = randomBytes(24).toString('base64url');
  res.cookie(OAUTH_STATE_COOKIE, state, { ...cookieOptions(), maxAge: 10 * 60_000 });
  return { state };
}

/** Na volta: o state do provedor tem que ser o do cookie (e vale uma vez) */
export function assertOAuthState(context: ExecutionContext) {
  const req = context.switchToHttp().getRequest<Request>();
  if (!isCallback(req)) return;
  const res = context.switchToHttp().getResponse<Response>();
  const sent = String(req.query?.state ?? req.body?.state ?? '');
  const expected = String(req.cookies?.[OAUTH_STATE_COOKIE] ?? '');
  res.clearCookie(OAUTH_STATE_COOKIE, cookieOptions());
  const ok =
    !!sent &&
    sent.length === expected.length &&
    timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
  if (!ok) throw new ForbiddenException('Login social expirou ou não começou aqui. Tente de novo.');
}
