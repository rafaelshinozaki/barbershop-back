import { UnauthorizedException } from '@nestjs/common';

type SocialLink = { providerUserId: string | null };

/**
 * Vínculo do login social. O id da pessoa no provedor vale primeiro. O
 * e-mail só casa com vínculo antigo, sem id. Vínculo com outro id é de
 * outra pessoa: não entra por ele (item 293).
 */
export function pickSocialLink<T extends SocialLink>(
  byId: T | null,
  byEmail: T | null,
  providerUserId?: string | null,
): T | null {
  if (byId) return byId;
  if (!byEmail) return null;
  if (byEmail.providerUserId && providerUserId && byEmail.providerUserId !== providerUserId) {
    throw new UnauthorizedException(
      'Este e-mail já está ligado a outra pessoa neste provedor. Entre com a senha.',
    );
  }
  return byEmail;
}
