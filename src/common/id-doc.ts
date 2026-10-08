/**
 * Documento de identidade (CPF, SSN, passaporte) na forma em que a conta guarda
 * e na forma em que duas contas são comparadas.
 *
 * CPF brasileiro (11 dígitos) fica mascarado, como o cadastro principal já grava.
 * Outro documento só de números fica com os dígitos, sem máscara de CPF.
 * Documento com letra (passaporte) fica como foi digitado.
 */

const BRAZIL = new Set(['BR', 'BRA', 'BRASIL', 'BRAZIL']);

export function idDocDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

export function canonicalIdDoc(value: string | null | undefined, country?: string | null): string {
  const raw = (value ?? '').trim();
  const digits = idDocDigits(raw);
  const bare = raw.replace(/[\s.\-/]/g, '');
  const countryCode = (country ?? '').trim().toUpperCase();
  if (BRAZIL.has(countryCode) && digits.length === 11 && bare === digits) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (digits && bare === digits) return digits;
  return raw;
}

/** Dígitos para achar a mesma pessoa, ou null quando o documento tem letra. */
export function idDocLookupDigits(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim();
  if (!raw || /[A-Za-z]/.test(raw)) return null;
  const digits = idDocDigits(raw);
  return digits || null;
}
