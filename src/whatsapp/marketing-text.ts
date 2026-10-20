import type { Lang } from '../email/language';

/** A Meta recusa parâmetro de modelo acima disto, com quebra de linha, tabulação ou 5 espaços. */
export const WHATSAPP_MARKETING_MAX = 1024;

const OPT_OUT: Record<Lang, string> = {
  pt: 'Responda SAIR para não receber mais.',
  en: 'Reply STOP to opt out.',
  es: 'Responde SALIR para no recibir más.',
};

const OPT_OUT_WORDS = new Set(['SAIR', 'STOP', 'SALIR']);

/**
 * Texto que vai no parâmetro do modelo. Quebra de linha e tabulação viram
 * " · "; mais de 4 espaços seguidos viram 4. No fim, como sair da campanha.
 * null quando não sobra texto ou quando passa de 1.024 caracteres.
 */
export function whatsappMarketingBody(
  message: string,
  lang: Lang,
): { ok: true; text: string } | { ok: false; reason: 'empty' | 'too_long' } {
  const cleaned = message
    .replace(/\r\n/g, '\n')
    .replace(/[\n\r\t]/g, ' · ')
    .replace(/ {5,}/g, '    ')
    .replace(/(?: · ){2,}/g, ' · ')
    .trim();
  if (!cleaned.replace(/[·\s]/g, '')) return { ok: false, reason: 'empty' };
  const footer = OPT_OUT[lang];
  const text = cleaned.includes(footer) ? cleaned : `${cleaned} · ${footer}`;
  if (text.length > WHATSAPP_MARKETING_MAX) return { ok: false, reason: 'too_long' };
  return { ok: true, text };
}

/** A resposta inteira é a palavra de saída (com ponto final, se tiver). */
export function isMarketingOptOut(text: string): boolean {
  const word = text
    .trim()
    .replace(/[.!]+$/g, '')
    .trim()
    .toUpperCase();
  return OPT_OUT_WORDS.has(word);
}

type Inbound = { from?: string; type?: string; text?: { body?: string }; button?: { text?: string; payload?: string } };

/** Telefone e texto das mensagens recebidas no webhook da Meta. */
export function inboundWhatsappTexts(body: unknown): { from: string; text: string }[] {
  const entries = (body as { entry?: { changes?: { value?: { messages?: Inbound[] } }[] }[] })?.entry;
  if (!Array.isArray(entries)) return [];
  const out: { from: string; text: string }[] = [];
  for (const entry of entries) {
    for (const change of entry?.changes ?? []) {
      for (const message of change?.value?.messages ?? []) {
        const from = message?.from?.replace(/\D/g, '') ?? '';
        const text =
          message?.type === 'button'
            ? message.button?.payload || message.button?.text || ''
            : message?.text?.body || '';
        if (from && text) out.push({ from, text });
      }
    }
  }
  return out;
}
