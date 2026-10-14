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

/**
 * Moedas em que 1 unidade vale pouco perto do real (sem centavos, ou cerca
 * de 100 ou mais por dólar). O fator é redondo, da mesma ordem da cotação,
 * e vale para a caixinha e para os outros tetos. Moeda perto do real
 * (euro, dólar, peso mexicano) fica de fora: 1.000.000 já é um teto alto.
 */
export const MONEY_SCALE: Record<string, number> = {
  ALL: 100,
  AMD: 500,
  AOA: 1000,
  ARS: 1000,
  BDT: 100,
  BIF: 3000,
  CDF: 3000,
  CLP: 1000,
  COP: 1000,
  CRC: 500,
  DJF: 100,
  EGP: 100,
  GNF: 10000,
  HTG: 100,
  HUF: 100,
  IDR: 10000,
  IQD: 1000,
  IRR: 10000,
  ISK: 100,
  JPY: 100,
  KES: 100,
  KHR: 5000,
  KMF: 500,
  KRW: 1000,
  KZT: 500,
  LAK: 20000,
  LBP: 100000,
  LKR: 500,
  MGA: 5000,
  MMK: 3000,
  MNT: 3000,
  MWK: 1000,
  NGN: 1000,
  NPR: 100,
  PKR: 500,
  PYG: 5000,
  RSD: 100,
  RUB: 100,
  RWF: 1000,
  SLL: 20000,
  SOS: 500,
  STD: 20000,
  SYP: 10000,
  TZS: 3000,
  UGX: 3000,
  UZS: 10000,
  VEF: 10000,
  VND: 20000,
  VUV: 100,
  XAF: 500,
  XOF: 500,
  XPF: 100,
  YER: 500,
  ZWL: 10000,
};

export function moneyScale(currency: string | null | undefined): number {
  return MONEY_SCALE[(currency ?? '').toUpperCase()] ?? 1;
}

/** Teto pensado em real, na moeda da unidade. */
export function moneyCap(base: number, currency: string | null | undefined): number {
  return base * moneyScale(currency);
}
