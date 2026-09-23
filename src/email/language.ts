/** Idiomas com template de e-mail (src/email/templates/<idioma>). */
export type Lang = 'pt' | 'en' | 'es';

/** Texto nos três idiomas — o EmailService escolhe pelo idioma do destinatário. */
export type Localized = Record<Lang, string>;

export const LOCALE: Record<Lang, string> = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' };

/** 'pt', 'PT', 'pt-BR', 'en_US'... → pt/en/es; qualquer outro vira pt. */
export function normalizeLang(language?: string | null): Lang {
  const l = (language || 'pt').slice(0, 2).toLowerCase();
  return l === 'en' || l === 'es' ? l : 'pt';
}

const PORTUGUESE = new Set(['BR', 'PT', 'AO', 'MZ', 'CV', 'GW', 'ST', 'TL']);
const SPANISH = new Set([
  'ES',
  'MX',
  'AR',
  'CO',
  'CL',
  'PE',
  'VE',
  'EC',
  'GT',
  'CU',
  'BO',
  'DO',
  'HN',
  'PY',
  'SV',
  'NI',
  'CR',
  'PA',
  'UY',
  'PR',
  'GQ',
]);

/**
 * Cliente final não tem conta nem idioma salvo: usa a língua do país da
 * barbearia (quem agenda numa unidade do México lê espanhol).
 */
export function langForCountry(country?: string | null): Lang {
  const c = (country || '').trim().toUpperCase();
  if (PORTUGUESE.has(c)) return 'pt';
  if (SPANISH.has(c)) return 'es';
  return c ? 'en' : 'pt';
}

export function isLocalized(value: unknown): value is Localized {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as Localized).pt === 'string' &&
    typeof (value as Localized).en === 'string' &&
    typeof (value as Localized).es === 'string'
  );
}

export function pick(value: string | Localized, lang: Lang): string {
  return isLocalized(value) ? value[lang] : value;
}
