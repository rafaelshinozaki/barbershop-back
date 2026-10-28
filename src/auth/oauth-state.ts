import { oauthState } from '../common/oauth-state';

/**
 * `state` do login social da equipe (item 483). Faltava aqui: a volta do
 * provedor com o código de outra pessoa ligava o Google dela à conta logada.
 */
const staff = oauthState('StaffOAuthState', '/auth');

export const STAFF_OAUTH_STATE_COOKIE = staff.cookieName;
export const staffOAuthStateOptions = staff.options;
export const assertStaffOAuthState = staff.assert;
