import { oauthState } from '../common/oauth-state';

/** `state` do login social do cliente (ver common/oauth-state) */
const client = oauthState('ClientOAuthState', '/client-auth');

export const OAUTH_STATE_COOKIE = client.cookieName;
export const oauthStateOptions = client.options;
export const assertOAuthState = client.assert;
