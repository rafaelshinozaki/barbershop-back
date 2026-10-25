/**
 * O e-mail que o Google (ou a Apple) diz não ter verificado não identifica
 * ninguém: com ele, quem controla a conta do provedor entraria na conta de
 * outra pessoa com esse e-mail (item 271).
 */
export function emailUnverified(flag: unknown): boolean {
  return flag === false || flag === 'false';
}

/** E-mail verificado do perfil do Google: emails[0].verified ou email_verified */
export function googleEmailUnverified(profile: {
  emails?: Array<{ verified?: boolean | string }>;
  _json?: { email_verified?: boolean | string };
}): boolean {
  return (
    emailUnverified(profile.emails?.[0]?.verified) || emailUnverified(profile._json?.email_verified)
  );
}

export const UNVERIFIED_EMAIL_ERROR = 'E-mail não verificado pelo provedor';
