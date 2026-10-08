import { currentPricing } from '../pricing/pricing';

/** Preço do Pro: vem de "Preços e taxas" (padrão R$ 39,90, ver src/pricing/pricing.ts) */
export function proPriceCents() {
  return currentPricing().proPriceCents;
}

/** Meses de Pro que cada lado ganha quando a indicação é aceita. */
export const PRO_REFERRAL_MONTHS = 1;

/** Só quem criou a conta dentro desta janela pode usar um código. */
export const PRO_REFERRAL_NEW_ACCOUNT_DAYS = 30;

/** Meses de Pro que um indicador pode acumular com códigos aceitos. */
export const PRO_REFERRAL_MAX_MONTHS = 12;

export function isNewProAccount(createdAt: Date, now: Date) {
  const limit = createdAt.getTime() + PRO_REFERRAL_NEW_ACCOUNT_DAYS * 24 * 60 * 60 * 1000;
  return now.getTime() <= limit;
}

export function proPriceLabel(cents = proPriceCents()) {
  const amount = (cents / 100).toFixed(2).replace('.', ',');
  return `R$ ${amount}`;
}

export function isProActive(until: Date | null | undefined, now: Date) {
  return until != null && until.getTime() > now.getTime();
}

/** Empilha meses a partir de agora, ou do fim do Pro que já está valendo. */
export function extendProUntil(current: Date | null | undefined, months: number, now: Date) {
  const base = current && current.getTime() > now.getTime() ? current : now;
  const next = new Date(base.getTime());
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}
