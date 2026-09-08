// Telefone hoje é texto livre em todo o app (Customer.phone, etc. — sem
// máscara/validação de formato), mas a API do WhatsApp exige E.164
// (+<DDI><número>, só dígitos). Heurística simples focada no mercado
// brasileiro (mercado atual do produto): número com 10-11 dígitos é tratado
// como BR sem o "55" na frente. Isso é ambíguo pra clientes de outros
// países cujo número (com DDI) também caia em 10-11 dígitos (ex.: EUA
// "+1XXXXXXXXXX" tem 11) — sem um campo de país por Customer (não existe
// hoje), não dá pra distinguir os dois casos. Aceitável como heurística de
// melhor esforço enquanto o mercado for majoritariamente BR; se o produto
// expandir pra outros países, isso precisa de um campo de país explícito
// por cliente em vez de adivinhar pelo tamanho do número.
export function normalizePhoneToE164(raw: string | null | undefined, defaultCountryCode = '55'): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  if (digits.startsWith(defaultCountryCode) && digits.length >= 12) {
    return `+${digits}`;
  }
  if (digits.length === 10 || digits.length === 11) {
    return `+${defaultCountryCode}${digits}`;
  }
  if (digits.length > 11) {
    return `+${digits}`;
  }
  return null;
}
