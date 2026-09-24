/**
 * Arquivo de calendário (iCalendar, RFC 5545) — o formato que Google Agenda,
 * Apple Calendário, Outlook e qualquer app de agenda entendem, tanto pra
 * importar um evento (.ics) quanto pra assinar uma agenda (feed).
 */

export type IcsEvent = {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  /** Aumenta a cada mudança: o app troca o evento antigo pelo novo */
  sequence?: number;
  cancelled?: boolean;
  updatedAt?: Date;
};

const PRODID = '-//Barbershop//Agenda//PT';

/** Data/hora em UTC no formato do iCalendar: 20260924T153000Z */
function stamp(d: Date) {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** Texto com vírgula, ponto e vírgula, barra e quebra de linha escapados */
function text(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Linhas de no máximo 75 bytes, continuadas com espaço (RFC 5545 §3.1) */
function fold(line: string) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, 'utf8');
    const limit = parts.length === 0 ? 75 : 74; // continuação começa com espaço
    if (size + n > limit) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function eventLines(e: IcsEvent, now: Date) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(e.start)}`,
    `DTEND:${stamp(e.end)}`,
    `SUMMARY:${text(e.summary)}`,
  ];
  if (e.description) lines.push(`DESCRIPTION:${text(e.description)}`);
  if (e.location) lines.push(`LOCATION:${text(e.location)}`);
  if (e.url) lines.push(`URL:${e.url}`);
  if (e.updatedAt) lines.push(`LAST-MODIFIED:${stamp(e.updatedAt)}`);
  lines.push(`SEQUENCE:${e.sequence ?? 0}`);
  lines.push(`STATUS:${e.cancelled ? 'CANCELLED' : 'CONFIRMED'}`);
  lines.push('END:VEVENT');
  return lines;
}

/**
 * Monta o calendário. `name` aparece como nome da agenda assinada; `method`
 * CANCEL num .ics avulso faz o app apagar o evento que já tinha.
 */
export function buildCalendar(
  events: IcsEvent[],
  opts: { name?: string; method?: 'PUBLISH' | 'CANCEL'; refreshHours?: number } = {},
) {
  const now = new Date();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    `METHOD:${opts.method ?? 'PUBLISH'}`,
  ];
  if (opts.name) {
    lines.push(`X-WR-CALNAME:${text(opts.name)}`, `NAME:${text(opts.name)}`);
  }
  if (opts.refreshHours) {
    // Sugestão de atualização pros apps que respeitam (Apple, Outlook)
    lines.push(
      `REFRESH-INTERVAL;VALUE=DURATION:PT${opts.refreshHours}H`,
      `X-PUBLISHED-TTL:PT${opts.refreshHours}H`,
    );
  }
  for (const e of events) lines.push(...eventLines(e, now));
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** "Adicionar ao Google Agenda" (abre o evento preenchido, sem login no sistema) */
export function googleCalendarUrl(
  e: Pick<IcsEvent, 'start' | 'end' | 'summary' | 'description' | 'location'>,
) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.summary,
    dates: `${stamp(e.start)}/${stamp(e.end)}`,
  });
  if (e.description) params.set('details', e.description);
  if (e.location) params.set('location', e.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** "Adicionar ao Outlook" (Outlook.com / Microsoft 365) */
export function outlookCalendarUrl(
  e: Pick<IcsEvent, 'start' | 'end' | 'summary' | 'description' | 'location'>,
) {
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: e.summary,
    startdt: e.start.toISOString(),
    enddt: e.end.toISOString(),
  });
  if (e.description) params.set('body', e.description);
  if (e.location) params.set('location', e.location);
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}
