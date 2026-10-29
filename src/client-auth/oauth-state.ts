import { ExecutionContext } from '@nestjs/common';
import { oauthState } from '../common/oauth-state';

/** `state` do login social do cliente (ver common/oauth-state) */
const client = oauthState('ClientOAuthState', '/client-auth');

export const OAUTH_STATE_COOKIE = client.cookieName;
export const CLIENT_TERMS_COOKIE = 'ClientTermsAccepted';

/** Na ida, `?terms=1` guarda o aceite até o retorno do provedor. */
export function oauthStateOptions(context: ExecutionContext) {
  const options = client.options(context);
  const req = context.switchToHttp().getRequest();
  if (!/\/redirect\/?$/.test(req.path) && String(req.query?.terms ?? '') === '1') {
    const res = context.switchToHttp().getResponse();
    res.cookie(CLIENT_TERMS_COOKIE, '1', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/client-auth',
      maxAge: 10 * 60_000,
    });
  }
  return options;
}

export const assertOAuthState = client.assert;
