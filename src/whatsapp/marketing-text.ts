import type { Lang } from '../email/language';

/** A Meta recusa parâmetro de modelo acima disto, com quebra de linha, tabulação ou 5 espaços. */
export const WHATSAPP_MARKETING_MAX = 1024;

const OPT_OUT: Record<Lang, string> = {
  pt: 'Responda SAIR para não receber mais.',
  en: 'Reply STOP to opt out.',
  es: 'Responde SALIR para no recibir más.',
};

const OPT_OUT_WORDS = new Set(['SAIR', 'STOP', 'SALIR', 'PARAR', 'CANCELAR']);

const OPT_OUT_DONE: Record<string, string> = {
  SAIR: 'Você saiu das campanhas e não vai mais receber essas mensagens.',
  PARAR: 'Você saiu das campanhas e não vai mais receber essas mensagens.',
  CANCELAR: 'Você saiu das campanhas e não vai mais receber essas mensagens.',
  STOP: 'You have opted out and will not receive these messages anymore.',
  SALIR: 'Ya no vas a recibir estas campañas.',
};

/** Primeira palavra da resposta, se for um pedido de saída. */
function optOutWord(text: string): string | null {
  const match = text.trim().match(/^[^\p{L}\p{N}]*(\p{L}+)/u);
  if (!match) return null;
  const word = match[1].toUpperCase();
  return OPT_OUT_WORDS.has(word) ? word : null;
}

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

/** A palavra de saída no começo da frase, ou a frase inteira (com ponto, se tiver). */
export function isMarketingOptOut(text: string): boolean {
  return optOutWord(text) != null;
}

/** Texto livre de confirmação, no idioma da palavra que a pessoa usou. */
export function marketingOptOutReply(text: string): string | null {
  const word = optOutWord(text);
  return word ? OPT_OUT_DONE[word] : null;
}

type Inbound = {
  from?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
};

/** Telefone e texto das mensagens recebidas no webhook da Meta. */
export function inboundWhatsappTexts(body: unknown): { from: string; text: string }[] {
  const entries = (body as { entry?: { changes?: { value?: { messages?: Inbound[] } }[] }[] })
    ?.entry;
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
