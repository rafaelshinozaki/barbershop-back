import { Country } from 'country-state-city';
import { countryIso } from './place-locale';

// Telefone é texto livre (Customer.phone). O WhatsApp exige E.164
// (+<DDI><número>). O DDI que falta vem do país da unidade: "415 555 1234"
// numa unidade dos EUA é +1, não +55. Sem o "+", um número comprido que não
// começa com esse DDI não é enviado — poderia ser de outro país.

/** Tamanho do número nacional (sem DDI). Brasil 10–11, EUA/Canadá 10; o resto, 8 a 11. */
function nationalLengths(callingCode: string): number[] {
  if (callingCode === '1') return [10];
  if (callingCode === '55') return [10, 11];
  return [8, 9, 10, 11];
}

/** NANP não tem código de área começando em 0 ou 1. */
function nationalOk(callingCode: string, national: string): boolean {
  if (!national || national.startsWith('0')) return false;
  if (callingCode === '1') return /^[2-9]\d{9}$/.test(national);
  return true;
}

/** DDI do país (ISO). "+1-684" conta como 1. País desconhecido não chuta 55. */
export function callingCodeForCountry(country?: string | null): string | null {
  // O país gravado por nome ("Brasil") também vale (item 267)
  const iso = countryIso(country) ?? '';
  if (!/^[A-Z]{2}$/.test(iso)) return null;
  const raw = Country.getCountryByCode(iso)?.phonecode ?? '';
  const head = raw.split('-')[0].replace(/\D/g, '');
  return head || null;
}

export function normalizePhoneToE164(
  raw: string | null | undefined,
  defaultCountryCode = '55',
): string | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim();
  const callingCode = (defaultCountryCode || '55').replace(/\D/g, '');
  if (!callingCode) return null;
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  // Com "+", o DDI já veio escrito.
  if (trimmed.startsWith('+')) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  digits = digits.replace(/^0+/, '');
  if (!digits || digits.length > 15) return null;

  const lengths = nationalLengths(callingCode);
  const national = lengths.includes(digits.length) && nationalOk(callingCode, digits);
  if (national) {
    const full = `${callingCode}${digits}`;
    return full.length <= 15 ? `+${full}` : null;
  }

  // Mais longo que um número nacional e já começa com o DDI da unidade.
  if (digits.startsWith(callingCode) && digits.length >= 8) {
    const rest = digits.slice(callingCode.length);
    if (lengths.includes(rest.length) && nationalOk(callingCode, rest)) return `+${digits}`;
  }
  return null;
}

/** Celular do Brasil: DDD + 9 + oito dígitos. Fixo (10 dígitos) não tem WhatsApp. */
function isBrazilMobile(national: string): boolean {
  return /^[1-9][1-9]9\d{8}$/.test(national);
}

/** Celular com o nono dígito: o dígito depois do 9 é 6–9. */
function isBrazilMobileWithNinth(national: string): boolean {
  return /^[1-9][1-9]9[6-9]\d{7}$/.test(national);
}

/** Celular antigo, sem o nono dígito: DDD + 8, o primeiro do assinante é 6–9. */
function isBrazilMobileWithoutNinth(national: string): boolean {
  return /^[1-9][1-9][6-9]\d{7}$/.test(national);
}

/** Número nacional dos EUA/Canadá: código de área e prefixo não começam em 0 ou 1. */
function isNanpNational(national: string): boolean {
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(national);
}

/**
 * Destino de WhatsApp. O DDI que falta é o da unidade, no formato de celular
 * dela. Um número dos EUA escrito com o 1 na frente ("1 415 555 1234") vale
 * mesmo numa unidade do Brasil. "415 555 1234" sem o 1 é igual a um fixo de
 * Curitiba: não dá para saber qual é, então não envia.
 */
export function phoneForWhatsapp(
  raw: string | null | undefined,
  country?: string | null,
): string | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim();
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  if (trimmed.startsWith('+')) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  digits = digits.replace(/^0+/, '');
  if (!digits || digits.length > 15) return null;

  const shopCode = callingCodeForCountry(country);
  if (!shopCode) return null;

  if (shopCode === '55') {
    if (isBrazilMobile(digits)) return `+55${digits}`;
    if (digits.startsWith('55') && isBrazilMobile(digits.slice(2))) return `+${digits}`;
  } else if (shopCode === '1') {
    if (isNanpNational(digits)) return `+1${digits}`;
    if (digits.startsWith('1') && isNanpNational(digits.slice(1))) return `+${digits}`;
  } else {
    const local = normalizePhoneToE164(digits, shopCode);
    if (local) return local;
  }

  // DDI 1 escrito sem "+". Não usa isso quando o número já é um celular da unidade.
  if (shopCode !== '1' && digits.startsWith('1') && isNanpNational(digits.slice(1))) {
    if (!(shopCode === '55' && isBrazilMobile(digits))) return `+${digits}`;
  }
  return null;
}

/**
 * Formas de escrever o mesmo telefone, só com dígitos: "(11) 99999-0000",
 * "11999990000" e "+55 11 99999-0000" dão o mesmo conjunto. Serve pra achar
 * a ficha (e o bloqueio) do cliente sem depender de como ele digitou.
 */
export function phoneDigitVariants(
  raw: string | null | undefined,
  defaultCountryCode = '55',
): string[] {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (!digits) return [];
  const out = new Set<string>([digits]);
  const e164 = normalizePhoneToE164(raw, defaultCountryCode)?.slice(1);
  if (e164) out.add(e164);
  if (e164?.startsWith(defaultCountryCode) && e164.length >= 12) {
    out.add(e164.slice(defaultCountryCode.length));
  }
  return [...out];
}

/** O mesmo celular do Brasil com e sem o 9 depois do DDD (a Meta manda sem). */
function brazilNinthDigitVariants(digits: string): string[] {
  if (!digits.startsWith('55')) return [];
  const national = digits.slice(2);
  let other = '';
  if (isBrazilMobileWithNinth(national)) {
    other = `${national.slice(0, 2)}${national.slice(3)}`;
  } else if (isBrazilMobileWithoutNinth(national)) {
    other = `${national.slice(0, 2)}9${national.slice(2)}`;
  }
  if (!other) return [];
  return [`55${other}`, other];
}

/**
 * Formas do telefone que a Meta manda em "from" (DDI + número, sem "+").
 * Inclui o número nacional e, no Brasil, o celular com e sem o nono dígito.
 */
export function whatsappSenderVariants(from: string): string[] {
  const digits = from.replace(/\D/g, '');
  if (!digits) return [];
  const out = new Set(phoneDigitVariants(`+${digits}`));
  if (digits.startsWith('55') && digits.length > 11) out.add(digits.slice(2));
  if (digits.startsWith('1') && digits.length === 11) out.add(digits.slice(1));
  for (const extra of brazilNinthDigitVariants(digits)) out.add(extra);
  return [...out];
}
