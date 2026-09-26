import { safeTimeZone, zonedTimeToUtc } from '../common/timezone.util';

const MAX_CHARS = 80_000;
const MAX_ROWS = 500;

const ALIASES: Record<string, string> = {
  nome: 'name',
  name: 'name',
  cliente: 'name',
  client: 'name',
  customer: 'name',
  first_name: 'first',
  firstname: 'first',
  nome_completo: 'name',
  sobrenome: 'last',
  last_name: 'last',
  lastname: 'last',
  telefone: 'phone',
  phone: 'phone',
  celular: 'phone',
  cell_phone: 'phone',
  cellphone: 'phone',
  mobile: 'phone',
  whatsapp: 'phone',
  fone: 'phone',
  email: 'email',
  e_mail: 'email',
  notas: 'notes',
  notes: 'notes',
  observacao: 'notes',
  obs: 'notes',
  servico: 'service',
  service: 'service',
  tratamento: 'service',
  duracao: 'duration',
  duracao_minutos: 'duration',
  duration: 'duration',
  duration_minutes: 'duration',
  tempo: 'duration',
  preco: 'price',
  price: 'price',
  valor: 'price',
  inicio: 'start',
  start: 'start',
  data_hora: 'start',
  datetime: 'start',
  booking_date: 'date',
  data: 'date',
  date: 'date',
  dia: 'date',
  hora: 'time',
  time: 'time',
  horario: 'time',
  profissional: 'barber',
  barbeiro: 'barber',
  staff: 'barber',
  staffer: 'barber',
  employee: 'barber',
  status: 'status',
  situacao: 'status',
};

export type SheetCustomer = {
  line: number;
  name: string;
  phone: string;
  phoneDigits: string;
  email?: string;
  notes?: string;
};

export type SheetService = {
  line: number;
  name: string;
  durationMinutes: number;
  price: number;
};

export type SheetAppointment = {
  line: number;
  name: string;
  phone: string;
  phoneDigits: string;
  serviceName: string;
  start: Date;
  durationMinutes: number;
  price: number;
  barberName?: string;
  status: 'CONFIRMED' | 'COMPLETED' | 'NO_SHOW';
  source: 'IMPORT' | 'HISTORY';
};

export type ParsedSheet = {
  customers: SheetCustomer[];
  services: SheetService[];
  appointments: SheetAppointment[];
  errors: string[];
};

export function sheetKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const header = src.split('\n')[0] ?? '';
  const delim = (header.match(/;/g)?.length ?? 0) > (header.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === delim) {
      row.push(cell.trim());
      cell = '';
      continue;
    }
    if (ch === '\n') {
      row.push(cell.trim());
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

function digits(phone: string) {
  return phone.replace(/\D/g, '');
}

function money(value: string): number {
  const cleaned = value.trim().replace(/[R$\s]/g, '');
  if (!cleaned) return 0;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    return Number(cleaned.replace(/\./g, '').replace(',', '.')) || 0;
  }
  if (cleaned.includes(',')) return Number(cleaned.replace(',', '.')) || 0;
  return Number(cleaned) || 0;
}

function durationOf(value: string | undefined): number | null {
  if (!value) return null;
  const text = value.trim().toLowerCase();
  const hours = text.match(/^(\d+)\s*h(?:\s*(\d+))?/);
  if (hours) return Number(hours[1]) * 60 + Number(hours[2] ?? 0);
  const clock = text.match(/^(\d{1,2}):(\d{2})$/);
  if (clock && Number(clock[1]) < 12 && !text.includes('min')) {
    return Number(clock[1]) * 60 + Number(clock[2]);
  }
  const minutes = text.match(/(\d+)/);
  return minutes ? Number(minutes[1]) : null;
}

function dateParts(value: string): string | null {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = value.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (br) return `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
  return null;
}

function minutesOf(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2})[:h](\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function appointmentStatus(value: string | undefined, start: Date, now: Date): SheetAppointment['status'] | 'SKIP' {
  const key = sheetKey(value ?? '');
  if (['cancelado', 'cancelled', 'canceled', 'cancelada'].includes(key)) return 'SKIP';
  if (['faltou', 'no_show', 'noshow'].includes(key)) return 'NO_SHOW';
  if (['concluido', 'completed', 'finalizado', 'feito', 'done', 'atendido'].includes(key)) return 'COMPLETED';
  return start.getTime() < now.getTime() ? 'COMPLETED' : 'CONFIRMED';
}

function field(row: Record<string, string>, key: string) {
  return row[key]?.trim() ?? '';
}

/** Planilha CSV (vírgula ou ponto e vírgula), com cabeçalhos de Booksy, Trinks ou os nossos. */
export function parseSheet(csv: string, timeZone: string, now = new Date()): ParsedSheet {
  const errors: string[] = [];
  const customers: SheetCustomer[] = [];
  const services: SheetService[] = [];
  const appointments: SheetAppointment[] = [];
  if (csv.length > MAX_CHARS) {
    return { customers, services, appointments, errors: ['A planilha passa do tamanho aceito. Divida em partes menores.'] };
  }
  const table = parseCsv(csv);
  if (table.length < 2) {
    return { customers, services, appointments, errors: ['A planilha precisa de um cabeçalho e ao menos uma linha.'] };
  }
  const header = table[0].map((cell) => ALIASES[sheetKey(cell)] ?? '');
  const zone = safeTimeZone(timeZone);
  const data = table.slice(1, MAX_ROWS + 1);
  if (table.length - 1 > MAX_ROWS) {
    errors.push(`Só as primeiras ${MAX_ROWS} linhas foram lidas.`);
  }

  data.forEach((cells, index) => {
    const line = index + 2;
    const row: Record<string, string> = {};
    header.forEach((key, i) => {
      if (key && !row[key]) row[key] = cells[i] ?? '';
    });
    const first = field(row, 'first');
    const last = field(row, 'last');
    const name = field(row, 'name') || [first, last].filter(Boolean).join(' ');
    const phone = field(row, 'phone');
    const phoneDigits = digits(phone);
    const serviceName = field(row, 'service') || (!field(row, 'start') && !field(row, 'date') ? name : '');
    const duration = durationOf(field(row, 'duration'));
    const price = money(field(row, 'price'));
    const date = dateParts(field(row, 'start')) ?? dateParts(field(row, 'date'));
    const time =
      minutesOf(field(row, 'start').split(/\s+/).slice(1).join(' ')) ??
      minutesOf(field(row, 'time'));
    const when = date && time != null ? zonedTimeToUtc(date, time, zone) : null;

    if (when) {
      const status = appointmentStatus(field(row, 'status'), when, now);
      if (status === 'SKIP') return;
      if (!name || phoneDigits.length < 8) {
        errors.push(`Linha ${line}: agendamento sem cliente e telefone.`);
        return;
      }
      if (!serviceName) {
        errors.push(`Linha ${line}: agendamento sem serviço.`);
        return;
      }
      appointments.push({
        line,
        name,
        phone,
        phoneDigits,
        serviceName,
        start: when,
        durationMinutes: duration && duration > 0 ? duration : 30,
        price,
        barberName: field(row, 'barber') || undefined,
        status,
        source: when.getTime() < now.getTime() ? 'HISTORY' : 'IMPORT',
      });
      return;
    }

    if ((duration != null || field(row, 'price')) && serviceName && !field(row, 'phone')) {
      if (!duration || duration <= 0) {
        errors.push(`Linha ${line}: serviço sem duração em minutos.`);
        return;
      }
      services.push({ line, name: serviceName, durationMinutes: duration, price });
      return;
    }

    if (name && phoneDigits.length >= 8) {
      customers.push({
        line,
        name,
        phone,
        phoneDigits,
        email: field(row, 'email') || undefined,
        notes: field(row, 'notes') || undefined,
      });
      return;
    }

    if (cells.some((cell) => cell !== '')) {
      errors.push(`Linha ${line}: não deu para reconhecer cliente, serviço ou agendamento.`);
    }
  });

  return { customers, services, appointments, errors };
}
