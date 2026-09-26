/** Preço provisório do Pro, no meio da faixa R$ 39–59 do roadmap. Trocar aqui quando o mercado fechar. */
export const PRO_PRICE_CENTS = 4900;

/** Meses de Pro que cada lado ganha quando a indicação é aceita. */
export const PRO_REFERRAL_MONTHS = 1;

export function proPriceLabel(cents = PRO_PRICE_CENTS) {
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
