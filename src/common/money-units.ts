// A Stripe recebe valores na menor unidade da moeda. Na maioria é o
// centavo (valor × 100), mas nas moedas sem centavos o valor vai inteiro:
// ¥1.000 é 1000, não 100000. A moeda da unidade vem do país no cadastro,
// então Japão, Coreia, Chile, Paraguai, Vietnã etc. entram.

/** Moedas sem casas decimais na Stripe (docs: "zero-decimal currencies") */
const ZERO_DECIMAL = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);

export function isZeroDecimal(currency: string | null | undefined): boolean {
  return ZERO_DECIMAL.has((currency ?? '').toUpperCase());
}

/** Quantas menores unidades há em 1 da moeda (100, ou 1 nas sem centavos) */
export function minorUnitFactor(currency: string | null | undefined): number {
  return isZeroDecimal(currency) ? 1 : 100;
}

/** Valor da moeda → menor unidade (o que a Stripe recebe) */
export function toMinorUnits(amount: number, currency: string | null | undefined): number {
  return Math.round(amount * minorUnitFactor(currency));
}

/** Menor unidade (o que a Stripe devolve) → valor da moeda */
export function fromMinorUnits(minor: number, currency: string | null | undefined): number {
  return minor / minorUnitFactor(currency);
}

/** Arredonda no menor passo da moeda (centavo, ou unidade nas sem centavos) */
export function roundMoney(amount: number, currency: string | null | undefined): number {
  return fromMinorUnits(toMinorUnits(amount, currency), currency);
}
