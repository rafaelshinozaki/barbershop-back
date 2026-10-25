import { assertStatusFitsTime } from './appointment-status-time';
import { must } from '../common/must';
import { bookingChannel } from './booking-channel';
import { unsubscribeLinks, verifyUnsubscribeToken } from './marketing-unsubscribe';
import {
  appointmentManageUrl,
  appointmentLinkMode,
  createAppointmentToken,
  verifyAppointmentToken,
  verifyWaitlistLeaveToken,
  waitlistLeaveUrl,
} from './appointment-link';
import { reminderSentAtAfterMove } from './reminder-window';
import { appointmentContactEmail } from './appointment-contact';
import { localeGroups, moneyByCurrency } from './dashboard-locale';
import { ownerAcceptsPublic, ownerAccountOpen } from './public-shop';
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Optional,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import { SearchCacheService } from './search-cache.service';
import { langForCountry, LOCALE, normalizeLang, type Lang } from '../email/language';
import { reviewEditData } from './review-edit';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationQueueService } from '../queue/notification-queue.service';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/dto/create-notification.dto';
import { UserService } from '../auth/users/users.service';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma, TreatmentCategory } from '@prisma/client';
import { isStaffType, takesAppointments } from './staff-roles';
import { linkBarberToProfessional, shiftsOverlap } from './professional';
import { acceptsNewClient } from './profile-privacy';
import {
  assertSoloBookingAllowed,
  assertSoloProductSaleAllowed,
  assertSoloSinglePerson,
  productUnits,
} from './solo';
import { unitBadges } from './badges';
import { DEFAULT_BUSINESS_TYPE, isBusinessType, type BusinessType } from './business-types';
import {
  DEFAULT_WORKING_HOURS,
  normalizeBusinessHours,
  parseBusinessHours,
  WEEKDAY_KEYS,
} from './working-hours';
import {
  boundingBox,
  clampRadius,
  haversineKm,
  isOpenAt,
  lngInBox,
  rankResults,
  type SearchSort,
} from './search';

/** Filtros da busca pública (unidades e profissionais) */
export type PublicSearchInput = {
  query?: string;
  category?: TreatmentCategory;
  city?: string;
  citySlug?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  minRating?: number;
  maxPrice?: number;
  openNow?: boolean;
  sort?: SearchSort;
  limit?: number;
};
import {
  addDaysStr,
  dayOfWeekOf,
  monthRangeUtc,
  nextDateStr,
  safeTimeZone,
  toZonedParts,
  zonedTimeToUtc,
  reportPeriod,
} from '../common/timezone.util';
import {
  planIncludesModule,
  getModulesForPlanName,
  getPlanLimits,
  BarbershopModule,
} from './barbershop-plan.constants';
import { PLANO_STATUS } from '../common/contants';
import { S3Service } from '../aws/s3.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import {
  callingCodeForCountry,
  normalizePhoneToE164,
  phoneDigitVariants,
  phoneForWhatsapp,
} from '../common/phone.util';
import { whatsappMarketingBody } from '../whatsapp/marketing-text';
import { homeServiceEnabled } from './home-service';
import { StripeService } from '../stripe/stripe.service';
import { JobOpeningService } from './job-opening.service';
import { currentPricing } from '../pricing/pricing';
import { currencyForCountry, timezoneForPlace } from '../common/place-locale';
import { payoutReport, type PayoutCharge } from './payout-report';
import { appointmentCalendarLinks, appointmentInvite } from '../calendar/calendar-links';
import { moneyCap, roundMoney, toMinorUnits } from '../common/money-units';

// Mesmas opções do seletor de cores do front (Radix Themes)
/** Agenda da franquia: período máximo pedido (6 semanas = visão de mês) */
export const NETWORK_AGENDA_MAX_DAYS = 43;
/** Teto de segurança de agendamentos por período na agenda da franquia */
/** Minutos depois de agendar em que o cliente desfaz pelo link mesmo dentro da janela */
export const BOOKING_GRACE_MINUTES = 15;

export const NETWORK_AGENDA_CAP = 2000;

const NETWORK_ACCENT_COLORS = [
  'gray',
  'gold',
  'bronze',
  'brown',
  'yellow',
  'amber',
  'orange',
  'tomato',
  'red',
  'ruby',
  'crimson',
  'pink',
  'plum',
  'purple',
  'violet',
  'iris',
  'indigo',
  'blue',
  'cyan',
  'teal',
  'jade',
  'green',
  'grass',
  'lime',
  'mint',
  'sky',
] as const;
const NETWORK_GRAY_COLORS = ['auto', 'gray', 'mauve', 'slate', 'sage', 'olive', 'sand'] as const;

/**
 * Cargos na unidade, como no Booksy (do mais restrito ao dono):
 * - basic (Barbeiro básico): só a própria agenda; clientes só pelo nome
 * - barber (Barbeiro): a própria agenda, as próprias vendas, fila e pacotes;
 *   contato só dos clientes que já agendaram com ele
 * - reception (Recepção): agenda de todos, cadastro completo dos clientes e
 *   o caixa do dia (abrir, vender, fechar) — sem relatórios nem configurações
 * - manager (Gerente): quase tudo do dono
 * - owner (Dono): tudo, inclusive apagar a unidade
 */
export type AccessLevel = 'basic' | 'barber' | 'reception' | 'manager' | 'owner';
const ACCESS_RANK: Record<AccessLevel, number> = {
  basic: 1,
  barber: 2,
  reception: 3,
  manager: 4,
  owner: 5,
};
/** Recepção não atende: não aparece pra agendar nem recebe agendamento */
/** Até quantos dias à frente o "próximo horário disponível" procura */
const NEXT_AVAILABLE_DAYS = 60;
/** Agendamento online: até quantos dias à frente (lista, próximo livre e criação) */
export const PUBLIC_BOOKING_WINDOW_DAYS = 90;
/** Grade da lista de horários (a criação só aceita horário nela) */
const SLOT_GRANULARITY_MIN = 15;
/** Antecedência mínima do agendamento online: nenhuma, 30 min, 1 h, 2 h, 1 dia */
const BOOKING_LEAD_MINUTES = [0, 30, 60, 120, 1440];
/** Quanto tempo o horário fica reservado esperando o sinal online */
export const DEPOSIT_HOLD_MINUTES = 15;
/** Quem atende: marcado pra atender, ou sem marcação e fora da recepção */
const BOOKABLE_STAFF = {
  OR: [
    { takesAppointments: true },
    {
      takesAppointments: null,
      OR: [{ staffType: null }, { staffType: { not: 'reception' } }],
    },
  ],
} satisfies Prisma.BarberWhereInput;
/**
 * Vínculo valendo agora: ativo e dentro do período (freelancer com data de
 * início/fim). Fora dele a pessoa não entra na unidade nem aparece pra agendar.
 */
export function currentEngagement(now = new Date()): Prisma.BarberWhereInput {
  return {
    isActive: true,
    AND: [
      { OR: [{ accessStartsAt: null }, { accessStartsAt: { lte: now } }] },
      { OR: [{ accessEndsAt: null }, { accessEndsAt: { gte: now } }] },
    ],
  };
}
/** Nome sem acento, caixa e espaços repetidos */
const personName = (value: string | null | undefined) =>
  (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * A ficha achada pelo telefone digitado na página é da mesma pessoa? Com
 * e-mail na ficha, ele tem de bater; sem e-mail, o nome inteiro (item 249).
 */
export function samePublicPerson(
  customer: { name: string; email: string | null },
  typed: { name: string; email: string },
): boolean {
  const saved = customer.email?.trim().toLowerCase();
  if (saved) return saved === typed.email.trim().toLowerCase();
  return personName(customer.name) !== '' && personName(customer.name) === personName(typed.name);
}
/** O atendimento cai dentro do período do vínculo? */
function withinEngagement(
  barber: { accessStartsAt: Date | null; accessEndsAt: Date | null },
  startAt: Date,
): boolean {
  return (
    (!barber.accessStartsAt || startAt >= barber.accessStartsAt) &&
    (!barber.accessEndsAt || startAt <= barber.accessEndsAt)
  );
}
/** Valida o período do vínculo temporário (datas ISO ou null = sem limite) */
export function parseEngagementPeriod(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined,
): { accessStartsAt: Date | null; accessEndsAt: Date | null } {
  const toDate = (v: string | Date | null | undefined) => {
    if (v == null || v === '') return null;
    const d = new Date(v);
    if (isNaN(d.getTime())) throw new BadRequestException('Data do vínculo inválida');
    return d;
  };
  const accessStartsAt = toDate(start);
  const accessEndsAt = toDate(end);
  if (accessStartsAt && accessEndsAt && accessEndsAt < accessStartsAt) {
    throw new BadRequestException('O fim do vínculo não pode ser antes do início');
  }
  return { accessStartsAt, accessEndsAt };
}
/** Cargos que veem só a própria agenda (e as próprias vendas) */
const OWN_AGENDA_ONLY: AccessLevel[] = ['basic', 'barber'];

const MAX_TIME_OFF_DAYS = 366;
const MAX_DESCRIPTION = 1000;
/** Fotos de trabalhos (posts publicados) na página pública */
const PORTFOLIO_PHOTOS = 12;
const MAX_AGENDA_ROWS = 3000;
const TIME_OFF_REASONS = ['VACATION', 'SICK', 'PERSONAL', 'OTHER'];
/**
 * Afastamento por doença é dado de saúde: o motivo aparece pra gerente e dono
 * (e pro próprio profissional); pros outros vira "Outro".
 */
function timeOffReasonFor(level: AccessLevel, ownOnly = false) {
  const full = ownOnly || ACCESS_RANK[level] >= ACCESS_RANK.manager;
  return (reason: string) => (full || reason !== 'SICK' ? reason : 'OTHER');
}

/**
 * Link de rede social da página pública: aceita o link completo ou só o
 * @usuário (vira https://<rede>/<usuário>). Só links da própria rede — o
 * campo não vira atalho pra qualquer site. Vazio apaga.
 */
function socialUrl(value: string | null | undefined, host: string, label: string): string | null {
  const v = value?.trim();
  if (!v) return null;
  const handle = v.replace(/^@/, '');
  if (/^[\w.-]{1,60}$/.test(handle)) return `https://${host}/${handle}`;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
  } catch {
    throw new BadRequestException(`Link do ${label} inválido`);
  }
  const ok = url.hostname === host || url.hostname.endsWith(`.${host}`);
  if (!ok || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
    throw new BadRequestException(`Use um link do ${label} (${host})`);
  }
  url.protocol = 'https:';
  return url.toString().slice(0, 300);
}

/** Até quantos dias à frente o cliente entra na lista de espera online */
const WAITLIST_MAX_DAYS_AHEAD = 60;
/** Quantas entradas online aguardando uma mesma pessoa pode ter na rede */
const WAITLIST_MAX_ONLINE_PER_CUSTOMER = 5;
/** Entradas online (e e-mails de confirmação) por endereço de e-mail em 24 horas */
const WAITLIST_MAX_ONLINE_PER_EMAIL_DAY = 5;
/** Quantas entradas conferir a cada mudança de agenda (as mais antigas primeiro) */
const WAITLIST_OPENING_MAX_ENTRIES = 200;
/** Letras do código de indicação (sem 0/O e 1/I, que se confundem) */
const REFERRAL_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Campanhas de marketing: uma por dia por unidade, e um teto de e-mails em 30 dias */
const MARKETING_MIN_INTERVAL_HOURS = 24;
export const MARKETING_EMAILS_PER_30_DAYS = 5000;
export const MARKETING_DAILY_LIMIT_MESSAGE =
  'Esta unidade já enviou uma campanha nas últimas 24 horas. Tente amanhã.';
export const MARKETING_MONTHLY_LIMIT_MESSAGE =
  'Esta campanha passa do limite de e-mails de campanha da unidade nos últimos 30 dias.';
/** Prazo de quem foi avisado da vaga; depois, o horário livre vai pro próximo */
export const WAITLIST_OFFER_MINUTES = 30;
export const MARKETING_SUSPENDED_MESSAGE =
  'A unidade está suspensa pela plataforma e não pode enviar campanhas agora.';
export const GIFT_CARD_OTHER_CURRENCY_MESSAGE =
  'Este cartão-presente foi vendido em outra moeda e não vale nesta unidade.';
// Texto fixo (o catálogo de erros casa pela mensagem): acompanha WAITLIST_MAX_DAYS_AHEAD
export const WAITLIST_DAY_RANGE_MESSAGE = 'Escolha um dia entre hoje e os próximos 60 dias';
export const WALK_IN_OWN_QUEUE_MESSAGE = 'Seu cargo só permite pôr clientes na sua própria fila.';
export const WALK_IN_TRANSITION_MESSAGE =
  'Essa mudança de situação não vale para este cliente da fila.';

/** Começo do dia de hoje no fuso da unidade: a fila é do dia */
function queueDayStart(timezone: string | null | undefined, now = new Date()) {
  const tz = safeTimeZone(timezone);
  return zonedTimeToUtc(toZonedParts(now, tz).dateStr, 0, tz);
}
/** Agendamento que conta como "já tem horário" (fecha a entrada da lista) */
const WAITLIST_BOOKED_STATUSES = ['CONFIRMED', 'PENDING_PAYMENT', 'COMPLETED'];

/** Onde a agenda pode ter aberto: um profissional (ou todos) e um período */
export type WaitlistOpeningScope = { barberId?: number | null; from?: string; to?: string };

/** Página da unidade já com o dia (e o profissional e o serviço pedidos) */
function waitlistBookUrl(
  slug: string,
  date: string,
  entry: { barberId: number | null; serviceId: number | null },
) {
  const front = process.env.FRONTEND_URL || 'http://localhost:5173';
  const params = new URLSearchParams({ date });
  if (entry.serviceId) params.set('services', String(entry.serviceId));
  if (entry.barberId) params.set('barber', String(entry.barberId));
  return `${front}/u/${encodeURIComponent(slug)}?${params.toString()}`;
}

// Fichas com dado de saúde (sensível na LGPD): só com consentimento do cliente
const HEALTH_FORM_TYPES = ['ANAMNESIS', 'ALLERGY_TEST'];
/** O profissional vê a ficha de quem atendeu ou vai atender neste prazo */
const HEALTH_FORM_LOOKBACK_DAYS = 90;

// Teto de candidatos da busca de unidades (filtra e ordena todos até aqui)
const SEARCH_CANDIDATE_LIMIT = 5000;

// Valores de dinheiro que vêm da tela: número de verdade, sem negativo e com
// teto. Um total negativo com cartão-presente "debitava" um valor negativo
// (o saldo subia) e pontos negativos "resgatados" viravam pontos ganhos.
// O teto é 1.000.000 na moeda "forte" e acompanha moneyScale nas outras.
const MAX_MONEY = 1_000_000;
function checkMoney(label: string, value: number | null | undefined, currency?: string | null) {
  if (value == null) return;
  if (!Number.isFinite(value) || value < 0 || value > moneyCap(MAX_MONEY, currency)) {
    throw new BadRequestException(`${label} inválido`);
  }
}
/** Duração do serviço: de 1 minuto a 12 horas, em minutos inteiros */
export const SERVICE_DURATION_MESSAGE = 'A duração do serviço vai de 1 minuto a 12 horas.';
export const APPOINTMENT_DEPOSIT_MESSAGE =
  'O sinal não pode ser maior que o preço dos serviços do horário.';
export const DEPOSIT_RECEPTION_MESSAGE =
  'O sinal recebido à mão é marcado pela recepção para cima.';
export const DEPOSIT_METHOD_MESSAGE = 'Informe a forma em que o sinal foi recebido.';
export const DEPOSIT_CASH_CLOSED_MESSAGE =
  'Esse sinal entrou num caixa que já foi fechado e não pode mais ser desmarcado.';
export const SERVICE_DEPOSIT_MESSAGE = 'O sinal não pode ser maior que o preço do serviço.';
export const STOCK_MOVEMENT_MESSAGE = 'Tipo de movimentação de estoque inválido.';
export const STOCK_QUANTITY_MESSAGE = 'Informe uma quantidade diferente de zero.';
export const STOCK_MIN_MESSAGE = 'O estoque mínimo não pode ser negativo.';
const STOCK_MOVEMENTS = ['PURCHASE', 'ADJUSTMENT', 'LOSS', 'TRANSFER'];
function checkServiceDuration(value: number | null | undefined) {
  if (value == null) return;
  if (!Number.isInteger(value) || value < 1 || value > 720) {
    throw new BadRequestException(SERVICE_DURATION_MESSAGE);
  }
}
/**
 * Preço, sinal e duração do serviço (antes ia qualquer número: duração zero
 * travava a agenda, preço negativo virava desconto e o sinal passava do preço).
 */
function checkServiceValues(
  data: {
    price?: number | Decimal | null;
    depositAmount?: number | Decimal | null;
    durationMinutes?: number | null;
  },
  currency: string | null | undefined,
  current?: { price: number | Decimal },
) {
  const price = data.price != null ? Number(data.price) : undefined;
  const deposit = data.depositAmount != null ? Number(data.depositAmount) : undefined;
  checkMoney('Preço do serviço', price, currency);
  checkMoney('Sinal', deposit, currency);
  checkServiceDuration(data.durationMinutes);
  const finalPrice = price ?? (current ? Number(current.price) : undefined);
  if (deposit != null && finalPrice != null && deposit > finalPrice) {
    throw new BadRequestException(SERVICE_DEPOSIT_MESSAGE);
  }
}
/** Sessões de pacote ou de plano: pelo menos 1. Zero cobraria sem poder usar. */
function checkSessionCount(label: string, value: number | null | undefined) {
  if (value == null) return;
  if (!Number.isInteger(value) || value < 1) {
    throw new BadRequestException(`${label} precisa ser pelo menos 1`);
  }
}

function productQuantities(
  items: Array<{ itemType: string; productId?: number | null; quantity: number }>,
) {
  const qty = new Map<number, number>();
  for (const item of items) {
    if (item.itemType !== 'PRODUCT' || !item.productId) continue;
    qty.set(item.productId, (qty.get(item.productId) ?? 0) + item.quantity);
  }
  return qty;
}

/** Quanto o cliente pagou de verdade: o que falta no caixa mais o sinal e o
 * pagamento pelo app. Cartão-presente e pontos resgatados não contam. */
function loyaltyMoneyBase(total: number, depositApplied: number, prepaidApplied: number) {
  return Math.max(0, total + depositApplied + prepaidApplied);
}

function customerBookingRefusal(err: unknown): boolean {
  if (!(err instanceof BadRequestException)) return false;
  return (
    err.message === 'Você já tem um horário nesse período' ||
    err.message === 'Você já tem 5 horários marcados. Cancele um para marcar outro.'
  );
}

/** Horários futuros que o agendamento público aceita por telefone. */
const PUBLIC_UPCOMING_LIMIT = 5;

/** Mesma moeda, sem diferença de caixa ou espaço ("brl" = "BRL") */
const sameCurrency = (a?: string | null, b?: string | null) =>
  (a ?? 'BRL').trim().toUpperCase() === (b ?? 'BRL').trim().toUpperCase();

/**
 * Fidelidade e taxa fixa de no-show são valores na moeda da rede (pontos
 * por unidade de moeda, valor do ponto, taxa em dinheiro). Numa unidade em
 * outra moeda ficam desligados até haver configuração por moeda: 1 ponto por
 * real não é 1 ponto por iene, e uma taxa de 30 não vira 30 euros (item 188).
 */
export function networkMoneyRules<
  N extends {
    currency?: string | null;
    loyaltyEnabled?: boolean;
    noShowFeeEnabled?: boolean;
    noShowFeeType?: string | null;
  },
>(shop: { currency?: string | null }, network: N): N {
  if (!network || sameCurrency(shop.currency, network.currency)) return network;
  return {
    ...network,
    loyaltyEnabled: false,
    ...(network.noShowFeeType === 'FIXED' ? { noShowFeeEnabled: false } : {}),
  };
}

function loyaltyEarnedFor(
  network: { loyaltyEnabled: boolean; loyaltyPointsPerCurrencyUnit: number | null },
  paymentStatus: string,
  total: number,
  customerId: number | null,
) {
  if (paymentStatus !== 'PAID' || !customerId || !network.loyaltyEnabled) return 0;
  const perUnit = network.loyaltyPointsPerCurrencyUnit ?? 0;
  if (perUnit <= 0) return 0;
  return Math.floor(total * perUnit);
}
function checkSaleAmounts(
  data: {
    subtotal?: number;
    discountAmount?: number;
    taxAmount?: number;
    total?: number;
    loyaltyPointsRedeemed?: number;
    items?: Array<{ quantity: number; unitPrice: number; totalPrice: number }>;
  },
  currency?: string | null,
) {
  checkMoney('Subtotal', data.subtotal, currency);
  checkMoney('Desconto', data.discountAmount, currency);
  checkMoney('Imposto', data.taxAmount, currency);
  checkMoney('Total', data.total, currency);
  const points = data.loyaltyPointsRedeemed;
  if (points != null && (!Number.isInteger(points) || points < 0)) {
    throw new BadRequestException('Pontos inválidos');
  }
  for (const item of data.items ?? []) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000) {
      throw new BadRequestException('Quantidade inválida');
    }
    checkMoney('Preço', item.unitPrice, currency);
    checkMoney('Preço', item.totalPrice, currency);
  }
}

/**
 * Os valores da venda têm de fechar entre si: cada item = quantidade × preço,
 * subtotal = soma dos itens e total = subtotal − desconto + imposto (nunca
 * abaixo de zero). Antes o total vinha da tela sem conferência: dava pra
 * lançar R$ 100 em itens com total de R$ 1 (caixa, relatório e comissão
 * ficavam cada um com um número).
 */
const MONEY_TOLERANCE = 0.01;
function checkSaleConsistency(data: {
  items: Array<{ quantity: number; unitPrice: number; totalPrice: number }>;
  subtotal: number;
  discountAmount?: number | null;
  taxAmount?: number | null;
  total: number;
}) {
  const off = (a: number, b: number) => Math.abs(a - b) > MONEY_TOLERANCE;
  for (const item of data.items) {
    if (off(item.totalPrice, item.quantity * item.unitPrice)) {
      throw new BadRequestException('O valor de um item não bate com quantidade × preço');
    }
  }
  const itemsSum = data.items.reduce((sum, item) => sum + item.totalPrice, 0);
  if (off(data.subtotal, itemsSum)) {
    throw new BadRequestException('O subtotal não bate com a soma dos itens');
  }
  const expected = Math.max(0, data.subtotal - (data.discountAmount ?? 0) + (data.taxAmount ?? 0));
  if (off(data.total, expected)) {
    throw new BadRequestException('O total não bate com subtotal − desconto + imposto');
  }
}

// NOT_SERVED: ficou na fila de um dia que acabou (a rotina da madrugada marca)
const WALK_IN_STATUSES = ['WAITING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NOT_SERVED'];
/** Para onde cada situação da fila pode ir (concluída e cancelada não voltam) */
const WALK_IN_NEXT: Record<string, string[]> = {
  WAITING: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED', 'WAITING'],
};

/** Centavos certos (soma de float deixava 26,999999…) */
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Situações que a equipe pode pôr num agendamento (PENDING_PAYMENT é do sinal online) */
/**
 * Origens que a equipe escolhe ao marcar pela agenda. ONLINE é só a página
 * pública; IMPORT e HISTORY, só a importação de planilha (HISTORY fica fora
 * da cota do plano solo: aceito da tela, marcava tudo como histórico e a
 * cota nunca fechava).
 */
export const STAFF_APPOINTMENT_SOURCES = ['PHONE', 'WALK_IN'] as const;

/**
 * Venda paga num período, pelo dia em que foi paga (`paidAt`). Venda antiga
 * sem `paidAt` cai pela criação. Antes o faturamento usava a criação: venda
 * lançada pendente ontem e paga hoje contava como de ontem
 */
/**
 * Soma (ou tira) do estoque no banco, com `increment`, e devolve o saldo
 * antes/depois a partir do valor que voltou. Ler e gravar o valor absoluto
 * perdia uma baixa quando duas vendas do mesmo produto saíam juntas.
 */
async function moveStock(
  tx: Prisma.TransactionClient,
  barbershopId: number,
  productId: number,
  unit: string,
  change: number,
) {
  const inventoryItem = await tx.inventoryItem.upsert({
    where: { barbershopId_productId: { barbershopId, productId } },
    create: { barbershopId, productId, quantity: change, unit },
    update: { quantity: { increment: change }, unit },
  });
  const quantityAfter = Number(inventoryItem.quantity);
  return { inventoryItem, quantityBefore: quantityAfter - change, quantityAfter };
}

export function paidInRange(range: Prisma.DateTimeFilter): Prisma.SaleWhereInput {
  return { OR: [{ paidAt: range }, { paidAt: null, createdAt: range }] };
}

/** Estorno do saldo de pacote ou cartão-presente: lançamento negativo, de hoje */
export const REFUND_SALE_TYPE = 'REFUND';
// Códigos ISO 4217 que o Intl conhece (a lib do TypeScript daqui ainda não tipa supportedValuesOf)
const SUPPORTED_CURRENCIES = new Set(
  (Intl as unknown as { supportedValuesOf(key: 'currency'): string[] }).supportedValuesOf(
    'currency',
  ),
);
export const SHOP_TIMEZONE_INVALID_MESSAGE = 'Fuso horário inválido';
export const SHOP_CURRENCY_INVALID_MESSAGE = 'Moeda inválida (use o código de 3 letras, como BRL)';
export const SHOP_CURRENCY_OWNER_ONLY_MESSAGE = 'Só o dono troca a moeda da unidade.';
export const SHOP_CURRENCY_LOCKED_MESSAGE =
  'A unidade já tem dinheiro registrado nesta moeda. Para trocar, fale com o suporte.';
/** Página pública /u/:slug. Minúsculas, sem hífen nas pontas, de 3 a 60. */
export const SHOP_SLUG_INVALID_MESSAGE =
  'Endereço da página inválido — use só letras minúsculas, números e hífen (sem começar ou terminar com hífen), de 3 a 60 caracteres.';

const SHOP_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHOP_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SHOP_TEXT_MAX = {
  name: 120,
  address: 200,
  complement1: 120,
  complement2: 120,
  city: 80,
  state: 80,
  country: 80,
  postalCode: 20,
  email: 254,
} as const;

export function normalizeShopSlug(raw: string | null | undefined): string {
  const slug = (raw ?? '').trim().toLowerCase();
  if (slug.length < 3 || slug.length > 60 || !SHOP_SLUG.test(slug)) {
    throw new BadRequestException(SHOP_SLUG_INVALID_MESSAGE);
  }
  return slug;
}

type ShopTextInput = {
  name?: string | null;
  address?: string | null;
  complement1?: string | null;
  complement2?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  email?: string | null;
};

type ShopTexts = {
  -readonly [K in keyof typeof SHOP_TEXT_MAX]?: string;
} & { phone?: string };

/** Textos do cadastro e da edição: tamanho, e-mail e telefone com DDD. */
export function normalizeShopTexts(
  data: ShopTextInput,
  required: boolean,
  countryFallback?: string | null,
): ShopTexts {
  const out: ShopTexts = {};
  const take = (key: keyof typeof SHOP_TEXT_MAX, label: string, opts?: { email?: boolean }) => {
    const optional = key === 'complement1' || key === 'complement2';
    const value = data[key];
    if (value == null) {
      if (required && !optional) throw new BadRequestException(`${label} inválido`);
      return;
    }
    const text = String(value).trim();
    // País sem estado (Portugal, por exemplo): o estado fica vazio
    if (!text) {
      if (optional || key === 'state') {
        out[key] = '';
        return;
      }
      throw new BadRequestException(`${label} inválido`);
    }
    if (text.length > SHOP_TEXT_MAX[key] || (key === 'name' && text.length < 2)) {
      throw new BadRequestException(`${label} inválido`);
    }
    if (opts?.email && !SHOP_EMAIL.test(text)) {
      throw new BadRequestException('E-mail da unidade inválido');
    }
    out[key] = key === 'email' ? text.toLowerCase() : text;
  };
  take('name', 'Nome da unidade');
  take('address', 'Endereço');
  take('complement1', 'Complemento');
  take('complement2', 'Complemento');
  take('city', 'Cidade');
  take('state', 'Estado');
  take('country', 'País');
  take('postalCode', 'CEP');
  take('email', 'E-mail da unidade', { email: true });
  if (data.phone != null || required) {
    const country = String(out.country ?? data.country ?? countryFallback ?? '');
    const phone = normalizePhoneToE164(data.phone, callingCodeForCountry(country) ?? '55');
    if (!phone) {
      throw new BadRequestException('Telefone da unidade inválido (use o número com DDD)');
    }
    out.phone = phone;
  }
  return out;
}

/** Fuso e moeda do cadastro: o que veio é checado; o que faltou sai do país. */
export function resolveShopLocale(input: {
  timezone?: string | null;
  currency?: string | null;
  country: string;
  state?: string | null;
}): { timezone: string; currency: string } {
  let timezone = input.timezone?.trim() || '';
  if (timezone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    } catch {
      throw new BadRequestException(SHOP_TIMEZONE_INVALID_MESSAGE);
    }
  } else {
    timezone = timezoneForPlace(input.country, input.state ?? '');
  }
  let currency = input.currency?.trim().toUpperCase() || '';
  if (currency) {
    if (!SUPPORTED_CURRENCIES.has(currency)) {
      throw new BadRequestException(SHOP_CURRENCY_INVALID_MESSAGE);
    }
  } else {
    currency = currencyForCountry(input.country);
    if (!SUPPORTED_CURRENCIES.has(currency)) currency = 'BRL';
  }
  return { timezone, currency };
}

export const NETWORK_FEE_TYPE_MESSAGE = 'Tipo da taxa de falta inválido. Use PERCENT ou FIXED.';
export const NETWORK_FEE_PERCENT_MESSAGE = 'A taxa de falta percentual vai de 0 a 100.';
export const NETWORK_FEE_FIXED_MESSAGE = 'Taxa de falta inválido';
export const NETWORK_WINDOW_MESSAGE = 'A janela de cancelamento vai de 0 a 72 horas.';
export const NETWORK_POINTS_MESSAGE = 'Pontos por unidade de moeda vão de 0 a 100.';
export const NETWORK_POINT_VALUE_MESSAGE = 'Valor do ponto inválido';
export const NETWORK_BONUS_MESSAGE = 'O bônus de indicação vai de 0 a 100.000 pontos.';
export const NETWORK_YEAR_MESSAGE = 'Ano de fundação inválido.';
export const NETWORK_NAME_MESSAGE = 'O nome da rede pode ter no máximo 120 caracteres.';
export const NETWORK_CITY_MESSAGE = 'A cidade pode ter no máximo 80 caracteres.';
export const NETWORK_DESCRIPTION_MESSAGE = 'A descrição pode ter no máximo 1.000 caracteres.';
export const NETWORK_MISSION_MESSAGE = 'A missão pode ter no máximo 1.000 caracteres.';
export const NETWORK_LOGO_MESSAGE = 'O logo precisa ser um link https.';
export const NETWORK_CURRENCY_LOCKED_MESSAGE =
  'A rede já tem venda registrada nesta moeda. Para trocar, fale com o suporte.';
export const CLUB_CANCEL_FAILED_MESSAGE =
  'Não foi possível cancelar a assinatura do clube. Tente de novo.';
export const PLATFORM_SUSPENDED_BOOKING_MESSAGE =
  'Não é possível agendar online com estes dados. Fale com o suporte da plataforma.';
export const REFUND_SALE_LOCKED_MESSAGE = 'Estorno não pode ser alterado nem apagado.';

export const CLOSED_CASH_SALE_MESSAGE =
  'Essa venda é de um caixa já fechado. Lance a correção no caixa aberto.';

export const PACKAGE_SALE_USED_MESSAGE =
  'Este pacote já teve sessão usada. Estorne o que sobrou em vez de apagar a venda.';
export const GIFT_CARD_SALE_USED_MESSAGE =
  'Este cartão-presente já foi usado. Estorne o que sobrou em vez de apagar a venda.';
export const ISSUED_SALE_VALUE_LOCKED_MESSAGE =
  'O valor de uma venda de pacote ou cartão-presente não pode ser alterado.';
export const NOTHING_LEFT_TO_REFUND_MESSAGE = 'Não sobrou valor para estornar.';
export const SALE_NOT_ISSUED_MESSAGE = 'Esta venda não é de pacote nem de cartão-presente.';
export const PACKAGE_UNUSED_DELETE_MESSAGE =
  'O pacote não foi usado. Apague a venda para cancelar.';
export const GIFT_CARD_UNUSED_DELETE_MESSAGE =
  'O cartão-presente não foi usado. Apague a venda para cancelar.';
export const PACKAGE_CHANGED_MESSAGE = 'O pacote mudou. Tente de novo.';
export const GIFT_CARD_CHANGED_MESSAGE = 'O cartão-presente mudou. Tente de novo.';

/**
 * A edição mexe no que o fechamento do caixa contou? Situação, forma de
 * pagamento, itens, desconto ou acréscimo. Compara com os itens (o total
 * gravado já desconta sinal, cartão-presente e pontos; a tela manda o total
 * cheio)
 */
export function saleMoneyChanged(
  existing: {
    paymentStatus: string;
    paymentMethod: string | null;
    discountAmount: Prisma.Decimal | number | null;
    taxAmount: Prisma.Decimal | number | null;
    items: Array<{ totalPrice: Prisma.Decimal | number }>;
  },
  data: {
    paymentStatus?: string;
    paymentMethod?: string;
    discountAmount?: number;
    taxAmount?: number;
    items?: Array<{ totalPrice: number }>;
  },
): boolean {
  const cents = (v: Prisma.Decimal | number | null | undefined) => Math.round(Number(v ?? 0) * 100);
  const sum = (items: Array<{ totalPrice: Prisma.Decimal | number }>) =>
    items.reduce((acc, i) => acc + cents(i.totalPrice), 0);
  return (
    (data.paymentStatus !== undefined && data.paymentStatus !== existing.paymentStatus) ||
    (data.paymentMethod !== undefined && data.paymentMethod !== existing.paymentMethod) ||
    (data.discountAmount !== undefined &&
      cents(data.discountAmount) !== cents(existing.discountAmount)) ||
    (data.taxAmount !== undefined && cents(data.taxAmount) !== cents(existing.taxAmount)) ||
    (data.items !== undefined && sum(data.items) !== sum(existing.items))
  );
}

/** Pacote e cartão-presente: a edição pode receber o pagamento, mas não muda o valor. */
export function issuedSaleValueChanged(
  existing: {
    saleType: string;
    subtotal: Prisma.Decimal | number;
    discountAmount: Prisma.Decimal | number | null;
    taxAmount: Prisma.Decimal | number | null;
    total: Prisma.Decimal | number;
    items: Array<{ totalPrice: Prisma.Decimal | number }>;
  },
  data: {
    saleType?: string;
    subtotal?: number;
    discountAmount?: number;
    taxAmount?: number;
    total?: number;
    items?: Array<{ totalPrice: number }>;
  },
): boolean {
  const cents = (v: Prisma.Decimal | number | null | undefined) => Math.round(Number(v ?? 0) * 100);
  const sum = (items: Array<{ totalPrice: Prisma.Decimal | number }>) =>
    items.reduce((acc, i) => acc + cents(i.totalPrice), 0);
  return (
    (data.saleType !== undefined && data.saleType !== existing.saleType) ||
    (data.subtotal !== undefined && cents(data.subtotal) !== cents(existing.subtotal)) ||
    (data.discountAmount !== undefined &&
      cents(data.discountAmount) !== cents(existing.discountAmount)) ||
    (data.taxAmount !== undefined && cents(data.taxAmount) !== cents(existing.taxAmount)) ||
    (data.total !== undefined && cents(data.total) !== cents(existing.total)) ||
    (data.items !== undefined && sum(data.items) !== sum(existing.items))
  );
}

/**
 * O que a equipe lança à mão. Pacote, cartão-presente, taxa de falta e
 * estorno nascem nas próprias telas (com o saldo, a taxa ou o estorno ligados)
 */
const STAFF_SALE_TYPES = ['SERVICE', 'PRODUCT', 'MIXED'];
const STAFF_SALE_ITEM_TYPES = ['SERVICE', 'PRODUCT'];
/** Formas de pagamento de venda (só CASH entra na conferência do caixa) */
export const SALE_PAYMENT_METHODS = [
  'CASH',
  'CARD',
  'CREDIT_CARD',
  'DEBIT_CARD',
  'PIX',
  'TRANSFER',
  'OTHER',
];
const STAFF_PAYMENT_STATUSES = ['PENDING', 'PAID'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const SHIFT_INVALID_MESSAGE =
  'Horário da escala inválido (HH:MM, início antes do fim, intervalo dentro do expediente)';
export const SHIFT_DAY_TAKEN_MESSAGE = 'Este dia já tem escala. Edite o dia na escala da semana.';
/** Expediente HH:MM com início antes do fim e intervalo (os dois ou nenhum) dentro dele */
function checkShift(
  start: string,
  end: string,
  breakStart?: string | null,
  breakEnd?: string | null,
) {
  const ok = (t?: string | null) => !!t && HHMM.test(t);
  if (!ok(start) || !ok(end) || start >= end || !!breakStart !== !!breakEnd) {
    throw new BadRequestException(SHIFT_INVALID_MESSAGE);
  }
  if (!breakStart || !breakEnd) return;
  if (
    !ok(breakStart) ||
    !ok(breakEnd) ||
    breakStart >= breakEnd ||
    breakStart <= start ||
    breakEnd >= end
  ) {
    throw new BadRequestException(SHIFT_INVALID_MESSAGE);
  }
}
const COMMISSION_ITEM_TYPES = ['ALL', 'SERVICE', 'PRODUCT'];
export const COMMISSION_ITEM_TYPE_INVALID_MESSAGE = 'Tipo da regra de comissão inválido';
export const COVERED_SESSION_QUANTITY_MESSAGE =
  'A sessão do pacote ou do clube cobre um atendimento: uma linha do serviço, quantidade 1.';
const RESOURCE_TYPES = ['CHAIR', 'ROOM', 'STATION', 'BED'];
const RESOURCE_NAME_MAX = 80;
export const RESOURCE_IN_USE_MESSAGE =
  'Esta sala tem horários marcados. Troque a sala desses horários ou desative-a.';
export const RESOURCE_NAME_INVALID_MESSAGE = 'Informe o nome da sala (até 80 caracteres)';
export const RESOURCE_TYPE_INVALID_MESSAGE = 'Tipo de sala inválido';
function resourceName(value: string | null | undefined) {
  const name = value?.trim() ?? '';
  if (!name || name.length > RESOURCE_NAME_MAX) {
    throw new BadRequestException(RESOURCE_NAME_INVALID_MESSAGE);
  }
  return name;
}
function resourceType(value: string) {
  if (!RESOURCE_TYPES.includes(value)) throw new BadRequestException(RESOURCE_TYPE_INVALID_MESSAGE);
  return value;
}
/** Pacote que pode ganhar a sessão de volta: em uso ou acabado por uso (não cancelado nem devolvido) */
const RESTORABLE_PACKAGE: Prisma.ClientPackageWhereInput = {
  status: { in: ['ACTIVE', 'COMPLETED'] },
  remainderRefundedAt: null,
};
export const TIP_REACHED_PROFESSIONAL_MESSAGE =
  'A caixinha deste atendimento já ficou com o profissional. Apague a caixinha antes de trocar o profissional.';
export const CLUB_USE_IN_SALE_MESSAGE =
  'Esta sessão do clube está numa venda. Apague a venda para desfazer.';
export const CLUB_UNDO_OLD_CYCLE_MESSAGE =
  'Esta sessão é de um ciclo do clube que já acabou: não volta.';
export const NO_SHOW_FEE_NOT_PENDING_MESSAGE =
  'Só dá pra perdoar a taxa pendente. A já cobrada sai apagando a venda dela.';
export const PACKAGE_UNDO_CLOSED_MESSAGE =
  'Este pacote foi cancelado ou teve o restante devolvido: a sessão não volta.';
/** Categorias de despesa (as que o sistema lança também: SALARY e RENT) */
export const EXPENSE_CATEGORIES = [
  'RENT',
  'UTILITIES',
  'SUPPLIES',
  'SALARY',
  'MAINTENANCE',
  'OTHER',
];
export const EXPENSE_CATEGORY_INVALID_MESSAGE = 'Categoria da despesa inválida';
export const EXPENSE_DATE_INVALID_MESSAGE = 'Data da despesa inválida';
export const EXPENSE_DESCRIPTION_INVALID_MESSAGE = 'Descreva a despesa (até 300 caracteres)';
const EXPENSE_DESCRIPTION_MAX = 300;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** "AAAA-MM-DD" que existe no calendário (2026-02-31 não vira março) */
function isCalendarDay(value: string) {
  return DAY_RE.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export const SALE_TYPE_INVALID_MESSAGE = 'Tipo de venda inválido';
export const SALE_ITEM_TYPE_INVALID_MESSAGE = 'Tipo de item inválido';
export const PAYMENT_STATUS_INVALID_MESSAGE = 'Situação de pagamento inválida';
export const PAYMENT_METHOD_INVALID_MESSAGE = 'Forma de pagamento inválida';
export const SALE_TYPE_LOCKED_MESSAGE =
  'O tipo e os itens desta venda não mudam. Apague e lance de novo.';
export const CUSTOMER_HAS_PACKAGES_MESSAGE =
  'Este cliente tem pacote ativo com sessões sobrando. Use as sessões ou devolva o valor antes de apagar a ficha.';
export const SALE_APPOINTMENT_CUSTOMER_MESSAGE =
  'A conta do horário é do cliente do horário. Para outro cliente, registre uma venda separada.';
export const SALE_BELOW_APPLIED_MESSAGE =
  'O valor ficou menor do que já foi pago com sinal, app, cartão-presente ou pontos.';

/**
 * Tipo, itens, situação e forma de pagamento só dos valores conhecidos.
 * Antes era texto livre: dava pra criar um "estorno" que não se apaga,
 * trocar o tipo de uma venda de pacote pra mudar o valor dela, ou gravar
 * "cash" e ficar fora da conferência do caixa. Na edição, o que vem igual ao
 * gravado passa (venda antiga com outra situação continua editável).
 */
export function checkSaleKinds(
  data: {
    saleType?: string;
    items?: Array<{ itemType: string }>;
    paymentStatus?: string;
    paymentMethod?: string | null;
  },
  existing?: { saleType: string; paymentStatus: string; paymentMethod: string | null },
) {
  const lockedType = existing != null && !STAFF_SALE_TYPES.includes(existing.saleType);
  if (data.saleType !== undefined && data.saleType !== existing?.saleType) {
    if (lockedType) throw new BadRequestException(SALE_TYPE_LOCKED_MESSAGE);
    if (!STAFF_SALE_TYPES.includes(data.saleType)) {
      throw new BadRequestException(SALE_TYPE_INVALID_MESSAGE);
    }
  }
  if (data.items !== undefined) {
    if (lockedType) throw new BadRequestException(SALE_TYPE_LOCKED_MESSAGE);
    if (data.items.some((i) => !STAFF_SALE_ITEM_TYPES.includes(i.itemType))) {
      throw new BadRequestException(SALE_ITEM_TYPE_INVALID_MESSAGE);
    }
  }
  if (
    data.paymentStatus !== undefined &&
    data.paymentStatus !== existing?.paymentStatus &&
    !STAFF_PAYMENT_STATUSES.includes(data.paymentStatus)
  ) {
    throw new BadRequestException(PAYMENT_STATUS_INVALID_MESSAGE);
  }
  if (
    data.paymentMethod != null &&
    data.paymentMethod !== existing?.paymentMethod &&
    !SALE_PAYMENT_METHODS.includes(data.paymentMethod)
  ) {
    throw new BadRequestException(PAYMENT_METHOD_INVALID_MESSAGE);
  }
}

/** Faturamento de vendas pagas: o cobrado na hora mais o que já tinha sido pago antes. */
export const SALE_REVENUE_SUM = {
  total: true,
  depositApplied: true,
  prepaidApplied: true,
} as const;
/**
 * O total gravado desconta o sinal e o atendimento pago pelo app; esse
 * dinheiro entrou antes e não está em nenhuma outra venda. Sem somar, um
 * atendimento de 100 com 30 de sinal aparecia como 70 no faturamento.
 */
export function saleRevenue(sum: {
  total: Prisma.Decimal | number | null;
  depositApplied?: Prisma.Decimal | number | null;
  prepaidApplied?: Prisma.Decimal | number | null;
}) {
  return Number(sum.total ?? 0) + Number(sum.depositApplied ?? 0) + Number(sum.prepaidApplied ?? 0);
}

export function assertStaffAppointmentSource(source: string | null | undefined) {
  if (source != null && !(STAFF_APPOINTMENT_SOURCES as readonly string[]).includes(source)) {
    throw new BadRequestException('Origem do agendamento inválida');
  }
}

/** Nome da ficha apagada (e da linha dela no histórico) */
export const REMOVED_CUSTOMER_NAME = 'Cliente removido';

export const SALE_CUSTOMER_LOCKED_MESSAGE =
  'Esta venda usou pontos ou cartão-presente do cliente: o cliente não muda. Apague a venda e lance de novo no cliente certo.';

/**
 * Soma (ou tira) pontos sem deixar o saldo negativo: o cliente pode já ter
 * gastado os pontos que a venda editada ou apagada tinha dado (item 285)
 */
async function addLoyaltyPoints(tx: Prisma.TransactionClient, customerId: number, delta: number) {
  if (delta > 0) {
    await tx.customer.update({
      where: { id: customerId },
      data: { loyaltyPoints: { increment: delta } },
    });
  } else if (delta < 0) {
    await tx.$executeRaw`
      UPDATE "Customer" SET "loyaltyPoints" = GREATEST(0, "loyaltyPoints" + ${delta})
      WHERE id = ${customerId}`;
  }
}

/**
 * Preço de custo (e a margem que sai dele) é do gerente e do dono, como o
 * resto do financeiro. Barbeiro e recepção veem o produto sem ele (item 286).
 */
export function withCostFor<T extends { costPrice: unknown }>(level: AccessLevel, product: T): T {
  return ACCESS_RANK[level] >= ACCESS_RANK.manager ? product : { ...product, costPrice: null };
}

const STAFF_APPOINTMENT_STATUSES = [
  'DRAFT',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
];

@Injectable()
export class BarbershopService {
  private readonly logger = new Logger(BarbershopService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly s3Service: S3Service,
    private readonly whatsappService: WhatsappService,
    private readonly stripeService: StripeService,
    private readonly notificationQueue: NotificationQueueService,
    private readonly realtime: RealtimeService,
    @Optional() private readonly searchCache?: SearchCacheService,
    @Optional()
    @Inject(forwardRef(() => JobOpeningService))
    private readonly jobs?: JobOpeningService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /**
   * Retorna o plano efetivo da barbearia (baseado na assinatura do dono).
   * O dono (ownerUserId) assina o plano; todos (dono + funcionários) acessam os módulos do plano.
   */
  async getBarbershopPlan(barbershopId: number) {
    const barbershop = await this.prisma.barbershop.findUnique({
      where: { id: barbershopId },
      include: {
        ownerUser: {
          include: {
            subscriptions: {
              where: { status: PLANO_STATUS.ACTIVE },
              orderBy: { startSubDate: 'desc' },
              take: 1,
              include: { plan: true },
            },
          },
        },
        network: {
          include: {
            ownerUser: {
              include: {
                subscriptions: {
                  where: { status: PLANO_STATUS.ACTIVE },
                  orderBy: { startSubDate: 'desc' },
                  take: 1,
                  include: { plan: true },
                },
              },
            },
          },
        },
      },
    });
    const ownerUser = barbershop?.ownerUser ?? barbershop?.network?.ownerUser;
    if (!ownerUser) return null;
    const subscription = ownerUser.subscriptions[0];
    return subscription?.plan ?? null;
  }

  /**
   * Verifica se um módulo está disponível para a barbearia conforme o plano do dono.
   */
  async canAccessModule(barbershopId: number, module: BarbershopModule): Promise<boolean> {
    const plan = await this.getBarbershopPlan(barbershopId);
    // Sem assinatura ativa = tratado como plano Basic, não como zero acesso —
    // precisa ficar consistente com getAvailableModules().
    return planIncludesModule(plan?.name ?? '', module);
  }

  /** Lança ForbiddenException se o plano da barbearia não incluir o módulo. */
  private async ensureModuleAccess(barbershopId: number, module: BarbershopModule) {
    const allowed = await this.canAccessModule(barbershopId, module);
    if (!allowed) {
      throw new ForbiddenException(
        `Este recurso não está disponível no seu plano atual. Faça upgrade para acessá-lo.`,
      );
    }
  }

  /** Retorna os módulos disponíveis para a barbearia conforme o plano do dono. */
  async getAvailableModules(barbershopId: number): Promise<string[]> {
    const plan = await this.getBarbershopPlan(barbershopId);
    return getModulesForPlanName(plan?.name ?? '');
  }

  /** Retorna os limites numéricos (unidades, profissionais) do plano do dono. */
  async getPlanLimitsForBarbershop(barbershopId: number) {
    const plan = await this.getBarbershopPlan(barbershopId);
    return getPlanLimits(plan?.name ?? '');
  }

  /** Retorna os limites numéricos do plano de um usuário dono de rede (para criar unidade nova). */
  private async getPlanLimitsForOwner(ownerUserId: number) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { userId: ownerUserId, status: PLANO_STATUS.ACTIVE },
      orderBy: { startSubDate: 'desc' },
      include: { plan: true },
    });
    return getPlanLimits(subscription?.plan?.name ?? '');
  }

  /** Donos da unidade (dela e da rede): quem atende sendo dono não ocupa vaga */
  private async shopOwnerIds(barbershopId: number): Promise<number[]> {
    const shop = await this.prisma.barbershop.findUnique({
      where: { id: barbershopId },
      select: { ownerUserId: true, network: { select: { ownerUserId: true } } },
    });
    return [shop?.ownerUserId, shop?.network?.ownerUserId].filter(
      (id): id is number => typeof id === 'number',
    );
  }

  /**
   * Vagas do plano ocupadas: quem atende clientes (ativo, no período). Quem só
   * administra (recepção, gerente sem agenda) e o dono que atende não contam.
   */
  async countPlanSeats(barbershopId: number) {
    const owners = await this.shopOwnerIds(barbershopId);
    return this.prisma.barber.count({
      where: {
        barbershopId,
        isActive: true,
        AND: [
          // Freelancer com vínculo encerrado não ocupa vaga
          { OR: [{ accessEndsAt: null }, { accessEndsAt: { gte: new Date() } }] },
          BOOKABLE_STAFF,
          ...(owners.length ? [{ OR: [{ userId: null }, { userId: { notIn: owners } }] }] : []),
        ],
      },
    });
  }

  /**
   * Confere se o que a rede do dono usa hoje cabe no plano (unidades e vagas
   * de quem atende). Usado antes de agendar a troca pra um plano menor.
   */
  async assertUsageFitsPlan(ownerUserId: number, planName: string) {
    const limits = getPlanLimits(planName);
    const shops = await this.prisma.barbershop.findMany({
      where: { network: { ownerUserId }, practiceKind: 'shop', closedAt: null },
      select: { id: true, name: true },
    });
    if (shops.length > limits.maxBarbershops) {
      throw new BadRequestException(
        `O plano ${planName} permite ${limits.maxBarbershops} unidade(s) e a rede tem ${shops.length}. Desative unidades antes de trocar.`,
      );
    }
    if (!Number.isFinite(limits.maxBarbersPerShop)) return;
    for (const shop of shops) {
      const used = await this.countPlanSeats(shop.id);
      if (used > limits.maxBarbersPerShop) {
        throw new BadRequestException(
          `O plano ${planName} permite ${limits.maxBarbersPerShop} profissional(is) que atendem por unidade e "${shop.name}" tem ${used}. Ajuste a equipe antes de trocar.`,
        );
      }
    }
  }

  /** Uso das vagas do plano na unidade (null = sem limite) */
  async getPlanSeatUsage(userId: number, barbershopId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const [limits, used] = await Promise.all([
      this.getPlanLimitsForBarbershop(barbershopId),
      this.countPlanSeats(barbershopId),
    ]);
    return {
      used,
      limit: Number.isFinite(limits.maxBarbersPerShop) ? limits.maxBarbersPerShop : null,
    };
  }

  /**
   * Lança BadRequestException se a unidade já estiver no limite do plano — só
   * pra quem vai passar a atender (quem só administra não ocupa vaga).
   */
  async ensureBarberLimitNotExceeded(barbershopId: number) {
    const limits = await this.getPlanLimitsForBarbershop(barbershopId);
    const currentCount = await this.countPlanSeats(barbershopId);
    if (currentCount >= limits.maxBarbersPerShop) {
      throw new BadRequestException(
        `Seu plano permite no máximo ${limits.maxBarbersPerShop} profissional(is) que atendem por unidade — quem só administra (recepção, gerente sem agenda) não conta. Faça upgrade para adicionar mais.`,
      );
    }
  }

  /**
   * Acesso do usuário à unidade, com o nível mínimo que a operação exige:
   * - 'barber'  → qualquer pessoa da equipe (atender: agenda, venda, cliente)
   * - 'manager' → gerente ou dono (operar a unidade: preços, equipe, caixa…)
   * - 'owner'   → só o dono (financeiro, apagar unidade, regras de comissão)
   * Antes qualquer barbeiro tinha o poder do dono — inclusive quem já tinha
   * sido desligado (isActive=false) continuava entrando.
   */
  private async ensureBarbershopAccess(
    userId: number,
    barbershopId: number,
    min: AccessLevel = 'barber',
  ) {
    const barbershop = await this.prisma.barbershop.findFirst({
      where: { id: barbershopId },
      include: { network: true },
    });
    if (!barbershop) {
      throw new ForbiddenException('Unidade não encontrada');
    }
    const level = await this.accessLevelOf(userId, barbershop);
    if (!level) {
      throw new ForbiddenException('Você não tem acesso a esta unidade');
    }
    if (ACCESS_RANK[level] < ACCESS_RANK[min]) {
      throw new ForbiddenException('Seu cargo nesta unidade não permite essa ação.');
    }
    return Object.assign(barbershop, {
      accessLevel: level,
      network: networkMoneyRules(barbershop, barbershop.network),
    });
  }

  /** Cargo do usuário na unidade (null = sem acesso). */
  private async accessLevelOf(
    userId: number,
    barbershop: {
      id: number;
      ownerUserId: number | null;
      closedAt?: Date | null;
      network?: { ownerUserId: number } | null;
    },
  ): Promise<AccessLevel | null> {
    // Encerrada: ninguém mais mexe (o histórico fica só pra consulta da plataforma)
    if (barbershop.closedAt) return null;
    if (barbershop.ownerUserId === userId || barbershop.network?.ownerUserId === userId) {
      return 'owner';
    }
    const staff = await this.prisma.barber.findFirst({
      where: { barbershopId: barbershop.id, userId, ...currentEngagement() },
      select: { staffType: true },
    });
    if (!staff) return null;
    return isStaffType(staff.staffType) ? staff.staffType : 'barber';
  }

  /** Mesmo controle, pra quem está fora deste service (fotos, redes sociais…). */
  async ensureAccess(userId: number, barbershopId: number, min: AccessLevel = 'barber') {
    return this.ensureBarbershopAccess(userId, barbershopId, min);
  }

  /** Cargo do usuário na unidade — o front usa pra mostrar só o que ele pode. */
  async getMyAccessLevel(userId: number, barbershopId: number): Promise<AccessLevel | null> {
    const barbershop = await this.prisma.barbershop.findFirst({
      where: { id: barbershopId },
      include: { network: true },
    });
    return barbershop ? this.accessLevelOf(userId, barbershop) : null;
  }

  /**
   * Horário/folga de um barbeiro: gerente e dono mexem em qualquer um; o
   * barbeiro (e o básico), só no próprio. Recepção não mexe em horário.
   */
  /** Agendar/cancelar pra um profissional: barbeiro só na própria agenda. */
  async ensureCanBookForBarber(userId: number, barbershopId: number, barberId: number) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'basic');
    const ownBarberId = await this.ownBarberIdIfBarber(userId, barbershop);
    if (ownBarberId !== null && barberId !== ownBarberId) {
      throw new ForbiddenException('Seu cargo só permite agendar na sua própria agenda.');
    }
    await this.ensureBarberOfBarbershop(barbershopId, barberId);
    return barbershop;
  }

  /** Escala semanal: gerente e dono de qualquer um; o profissional, só a dele. */
  ensureCanManageBarberSchedule(userId: number, barbershopId: number, barberId: number) {
    return this.ensureCanManageBarber(userId, barbershopId, barberId);
  }

  private async ensureCanManageBarber(userId: number, barbershopId: number, barberId: number) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'basic');
    if (ACCESS_RANK[barbershop.accessLevel] >= ACCESS_RANK.manager) return barbershop;
    const own = await this.prisma.barber.findFirst({
      where: { id: barberId, barbershopId, userId, isActive: true },
      select: { id: true },
    });
    if (!own) {
      throw new ForbiddenException('Seu cargo só permite mexer na sua própria agenda.');
    }
    return barbershop;
  }

  /**
   * Como no Booksy: barbeiro e barbeiro básico veem e mexem só na própria
   * agenda. Devolve o id de barbeiro dele (null pra recepção, gerente e dono,
   * que veem todas).
   */
  private async ownBarberIdIfBarber(
    userId: number,
    barbershop: { id: number; accessLevel: AccessLevel },
  ): Promise<number | null> {
    if (!OWN_AGENDA_ONLY.includes(barbershop.accessLevel)) return null;
    const me = await this.prisma.barber.findFirst({
      where: { barbershopId: barbershop.id, userId, isActive: true },
      select: { id: true },
    });
    return me?.id ?? -1;
  }

  /**
   * Profissional que só vê a própria agenda (barbeiro e básico): o cadastro
   * dele na unidade (-1 se não tiver um ativo). null pra quem vê todas.
   */
  ownAgendaBarberId(userId: number, barbershop: { id: number; accessLevel: AccessLevel }) {
    return this.ownBarberIdIfBarber(userId, barbershop);
  }

  /** Barbeiro: agendamento de outro barbeiro não existe pra ele. */
  private ensureOwnAppointment(ownBarberId: number | null, appointment: { barberId: number }) {
    if (ownBarberId !== null && appointment.barberId !== ownBarberId) {
      throw new NotFoundException('Agendamento não encontrado');
    }
  }

  /**
   * De quais clientes a pessoa vê telefone e e-mail (como no Booksy):
   * recepção, gerente e dono, de todos; barbeiro, só dos que já agendaram com
   * ele; barbeiro básico, de nenhum.
   */
  private async contactVisibility(
    userId: number,
    barbershop: { id: number; accessLevel: AccessLevel },
  ): Promise<(customerId: number | null | undefined) => boolean> {
    if (ACCESS_RANK[barbershop.accessLevel] >= ACCESS_RANK.reception) return () => true;
    if (barbershop.accessLevel === 'basic') return () => false;
    const own = await this.ownBarberIdIfBarber(userId, barbershop);
    const mine = await this.prisma.appointment.findMany({
      where: { barberId: own ?? -1 },
      select: { customerId: true },
      distinct: ['customerId'],
    });
    const ids = new Set(mine.map((a) => a.customerId));
    return (customerId) => customerId != null && ids.has(customerId);
  }

  private hideContact<
    T extends { id: number; phone?: string | null; email?: string | null } | null,
  >(canSee: (customerId: number) => boolean, customer: T): T {
    if (!customer || canSee(customer.id)) return customer;
    return { ...customer, phone: '', email: null };
  }

  private hideAppointmentContact<T extends { customer?: any }>(
    canSee: (customerId: number) => boolean,
    appt: T,
  ): T {
    return appt?.customer ? { ...appt, customer: this.hideContact(canSee, appt.customer) } : appt;
  }

  private hideWalkInContact<
    T extends { customerId?: number | null; customerPhone?: string | null; customer?: any },
  >(canSee: (customerId: number | null | undefined) => boolean, walkIn: T): T {
    if (!walkIn || canSee(walkIn.customerId)) return walkIn;
    return { ...this.hideAppointmentContact(canSee, walkIn), customerPhone: null };
  }

  /** Verifica acesso à barbearia (usado por EmployeeInviteService). */
  async verifyBarbershopAccess(userId: number, barbershopId: number) {
    return this.ensureBarbershopAccess(userId, barbershopId, 'manager');
  }

  /** Encontra ou cria a rede do usuário (uma rede por dono). */
  private async findOrCreateNetwork(userId: number) {
    // Trava por dono: dois cadastros ao mesmo tempo não criam duas redes
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`network-owner:${userId}`}))`;
      const existing = await tx.network.findFirst({ where: { ownerUserId: userId } });
      if (existing) return existing;
      return tx.network.create({ data: { ownerUserId: userId } });
    });
  }

  // ============ NETWORK (FRANQUIA) ============

  async getMyNetwork(userId: number) {
    return this.prisma.network.findFirst({
      where: { ownerUserId: userId },
    });
  }

  /** Valida contra as cores do Radix Themes; vazio/null volta ao padrão. */
  private normalizeThemeColor(value: string | null, allowed: readonly string[], label: string) {
    if (value == null || value.trim() === '') return null;
    const v = value.trim();
    if (!allowed.includes(v)) throw new BadRequestException(`${label} inválida: ${v}`);
    return v;
  }

  /**
   * Cores da franquia do usuário: a rede que ele possui, ou a rede da
   * barbearia onde trabalha (Barber.userId). Só o dono pode editar.
   */
  async getMyNetworkTheme(userId: number) {
    const owned = await this.prisma.network.findFirst({ where: { ownerUserId: userId } });
    const network =
      owned ??
      (
        await this.prisma.barber.findFirst({
          where: { userId, ...currentEngagement() },
          select: { barbershop: { select: { network: true } } },
        })
      )?.barbershop.network;
    if (!network) return null;
    // Mesma regra do NetworkResolver.logoUrl: upload no S3 (URL assinada)
    // tem prioridade sobre uma URL externa salva direto
    const logoUrl = network.logoKey
      ? await this.s3Service.getDownloadUrl(network.logoKey)
      : network.logoUrl ?? null;
    return {
      networkId: network.id,
      name: network.name,
      logoUrl,
      accentColor: network.accentColor,
      grayColor: network.grayColor,
      canEdit: network.ownerUserId === userId,
    };
  }

  async updateNetwork(
    userId: number,
    data: Partial<{
      name: string;
      logoUrl: string;
      logoKey: string;
      currency: string;
      city: string;
      description: string;
      mission: string;
      foundationYear: number;
      loyaltyEnabled: boolean;
      loyaltyPointsPerCurrencyUnit: number;
      loyaltyPointValue: number;
      referralBonusPoints: number;
      noShowFeeEnabled: boolean;
      noShowFeeType: string;
      noShowFeeValue: number;
      lateCancellationWindowHours: number;
      accentColor: string;
      grayColor: string;
    }>,
  ) {
    const network = await this.getMyNetwork(userId);
    if (!network) throw new NotFoundException('Franquia não encontrada');
    const updateData: Record<string, unknown> = { ...data };
    await this.applyNetworkLimits(network, updateData);
    if (data.accentColor !== undefined) {
      updateData.accentColor = this.normalizeThemeColor(
        data.accentColor,
        NETWORK_ACCENT_COLORS,
        'Cor de destaque',
      );
    }
    if (data.grayColor !== undefined) {
      updateData.grayColor = this.normalizeThemeColor(
        data.grayColor,
        NETWORK_GRAY_COLORS,
        'Tom de cinza',
      );
    }
    return this.prisma.network.update({
      where: { id: network.id },
      data: updateData,
    });
  }

  /** Regras da rede: nada fora do limite vira política, moeda ou logo público. */
  private async applyNetworkLimits(
    network: { id: number; currency: string; noShowFeeType: string | null },
    data: Record<string, unknown>,
  ) {
    const text = (key: string, max: number, message: string) => {
      if (data[key] === undefined) return;
      const value = String(data[key] ?? '').trim();
      if (!value) {
        data[key] = null;
        return;
      }
      if (value.length > max) throw new BadRequestException(message);
      data[key] = value;
    };
    text('name', 120, NETWORK_NAME_MESSAGE);
    text('city', 80, NETWORK_CITY_MESSAGE);
    text('description', 1000, NETWORK_DESCRIPTION_MESSAGE);
    text('mission', 1000, NETWORK_MISSION_MESSAGE);

    if (data.foundationYear !== undefined) {
      const year = Number(data.foundationYear);
      const maxYear = new Date().getFullYear();
      if (!Number.isInteger(year) || year < 1800 || year > maxYear) {
        throw new BadRequestException(NETWORK_YEAR_MESSAGE);
      }
    }

    if (data.logoUrl !== undefined) {
      const raw = String(data.logoUrl ?? '').trim();
      if (!raw) {
        data.logoUrl = null;
      } else {
        let url: URL;
        try {
          url = new URL(raw);
        } catch {
          throw new BadRequestException(NETWORK_LOGO_MESSAGE);
        }
        if (url.protocol !== 'https:' || raw.length > 2000) {
          throw new BadRequestException(NETWORK_LOGO_MESSAGE);
        }
        data.logoUrl = raw;
      }
      data.logoKey = null;
    }

    let currency = network.currency.trim().toUpperCase();
    if (data.currency !== undefined) {
      currency = String(data.currency).trim().toUpperCase();
      if (!SUPPORTED_CURRENCIES.has(currency)) {
        throw new BadRequestException(SHOP_CURRENCY_INVALID_MESSAGE);
      }
      if (currency !== network.currency.trim().toUpperCase()) {
        const sales = await this.prisma.sale.count({
          where: { paymentStatus: 'PAID', barbershop: { networkId: network.id } },
          take: 1,
        });
        if (sales > 0) throw new BadRequestException(NETWORK_CURRENCY_LOCKED_MESSAGE);
      }
      data.currency = currency;
    }

    const feeType =
      data.noShowFeeType !== undefined
        ? String(data.noShowFeeType).trim().toUpperCase()
        : network.noShowFeeType;
    if (data.noShowFeeType !== undefined) {
      if (feeType !== 'PERCENT' && feeType !== 'FIXED') {
        throw new BadRequestException(NETWORK_FEE_TYPE_MESSAGE);
      }
      data.noShowFeeType = feeType;
    }
    if (data.noShowFeeValue !== undefined) {
      const value = Number(data.noShowFeeValue);
      if (feeType === 'PERCENT') {
        if (!Number.isFinite(value) || value < 0 || value > 100) {
          throw new BadRequestException(NETWORK_FEE_PERCENT_MESSAGE);
        }
      } else if (feeType === 'FIXED') {
        try {
          checkMoney('Taxa de falta', value, currency);
        } catch (err) {
          if (err instanceof BadRequestException) {
            throw new BadRequestException(NETWORK_FEE_FIXED_MESSAGE);
          }
          throw err;
        }
      } else {
        throw new BadRequestException(NETWORK_FEE_TYPE_MESSAGE);
      }
      data.noShowFeeValue = value;
    }

    if (data.lateCancellationWindowHours !== undefined) {
      const hours = Number(data.lateCancellationWindowHours);
      if (!Number.isInteger(hours) || hours < 0 || hours > 72) {
        throw new BadRequestException(NETWORK_WINDOW_MESSAGE);
      }
    }
    if (data.loyaltyPointsPerCurrencyUnit !== undefined) {
      const points = Number(data.loyaltyPointsPerCurrencyUnit);
      if (!Number.isFinite(points) || points < 0 || points > 100) {
        throw new BadRequestException(NETWORK_POINTS_MESSAGE);
      }
    }
    if (data.loyaltyPointValue !== undefined) {
      const pointValue = Number(data.loyaltyPointValue);
      if (!Number.isFinite(pointValue) || pointValue < 0 || pointValue > moneyCap(100, currency)) {
        throw new BadRequestException(NETWORK_POINT_VALUE_MESSAGE);
      }
    }
    if (data.referralBonusPoints !== undefined) {
      const bonus = Number(data.referralBonusPoints);
      if (!Number.isInteger(bonus) || bonus < 0 || bonus > 100_000) {
        throw new BadRequestException(NETWORK_BONUS_MESSAGE);
      }
    }
  }

  private emptyDashboard(currency = 'BRL') {
    return {
      view: 'empty',
      totalBarbers: 0,
      totalBarbershops: 0,
      totalServicesDone: 0,
      totalProductsSold: 0,
      revenueThisMonth: 0,
      revenueSamePeriodLastMonth: 0,
      currency,
      monthlyRevenue: [] as {
        month: string;
        monthIndex: number;
        year: number;
        total: number;
        currency: string;
      }[],
      revenueThisMonthByCurrency: [] as { currency: string; amount: number }[],
      revenueSamePeriodLastMonthByCurrency: [] as { currency: string; amount: number }[],
      recentEvents: [] as Array<{
        id: string;
        type: string;
        date: string;
        title: string;
        subtitle?: string;
        value?: number;
        customerName?: string;
        saleId?: number;
      }>,
      appointmentsToday: 0,
      revenueToday: 0,
      revenueTodayByCurrency: [] as { currency: string; amount: number }[],
      showRevenueToday: false,
      canSell: false,
      walkInsWaiting: 0,
      showQueue: false,
      upcomingAppointments: [] as Array<{
        id: string;
        type: string;
        date: string;
        title: string;
        subtitle?: string;
        customerName?: string;
      }>,
      revenueByBarbershop: [] as Array<{
        id: number;
        name: string;
        total: number;
        currency: string;
      }>,
    };
  }

  private appointmentDashboardEvent(
    a: {
      id: number;
      startAt: Date;
      endAt: Date;
      status: string;
      notes: string | null;
      barbershopId: number;
      barbershop: { name: string };
      customer: { name: string } | null;
      barber: { name: string } | null;
      services?: Array<{ service: { name: string } | null }>;
    },
    idPrefix: string,
  ) {
    const customerName = a.customer?.name ?? '-';
    const barberName = a.barber?.name ?? '-';
    const serviceNames = (a.services ?? [])
      .map((s) => s.service?.name)
      .filter((n): n is string => !!n);
    return {
      id: `${idPrefix}-${a.id}`,
      type: 'appointment',
      date: a.startAt,
      title: idPrefix === 'next' ? customerName : `Agendamento: ${customerName}`,
      subtitle: [a.barbershop.name, barberName, serviceNames.join(', ')]
        .filter(Boolean)
        .join(' • '),
      customerName,
      appointmentId: a.id,
      barbershopId: a.barbershopId,
      barbershopName: a.barbershop.name,
      barberName,
      status: a.status,
      endAt: a.endAt.toISOString(),
      notes: a.notes || undefined,
      serviceNames,
      itemLines: [] as string[],
    };
  }

  private saleDashboardEvent(s: {
    id: number;
    createdAt: Date;
    total: { toString(): string } | number;
    paymentMethod: string | null;
    paymentStatus: string;
    barbershopId: number;
    barbershop: { name: string; currency?: string | null };
    barber: { name: string } | null;
    customer: { name: string } | null;
    items?: Array<{
      quantity: number;
      product: { name: string } | null;
      service: { name: string } | null;
    }>;
  }) {
    const barberName = s.barber?.name ?? '-';
    const itemLines = (s.items ?? []).map((item) => {
      const name = item.product?.name ?? item.service?.name ?? '-';
      return item.quantity > 1 ? `${name} × ${item.quantity}` : name;
    });
    return {
      id: `sale-${s.id}`,
      type: 'sale',
      date: s.createdAt,
      title: `Venda #${s.id}`,
      subtitle: `${s.barbershop.name} • ${barberName}`,
      value: Number(s.total),
      customerName: s.customer?.name ?? undefined,
      saleId: s.id,
      barbershopId: s.barbershopId,
      barbershopName: s.barbershop.name,
      currency: s.barbershop.currency || undefined,
      barberName,
      status: s.paymentStatus,
      paymentMethod: s.paymentMethod ?? undefined,
      serviceNames: [] as string[],
      itemLines,
    };
  }

  /**
   * Números do dia, no fuso da primeira unidade. `barberIds` null = agenda
   * de todos; lista = só esses profissionais. `revenueBarberIds` null = vendas
   * da unidade; lista vazia = não soma faturamento.
   */
  private async dashboardPulse(
    shops: { id: number; timezone: string | null; currency?: string | null }[],
    opts: {
      barberIds: number[] | null;
      revenueBarberIds: number[] | null;
      includeQueue: boolean;
    },
  ) {
    const now = new Date();
    const shopIds = shops.map((s) => s.id);
    const barberFilter = opts.barberIds ? { barberId: { in: opts.barberIds } } : {};
    const groups = localeGroups(
      shops.map((shop) => ({ ...shop, currency: shop.currency ?? null })),
    );
    const skipRevenue = opts.revenueBarberIds != null && opts.revenueBarberIds.length === 0;

    const [perGroup, walkInsWaiting, upcoming] = await Promise.all([
      Promise.all(
        groups.map(async (group) => {
          const today = toZonedParts(now, group.timeZone).dateStr;
          const start = zonedTimeToUtc(today, 0, group.timeZone);
          const end = zonedTimeToUtc(nextDateStr(today), 0, group.timeZone);
          const [count, revenueAgg] = await Promise.all([
            this.prisma.appointment.count({
              where: {
                barbershopId: { in: group.ids },
                ...barberFilter,
                startAt: { gte: start, lt: end },
                status: { in: ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] },
              },
            }),
            skipRevenue
              ? Promise.resolve(null)
              : this.prisma.sale.aggregate({
                  where: {
                    barbershopId: { in: group.ids },
                    paymentStatus: 'PAID',
                    ...paidInRange({ gte: start, lt: end }),
                    ...(opts.revenueBarberIds ? { barberId: { in: opts.revenueBarberIds } } : {}),
                  },
                  _sum: SALE_REVENUE_SUM,
                }),
          ]);
          return {
            count,
            currency: group.currency,
            revenue: revenueAgg ? saleRevenue(revenueAgg._sum) : 0,
          };
        }),
      ),
      opts.includeQueue
        ? this.prisma.walkIn.count({
            // Só a fila de hoje de cada unidade
            where: {
              status: 'WAITING',
              OR: shops.map((shop) => ({
                barbershopId: shop.id,
                createdAt: { gte: queueDayStart(shop.timezone, now) },
              })),
            },
          })
        : Promise.resolve(0),
      this.prisma.appointment.findMany({
        where: {
          barbershopId: { in: shopIds },
          ...barberFilter,
          startAt: { gte: now },
          status: { in: ['CONFIRMED', 'IN_PROGRESS'] },
        },
        orderBy: { startAt: 'asc' },
        take: 6,
        include: {
          barbershop: { select: { name: true } },
          customer: { select: { name: true } },
          barber: { select: { name: true } },
          services: { include: { service: { select: { name: true } } } },
        },
      }),
    ]);

    const revenueTodayByCurrency = moneyByCurrency(
      perGroup.map((group) => ({ currency: group.currency, amount: group.revenue })),
    );
    return {
      appointmentsToday: perGroup.reduce((sum, group) => sum + group.count, 0),
      revenueToday: revenueTodayByCurrency.length === 1 ? revenueTodayByCurrency[0].amount : 0,
      revenueTodayByCurrency,
      walkInsWaiting,
      upcomingAppointments: upcoming.map((a) => {
        const event = this.appointmentDashboardEvent(a, 'next');
        return { ...event, date: event.date.toISOString() };
      }),
    };
  }

  /** Agenda e vendas recentes, restritas aos profissionais quando `barberIds` vem preenchido. */
  private async scopedRecentEvents(shopIds: number[], barberIds: number[] | null) {
    const barberFilter = barberIds ? { barberId: { in: barberIds } } : {};
    const [recentAppointments, recentSales] = await Promise.all([
      // Atividade recente: o que já aconteceu (o futuro está em "Próximos horários")
      this.prisma.appointment.findMany({
        where: { barbershopId: { in: shopIds }, ...barberFilter, startAt: { lte: new Date() } },
        orderBy: { startAt: 'desc' },
        take: 8,
        include: {
          barbershop: { select: { name: true } },
          customer: { select: { name: true } },
          barber: { select: { name: true } },
          services: { include: { service: { select: { name: true } } } },
        },
      }),
      this.prisma.sale.findMany({
        where: {
          barbershopId: { in: shopIds },
          paymentStatus: 'PAID',
          ...barberFilter,
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: {
          barbershop: { select: { name: true, currency: true } },
          customer: { select: { name: true } },
          barber: { select: { name: true } },
          items: {
            include: { product: { select: { name: true } }, service: { select: { name: true } } },
          },
        },
      }),
    ]);
    const events = [
      ...recentAppointments.map((a) => this.appointmentDashboardEvent(a, 'apt')),
      ...recentSales.map((s) => this.saleDashboardEvent(s)),
    ];
    events.sort((a, b) => b.date.getTime() - a.date.getTime());
    return events.slice(0, 12).map((e) => ({ ...e, date: e.date.toISOString() }));
  }

  /**
   * Quem não é dono nem gerente não vê o faturamento histórico da unidade.
   * Recepção vê o dia inteiro (agenda, fila e caixa). Profissional vê só o
   * próprio. Básico não vê fila nem vendas.
   */
  private async staffDashboard(userId: number, barbershopId?: number) {
    const staff = await this.prisma.barber.findMany({
      where: {
        userId,
        ...currentEngagement(),
        ...(barbershopId != null ? { barbershopId } : {}),
      },
      select: {
        id: true,
        staffType: true,
        barbershop: { select: { id: true, name: true, timezone: true, currency: true } },
      },
    });
    if (staff.length === 0) return this.emptyDashboard();

    const levelOf = (staffType: string | null): AccessLevel =>
      isStaffType(staffType) ? staffType : 'barber';
    const shopsOf = (rows: typeof staff) => {
      const map = new Map<number, (typeof staff)[number]['barbershop']>();
      for (const row of rows) map.set(row.barbershop.id, row.barbershop);
      return [...map.values()];
    };

    const desk = staff.filter((s) => levelOf(s.staffType) === 'reception');
    if (desk.length > 0) {
      const shops = shopsOf(desk);
      const pulse = await this.dashboardPulse(shops, {
        barberIds: null,
        revenueBarberIds: null,
        includeQueue: true,
      });
      const recentEvents = await this.scopedRecentEvents(
        shops.map((s) => s.id),
        null,
      );
      return {
        ...this.emptyDashboard(shops[0].currency || 'BRL'),
        view: 'desk',
        showQueue: true,
        canSell: true,
        ...pulse,
        // Recepção: o caixa do dia sim, o resumo financeiro não
        showRevenueToday: false,
        revenueToday: 0,
        recentEvents,
      };
    }

    const own = staff.filter((s) => OWN_AGENDA_ONLY.includes(levelOf(s.staffType)));
    if (own.length === 0) return this.emptyDashboard();
    const billable = own.filter((s) => levelOf(s.staffType) !== 'basic');
    const shops = shopsOf(own);
    const pulse = await this.dashboardPulse(shops, {
      barberIds: own.map((s) => s.id),
      revenueBarberIds: billable.map((s) => s.id),
      includeQueue: billable.length > 0,
    });
    const recentEvents = await this.scopedRecentEvents(
      shops.map((s) => s.id),
      own.map((s) => s.id),
    );
    return {
      ...this.emptyDashboard(shops[0].currency || 'BRL'),
      view: 'mine',
      showRevenueToday: billable.length > 0,
      showQueue: billable.length > 0,
      canSell: billable.length > 0,
      ...pulse,
      recentEvents,
    };
  }

  /** Faturamento do mês, do mês anterior e dos últimos 6 meses, por fuso e por moeda. */
  private async networkMoney(
    shops: { id: number; name: string; timezone: string | null; currency: string }[],
  ) {
    const now = new Date();
    const currentRows: { currency: string; amount: number }[] = [];
    const previousRows: { currency: string; amount: number }[] = [];
    const byShop = new Map<number, number>();
    const monthly = new Map<
      string,
      { month: string; monthIndex: number; year: number; total: number; currency: string }[]
    >();

    for (const group of localeGroups(shops)) {
      const [year, month] = toZonedParts(now, group.timeZone).dateStr.split('-').map(Number);
      const startOfMonth = monthRangeUtc(year, month, group.timeZone).start;
      const [prevYear, prevMonth] = month === 1 ? [year - 1, 12] : [year, month - 1];
      const prevRange = monthRangeUtc(prevYear, prevMonth, group.timeZone);
      const elapsedMs = now.getTime() - startOfMonth.getTime();
      const prevUntil = new Date(
        Math.min(prevRange.start.getTime() + elapsedMs, prevRange.end.getTime()),
      );
      const paid = (range: Prisma.DateTimeFilter) =>
        this.prisma.sale.aggregate({
          where: {
            barbershopId: { in: group.ids },
            paymentStatus: 'PAID',
            ...paidInRange(range),
          },
          _sum: SALE_REVENUE_SUM,
        });
      const [current, previous, shopRows] = await Promise.all([
        paid({ gte: startOfMonth }),
        paid({ gte: prevRange.start, lt: prevUntil }),
        this.prisma.sale.groupBy({
          by: ['barbershopId'],
          where: {
            barbershopId: { in: group.ids },
            paymentStatus: 'PAID',
            ...paidInRange({ gte: startOfMonth }),
          },
          _sum: SALE_REVENUE_SUM,
        }),
      ]);
      currentRows.push({ currency: group.currency, amount: saleRevenue(current._sum) });
      previousRows.push({ currency: group.currency, amount: saleRevenue(previous._sum) });
      for (const row of shopRows) byShop.set(row.barbershopId, saleRevenue(row._sum));

      const series = monthly.get(group.currency) ?? [];
      monthly.set(group.currency, series);
      for (let i = 5; i >= 0; i--) {
        const { start, end } = monthRangeUtc(year, month - i, group.timeZone);
        const amount = saleRevenue((await paid({ gte: start, lt: end }))._sum);
        const index = 5 - i;
        if (!series[index]) {
          const label = new Date(Date.UTC(year, month - 1 - i, 15));
          series[index] = {
            month: label.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
            monthIndex: label.getUTCMonth(),
            year: label.getUTCFullYear(),
            total: 0,
            currency: group.currency,
          };
        }
        series[index].total += amount;
      }
    }

    const revenueThisMonthByCurrency = moneyByCurrency(currentRows);
    const revenueSamePeriodLastMonthByCurrency = moneyByCurrency(previousRows);
    const single = revenueThisMonthByCurrency.length <= 1;
    const currency = single
      ? revenueThisMonthByCurrency[0]?.currency ?? shops[0]?.currency ?? 'BRL'
      : shops[0]?.currency ?? 'BRL';
    const previousOf = new Map(
      revenueSamePeriodLastMonthByCurrency.map((row) => [row.currency, row.amount]),
    );
    return {
      currency,
      revenueThisMonth: single ? revenueThisMonthByCurrency[0]?.amount ?? 0 : 0,
      revenueSamePeriodLastMonth: single ? previousOf.get(currency) ?? 0 : 0,
      revenueThisMonthByCurrency,
      revenueSamePeriodLastMonthByCurrency,
      monthlyRevenue: [...monthly.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .flatMap(([, points]) => points),
      revenueByBarbershop: shops
        .map((shop) => ({
          id: shop.id,
          name: shop.name,
          total: byShop.get(shop.id) ?? 0,
          currency: shop.currency || 'BRL',
        }))
        .sort((a, b) => b.total - a.total),
    };
  }

  /** Dashboard stats agregados para dono da franquia. Com `barbershopId`, só essa unidade. */
  async getNetworkDashboardStats(userId: number, barbershopId?: number | null) {
    // Faturamento da rede: só as unidades onde a pessoa é dona ou gerente
    // (antes o barbeiro via o faturamento de todas onde trabalha)
    const barbershops = await this.prisma.barbershop.findMany({
      where: {
        ...(barbershopId != null ? { id: barbershopId } : {}),
        closedAt: null,
        OR: [
          { ownerUserId: userId },
          { network: { ownerUserId: userId } },
          { barbers: { some: { userId, staffType: 'manager', ...currentEngagement() } } },
        ],
      },
    });
    const barbershopIds = barbershops.map((b) => b.id);
    if (barbershopIds.length === 0) {
      return this.staffDashboard(userId, barbershopId ?? undefined);
    }

    // Total barbers (funcionários)
    const totalBarbers = await this.prisma.barber.count({
      where: {
        barbershopId: { in: barbershopIds },
        isActive: true,
      },
    });

    // Serviços realizados (ServiceHistory)
    const totalServicesDone = await this.prisma.serviceHistory.count({
      where: { barbershopId: { in: barbershopIds } },
    });

    // Produtos vendidos (SaleItem onde itemType = PRODUCT)
    const productsSoldResult = await this.prisma.saleItem.aggregate({
      where: {
        itemType: 'PRODUCT',
        sale: { barbershopId: { in: barbershopIds } },
      },
      _sum: { quantity: true },
    });
    const totalProductsSold = productsSoldResult._sum.quantity ?? 0;

    const money = await this.networkMoney(barbershops);

    // Últimos eventos (appointments + sales, ordenados por data)
    const [recentAppointments, recentSales] = await Promise.all([
      // Atividade recente: o que já aconteceu (o futuro está em "Próximos horários")
      this.prisma.appointment.findMany({
        where: { barbershopId: { in: barbershopIds }, startAt: { lte: new Date() } },
        orderBy: { startAt: 'desc' },
        take: 10,
        include: {
          barbershop: { select: { name: true } },
          customer: { select: { name: true } },
          barber: { select: { name: true } },
          services: { include: { service: { select: { name: true } } } },
        },
      }),
      this.prisma.sale.findMany({
        where: {
          barbershopId: { in: barbershopIds },
          paymentStatus: 'PAID',
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          barbershop: { select: { name: true, currency: true } },
          customer: { select: { name: true } },
          barber: { select: { name: true } },
          items: {
            include: { product: { select: { name: true } }, service: { select: { name: true } } },
          },
        },
      }),
    ]);

    const events = [
      ...recentAppointments.map((a) => this.appointmentDashboardEvent(a, 'apt')),
      ...recentSales.map((s) => this.saleDashboardEvent(s)),
    ];

    events.sort((a, b) => b.date.getTime() - a.date.getTime());
    const recentEvents = events.slice(0, 15).map((e) => ({
      ...e,
      date: e.date.toISOString(),
    }));

    const pulse = await this.dashboardPulse(barbershops, {
      barberIds: null,
      revenueBarberIds: null,
      includeQueue: true,
    });

    return {
      view: 'network',
      totalBarbers,
      totalBarbershops: barbershops.length,
      totalServicesDone,
      totalProductsSold,
      ...money,
      recentEvents,
      showRevenueToday: true,
      showQueue: true,
      canSell: true,
      ...pulse,
    };
  }

  // ============ BARBERSHOP ============

  /** Tipo de estabelecimento válido; vazio = não informado */
  private parseBusinessType(value: string | null | undefined): BusinessType | undefined {
    if (value == null || value === '') return undefined;
    if (!isBusinessType(value)) {
      throw new BadRequestException(`Tipo de estabelecimento inválido: ${value}`);
    }
    return value;
  }

  async createBarbershop(
    userId: number,
    data: {
      name: string;
      slug: string;
      address: string;
      complement1?: string;
      complement2?: string;
      city: string;
      state: string;
      country: string;
      postalCode: string;
      phone: string;
      email: string;
      timezone?: string;
      currency?: string;
      /** JSON dos 7 dias. Ausente: a unidade fica no horário padrão. */
      businessHours?: string;
      businessType?: string;
      /** false: o dono administra e não entra na agenda. Ausente: entra, como hoje. */
      ownerTakesAppointments?: boolean;
    },
  ) {
    const businessType = this.parseBusinessType(data.businessType) ?? DEFAULT_BUSINESS_TYPE;
    // Mesma conferência da tela de horário. Vazio deixa o padrão.
    const businessHours = data.businessHours?.trim()
      ? normalizeBusinessHours(data.businessHours)
      : undefined;
    // Mesmas regras da edição: endereço da página, textos, fuso e moeda.
    const slug = normalizeShopSlug(data.slug);
    const texts = normalizeShopTexts(data, true);
    const locale = resolveShopLocale({
      timezone: data.timezone,
      currency: data.currency,
      country: String(texts.country),
      state: texts.state,
    });
    const existing = await this.prisma.barbershop.findUnique({
      where: { slug },
    });
    if (existing) {
      throw new BadRequestException('Já existe uma unidade com este endereço de página (slug)');
    }
    const network = await this.findOrCreateNetwork(userId);
    const limits = await this.getPlanLimitsForOwner(userId);
    const currentCount = await this.prisma.barbershop.count({
      where: { networkId: network.id, practiceKind: 'shop', closedAt: null },
    });
    if (currentCount >= limits.maxBarbershops) {
      throw new BadRequestException(
        `Seu plano permite no máximo ${limits.maxBarbershops} unidade(s). Faça upgrade para cadastrar mais.`,
      );
    }
    // Quem já trabalha em outra unidade: o expediente novo não pode cruzar
    // o de lá (a tela de horário faz a mesma conferência)
    if (businessHours) {
      const otherShop = await this.prisma.barber.findFirst({
        where: { userId, ...currentEngagement() },
        select: { id: true },
      });
      const days = otherShop ? parseBusinessHours(businessHours) : null;
      if (otherShop && days) {
        for (let day = 0; day < 7; day++) {
          const hours = days[day];
          if (!hours) continue;
          await this.ensureShiftFreeAcrossShops(otherShop.id, day, hours.start, hours.end);
        }
      }
    }
    // O check de slug lá em cima não é atômico: dois cadastros simultâneos
    // com o mesmo slug passam juntos por ele e um estoura a unique aqui.
    // ownerTakesAppointments é do cadastro do dono (vai pro Barber dele), não
    // é coluna da unidade
    const {
      ownerTakesAppointments: _ownerTakesAppointments,
      businessHours: _rawHours,
      ...shopData
    } = data;
    const barbershop = await this.prisma.barbershop
      .create({
        data: {
          ...shopData,
          name: texts.name ?? data.name,
          address: texts.address ?? data.address,
          complement1: texts.complement1 ?? data.complement1,
          complement2: texts.complement2 ?? data.complement2,
          city: texts.city ?? data.city,
          state: texts.state ?? data.state,
          country: texts.country ?? data.country,
          postalCode: texts.postalCode ?? data.postalCode,
          phone: texts.phone ?? data.phone,
          email: texts.email ?? data.email,
          slug,
          ...(businessHours ? { businessHours } : {}),
          businessType,
          timezone: locale.timezone,
          currency: locale.currency,
          networkId: network.id,
          ownerUserId: userId,
        },
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new BadRequestException('Já existe uma unidade com este endereço de página (slug)');
        }
        throw error;
      });

    const owner = await this.prisma.user.findUnique({ where: { id: userId } });
    if (owner) {
      // O dono entra na equipe de cada unidade dele (a agenda dele é uma só:
      // o mesmo horário não é vendido em duas unidades)
      const ownerBarber = await this.prisma.barber.create({
        data: {
          barbershopId: barbershop.id,
          userId,
          name: owner.fullName,
          phone: owner.phone ?? texts.phone ?? data.phone,
          email: owner.email,
          staffType: 'barber',
          specialization: 'Proprietário',
          ...(data.ownerTakesAppointments === false ? { takesAppointments: false } : {}),
        },
      });
      await linkBarberToProfessional(this.prisma, ownerBarber.id, userId);
    }

    return barbershop;
  }

  async getUserBarbershops(userId: number) {
    return this.getMyBarbershops(userId);
  }

  async getMyBarbershops(userId: number) {
    // Inclui barbearias onde o usuário é dono (direto ou via rede) OU é
    // membro da equipe (Barber) — antes só considerava posse, então
    // managers/employees (ex.: staffType 'manager'/'barber') não viam a
    // barbearia onde trabalham em lugar nenhum da UI, mesmo já tendo acesso
    // de fato via ensureBarbershopAccess (que já checa os três casos).
    return this.prisma.barbershop.findMany({
      where: {
        closedAt: null,
        OR: [
          { ownerUserId: userId },
          { network: { ownerUserId: userId } },
          { barbers: { some: { userId, ...currentEngagement() } } },
        ],
      },
      orderBy: { name: 'asc' },
    });
  }

  async getBarbershop(userId: number, id: number) {
    await this.ensureBarbershopAccess(userId, id, 'basic');
    const barbershop = await this.prisma.barbershop.findUnique({
      where: { id },
    });
    if (!barbershop) throw new NotFoundException('Unidade não encontrada');
    return barbershop;
  }

  async updateBarbershop(
    userId: number,
    id: number,
    data: Partial<{
      name: string;
      address: string;
      complement1: string;
      complement2: string;
      city: string;
      state: string;
      country: string;
      postalCode: string;
      phone: string;
      email: string;
      timezone: string;
      currency: string;
      description: string;
      whatsapp: string;
      instagramUrl: string;
      facebookUrl: string;
      linkedinUrl: string;
      isActive: boolean;
      subdomain: string;
      businessType: string;
      staffRecordsUnitTips: boolean;
      minBookingLeadMinutes: number;
    }>,
  ) {
    const current = await this.ensureBarbershopAccess(userId, id, 'manager');
    // O horário fica só na tela de horário (conferência, escala e lista de espera)
    if ('businessHours' in data) {
      throw new BadRequestException('O horário de funcionamento se altera na tela de horário.');
    }
    data = { ...data, ...normalizeShopTexts(data, false, current.country) };
    // Pausar ou reativar tira a unidade do ar e mexe na cobrança do clube: só o dono
    const toggling = data.isActive !== undefined && data.isActive !== current.isActive;
    if (toggling && current.accessLevel !== 'owner') {
      throw new ForbiddenException('Só o dono pausa ou reativa a unidade.');
    }
    data = { ...data, ...(await this.shopBaseUpdate(current, data)) };
    if (
      data.minBookingLeadMinutes !== undefined &&
      !BOOKING_LEAD_MINUTES.includes(data.minBookingLeadMinutes)
    ) {
      throw new BadRequestException('Antecedência mínima inválida');
    }
    if (data.businessType !== undefined) {
      data = {
        ...data,
        businessType: this.parseBusinessType(data.businessType) ?? DEFAULT_BUSINESS_TYPE,
      };
    }
    const { subdomain, description, whatsapp, instagramUrl, facebookUrl, linkedinUrl, ...rest } =
      data;
    const updateData: typeof rest & {
      subdomain?: string | null;
      description?: string | null;
      whatsapp?: string | null;
      instagramUrl?: string | null;
      facebookUrl?: string | null;
      linkedinUrl?: string | null;
    } = {
      ...rest,
    };
    if (whatsapp !== undefined) {
      const raw = whatsapp?.trim();
      const e164 = raw ? normalizePhoneToE164(raw) : null;
      if (raw && !e164) throw new BadRequestException('WhatsApp inválido (use o número com DDD)');
      updateData.whatsapp = e164;
    }
    if (instagramUrl !== undefined) {
      updateData.instagramUrl = socialUrl(instagramUrl, 'instagram.com', 'Instagram');
    }
    if (facebookUrl !== undefined) {
      updateData.facebookUrl = socialUrl(facebookUrl, 'facebook.com', 'Facebook');
    }
    if (linkedinUrl !== undefined) {
      updateData.linkedinUrl = socialUrl(linkedinUrl, 'linkedin.com', 'LinkedIn');
    }
    if (description !== undefined) {
      const text = description?.trim() || null;
      if (text && text.length > MAX_DESCRIPTION) {
        throw new BadRequestException(`"Sobre nós" com no máximo ${MAX_DESCRIPTION} caracteres`);
      }
      updateData.description = text;
    }
    if (subdomain !== undefined) {
      updateData.subdomain = await this.resolveSubdomainUpdate(id, subdomain);
    }
    const updated = await this.prisma.barbershop.update({
      where: { id },
      data: updateData,
    });
    if (toggling) await this.setClubBillingPaused(id, !updated.isActive);
    return updated;
  }

  /**
   * Moeda e fuso na edição da unidade. Fuso tem de ser IANA; moeda, ISO.
   * Trocar a moeda é do dono e só sem dinheiro registrado (vendas, clube,
   * sinal e aluguel são gravados sem moeda: o histórico mudaria de sentido).
   * País novo sem moeda informada: moeda e fuso do país, quando ainda dá.
   */
  private async shopBaseUpdate(
    shop: {
      id: number;
      currency: string;
      country: string | null;
      state: string | null;
      accessLevel: AccessLevel;
    },
    data: { currency?: string; timezone?: string; country?: string; state?: string },
  ): Promise<{ currency?: string; timezone?: string }> {
    const out: { currency?: string; timezone?: string } = {};
    if (data.timezone !== undefined) {
      const timezone = data.timezone.trim();
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone });
      } catch {
        throw new BadRequestException(SHOP_TIMEZONE_INVALID_MESSAGE);
      }
      out.timezone = timezone;
    }
    let currency = data.currency?.trim().toUpperCase();
    if (currency !== undefined && !SUPPORTED_CURRENCIES.has(currency)) {
      throw new BadRequestException(SHOP_CURRENCY_INVALID_MESSAGE);
    }
    const country = data.country?.trim();
    const countryChanged =
      !!country && country.toUpperCase() !== (shop.country ?? '').trim().toUpperCase();
    const suggested = countryChanged && currency === undefined;
    if (suggested) currency = currencyForCountry(country);
    if (currency !== undefined && currency !== shop.currency) {
      const history = await this.hasMoneyHistory(shop.id);
      if (suggested) {
        // Já tem dinheiro na moeda antiga: fica (a troca é pelo backoffice)
        if (history) currency = undefined;
      } else {
        if (shop.accessLevel !== 'owner') {
          throw new ForbiddenException(SHOP_CURRENCY_OWNER_ONLY_MESSAGE);
        }
        if (history) throw new BadRequestException(SHOP_CURRENCY_LOCKED_MESSAGE);
      }
    }
    if (currency !== undefined) out.currency = currency;
    if (countryChanged && data.timezone === undefined) {
      out.timezone = timezoneForPlace(country, data.state ?? shop.state ?? '');
    }
    return out;
  }

  /** A unidade já registrou dinheiro (venda paga, clube, sinal, pago antes ou aluguel) */
  private async hasMoneyHistory(barbershopId: number) {
    const [sales, plans, appointments, rents] = await Promise.all([
      this.prisma.sale.count({ where: { barbershopId, paymentStatus: 'PAID' }, take: 1 }),
      this.prisma.clientSubscriptionPlan.count({ where: { barbershopId }, take: 1 }),
      this.prisma.appointment.count({
        where: { barbershopId, OR: [{ depositPaid: true }, { prepaidAt: { not: null } }] },
        take: 1,
      }),
      this.prisma.sharedLocationMember.count({
        where: {
          OR: [{ hostBarbershopId: barbershopId }, { memberBarbershopId: barbershopId }],
          rentAmount: { not: null },
        },
        take: 1,
      }),
    ]);
    return sales + plans + appointments + rents > 0;
  }

  /**
   * Unidade pausada não aceita horário: a cobrança do clube fica suspensa na
   * Stripe (pause_collection, a fatura do período nem é gerada) e volta ao
   * reativar. Só voltam as que a pausa suspendeu (shopPausedAt). Outro
   * motivo (suspensão da plataforma ou dono desativado) segura a Stripe.
   */
  async setClubBillingPaused(barbershopId: number, paused: boolean) {
    const subs = await this.prisma.clientSubscription.findMany({
      where: paused
        ? { barbershopId, status: { in: ['ACTIVE', 'PAST_DUE'] }, shopPausedAt: null }
        : { barbershopId, shopPausedAt: { not: null } },
      select: { id: true, stripeSubscriptionId: true, billingPauseReasons: true },
    });
    for (const sub of subs) {
      // Suspensão da plataforma ou dono desativado ainda segura a Stripe
      const stillHeld = !paused && sub.billingPauseReasons.length > 0;
      try {
        if (!stillHeld) {
          await this.stripeService.updateSubscription(sub.stripeSubscriptionId, {
            // '' tira a pausa (é assim que a API da Stripe limpa o campo)
            pause_collection: paused ? { behavior: 'void' } : ('' as never),
          });
        }
        await this.prisma.clientSubscription.update({
          where: { id: sub.id },
          data: { shopPausedAt: paused ? new Date() : null },
        });
      } catch (err) {
        this.logger.error(
          `Clube ${sub.id}: cobrança não foi ${paused ? 'suspensa' : 'retomada'} na Stripe`,
          err as Error,
        );
      }
    }
    return subs.length;
  }

  // Label de DNS válido: minúsculas, números, hífen no meio; 3 a 63
  // caracteres. String vazia limpa (volta pra null) — usado quando o dono
  // quer desativar o subdomínio sem excluir a barbearia.
  private async resolveSubdomainUpdate(
    barbershopId: number,
    rawSubdomain: string,
  ): Promise<string | null> {
    const trimmed = rawSubdomain.trim().toLowerCase();
    if (trimmed === '') return null;
    if (!/^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/.test(trimmed)) {
      throw new BadRequestException(
        'Subdomínio inválido — use só letras minúsculas, números e hífen (sem começar/terminar com hífen), de 3 a 63 caracteres.',
      );
    }
    const RESERVED = ['www', 'app', 'api', 'admin', 'mail', 'ftp'];
    if (RESERVED.includes(trimmed)) {
      throw new BadRequestException('Esse subdomínio é reservado. Escolha outro.');
    }
    const existing = await this.prisma.barbershop.findFirst({
      where: { subdomain: trimmed, NOT: { id: barbershopId } },
    });
    if (existing) {
      throw new BadRequestException('Esse subdomínio já está em uso por outra unidade.');
    }
    return trimmed;
  }

  /**
   * "Excluir unidade" encerra em vez de apagar: o cascade levava junto
   * vendas, pagamentos pelo app e repasses, e a contabilidade perdia o
   * histórico. A unidade some da equipe, das listas e da página pública; o
   * slug e o subdomínio ficam livres pra outra unidade.
   */
  async deleteBarbershop(userId: number, id: number) {
    const shop = await this.ensureBarbershopAccess(userId, id, 'owner');
    // Antes as assinaturas dos clientes sumiam do banco junto com a unidade
    // (cascade) mas continuavam ativas no Stripe — o cliente seguia pagando
    await this.cancelClientSubscriptionsOfBarbershops([id]);
    await this.endSharedLocationsOfBarbershops([id]);
    await this.cancelFutureAppointmentsOfBarbershops([id]);
    await this.jobs?.closeOpeningsOfBarbershop(id);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.barbershop.update({
        where: { id },
        data: {
          closedAt: now,
          isActive: false,
          slug: `${shop.slug}--encerrada-${id}`,
          subdomain: null,
          // Destaque pago da unidade não tem mais onde aparecer
          featuredUntil: null,
        },
      }),
      // A equipe perde o acesso (e some das agendas e caixas de entrada)
      this.prisma.barber.updateMany({ where: { barbershopId: id }, data: { isActive: false } }),
      this.prisma.waitlistEntry.updateMany({
        where: { barbershopId: id, status: { in: ['WAITING', 'NOTIFIED'] } },
        data: { status: 'CANCELLED', offeredStartAt: null },
      }),
      this.prisma.employeeInvite.deleteMany({ where: { barbershopId: id, status: 'PENDING' } }),
      this.prisma.socialPost.updateMany({
        where: { barbershopId: id, status: 'SCHEDULED' },
        data: { status: 'CANCELLED', errorMessage: 'Cancelada pelo encerramento da unidade.' },
      }),
      this.prisma.socialConnection.deleteMany({ where: { barbershopId: id } }),
      this.prisma.socialPageChoice.deleteMany({ where: { barbershopId: id } }),
      // Pacote pago fora do app (dinheiro, PIX): a unidade devolve o que
      // não foi usado (a prévia mostra quanto); aqui ele deixa de valer
      this.prisma.clientPackage.updateMany({
        where: { barbershopId: id, status: 'ACTIVE' },
        data: { status: 'CANCELLED' },
      }),
    ]);
  }

  /** O que a exclusão da unidade leva junto: pra mostrar antes de confirmar */
  async getBarbershopDeletionPreview(userId: number, id: number) {
    await this.ensureBarbershopAccess(userId, id, 'owner');
    const shop = await this.prisma.barbershop.findUniqueOrThrow({
      where: { id },
      select: { networkId: true },
    });
    // Última unidade da rede: os cartões-presente ficam sem onde usar
    const others = await this.prisma.barbershop.count({
      where: { networkId: shop.networkId, id: { not: id } },
    });
    const [impact, activeClientSubscriptions, packages, overdueChairRents, giftCards] =
      await Promise.all([
        this.deletionImpact([id]),
        this.prisma.clientSubscription.count({
          where: { barbershopId: id, status: { not: 'CANCELED' } },
        }),
        this.activePackagesOf([id]),
        this.overdueChairRentsOf([id]),
        this.giftCardBalancesOf(others === 0 ? [shop.networkId] : []),
      ]);
    return { ...impact, activeClientSubscriptions, ...packages, overdueChairRents, ...giftCards };
  }

  /** Cartões-presente com saldo das redes, por moeda (a do cartão, ou a da rede) */
  async giftCardBalancesOf(networkIds: number[]) {
    if (networkIds.length === 0) return { giftCards: 0, giftCardBalances: [] };
    const cards = await this.prisma.giftCard.findMany({
      where: {
        networkId: { in: networkIds },
        isActive: true,
        remainingValue: { gt: 0 },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { remainingValue: true, currency: true, network: { select: { currency: true } } },
    });
    const byCurrency = new Map<string, number>();
    for (const c of cards) {
      const currency = c.currency || c.network.currency || 'BRL';
      byCurrency.set(currency, round2((byCurrency.get(currency) ?? 0) + Number(c.remainingValue)));
    }
    return {
      giftCards: cards.length,
      giftCardBalances: [...byCurrency].map(([currency, amount]) => ({ currency, amount })),
    };
  }

  /**
   * Antes de apagar a conta do dono: avisa por e-mail quem tem pacote ativo
   * ou cartão-presente com saldo nessas unidades/redes (quando há e-mail).
   * O cancelamento dos horários já tem o próprio aviso.
   */
  async notifyBalancesBeforeDeletion(barbershopIds: number[], networkIds: number[]) {
    const [packages, cards] = await Promise.all([
      barbershopIds.length
        ? this.prisma.clientPackage.findMany({
            where: { barbershopId: { in: barbershopIds }, status: 'ACTIVE' },
            select: {
              customer: { select: { email: true } },
              barbershop: { select: { name: true, country: true } },
            },
          })
        : [],
      networkIds.length
        ? this.prisma.giftCard.findMany({
            where: { networkId: { in: networkIds }, isActive: true, remainingValue: { gt: 0 } },
            select: {
              purchaserEmail: true,
              network: {
                select: { name: true, barbershops: { select: { country: true }, take: 1 } },
              },
            },
          })
        : [],
    ]);
    const notices = new Map<string, { name: string; country: string | null }>();
    for (const p of packages) {
      if (p.customer?.email) notices.set(p.customer.email.toLowerCase(), p.barbershop);
    }
    for (const c of cards) {
      if (c.purchaserEmail) {
        notices.set(c.purchaserEmail.toLowerCase(), {
          name: c.network.name ?? '',
          country: c.network.barbershops[0]?.country ?? null,
        });
      }
    }
    for (const [to, shop] of notices) {
      const lang = langForCountry(shop.country);
      // A mensagem do modelo é HTML: o nome entra escapado
      const name = shop.name.replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c),
      );
      const text = {
        pt: {
          subject: `${shop.name} encerrou o atendimento pelo app`,
          message: `${name} encerrou a conta no app. O pacote de sessões ou o cartão-presente que você tem com eles não vale mais pelo app: fale direto com o estabelecimento sobre o saldo.`,
        },
        en: {
          subject: `${shop.name} stopped using the app`,
          message: `${name} closed its account on the app. Your session package or gift card with them no longer works through the app: contact the business directly about the balance.`,
        },
        es: {
          subject: `${shop.name} dejó de atender por la app`,
          message: `${name} cerró su cuenta en la app. Tu paquete de sesiones o tarjeta de regalo con ellos ya no vale por la app: habla directamente con el establecimiento sobre el saldo.`,
        },
      }[lang];
      // Montado agora (enfileirado pronto): depois da exclusão não há mais a unidade
      await this.notificationQueue
        .email({
          kind: 'customer',
          loggedAgainstUserId: 0,
          template: 'admin_notification',
          context: { title: text.subject, message: text.message, type: 'warning' },
          subject: text.subject,
          meta: 'balances-before-deletion',
          to,
          lang,
        })
        .catch((err) => this.logger.warn(`Aviso de saldo antes da exclusão não saiu: ${err}`));
    }
  }

  /**
   * Pacotes ativos da unidade e o que falta devolver aos clientes (sessões
   * não usadas × o que foi pago por sessão), por moeda.
   */
  async activePackagesOf(barbershopIds: number[]) {
    if (barbershopIds.length === 0) return { activePackages: 0, packageRefunds: [] };
    const packages = await this.prisma.clientPackage.findMany({
      where: { barbershopId: { in: barbershopIds }, status: 'ACTIVE' },
      select: {
        totalSessions: true,
        usedSessions: true,
        sale: { select: { total: true } },
        servicePackage: { select: { price: true, totalSessions: true } },
        barbershop: { select: { currency: true } },
      },
    });
    const byCurrency = new Map<string, number>();
    for (const p of packages) {
      const paid = p.sale ? Number(p.sale.total) : Number(p.servicePackage.price);
      const left = Math.max(0, p.totalSessions - p.usedSessions);
      if (p.totalSessions <= 0 || left === 0) continue;
      const currency = p.barbershop.currency;
      byCurrency.set(
        currency,
        round2((byCurrency.get(currency) ?? 0) + (paid * left) / p.totalSessions),
      );
    }
    return {
      activePackages: packages.length,
      packageRefunds: [...byCurrency].map(([currency, amount]) => ({ currency, amount })),
    };
  }

  private futureAppointmentsWhere(barbershopIds: number[]): Prisma.AppointmentWhereInput {
    return {
      barbershopId: { in: barbershopIds },
      startAt: { gt: new Date() },
      status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] },
    };
  }

  /**
   * Horários futuros das unidades e o que foi pago por eles pelo app (sinal e
   * atendimento), que volta pro cliente se as unidades forem apagadas. Por
   * moeda: uma rede pode ter unidades em países diferentes.
   */
  async deletionImpact(barbershopIds: number[]) {
    if (barbershopIds.length === 0) {
      return { futureAppointments: 0, onlineRefunds: [], clubRefunds: [] };
    }
    const appts = await this.prisma.appointment.findMany({
      where: this.futureAppointmentsWhere(barbershopIds),
      select: {
        depositPaid: true,
        depositPaidAt: true,
        depositAmount: true,
        depositRefundedAt: true,
        prepaidAt: true,
        prepaidAmount: true,
        prepaidRefundedAt: true,
        prepaidRefundedAmount: true,
        barbershop: { select: { currency: true } },
      },
    });
    const byCurrency = new Map<string, number>();
    for (const a of appts) {
      let back = 0;
      if (a.depositPaid && a.depositPaidAt && !a.depositRefundedAt) {
        back += Number(a.depositAmount ?? 0);
      }
      if (a.prepaidAt && !a.prepaidRefundedAt) {
        back += Number(a.prepaidAmount ?? 0) - Number(a.prepaidRefundedAmount ?? 0);
      }
      if (back > 0) {
        const currency = a.barbershop.currency;
        byCurrency.set(currency, round2((byCurrency.get(currency) ?? 0) + back));
      }
    }
    // Resto do ciclo pago do clube, que volta pro cartão do cliente
    const clubByCurrency = new Map<string, number>();
    for (const r of await this.unusedClubCycles(barbershopIds)) {
      clubByCurrency.set(r.currency, round2((clubByCurrency.get(r.currency) ?? 0) + r.amount));
    }
    return {
      futureAppointments: appts.length,
      onlineRefunds: [...byCurrency].map(([currency, amount]) => ({ currency, amount })),
      clubRefunds: [...clubByCurrency].map(([currency, amount]) => ({ currency, amount })),
    };
  }

  /**
   * Antes de apagar unidades (ou a conta do dono): os horários futuros são
   * cancelados, o que o cliente pagou pelo app volta e ele recebe o e-mail de
   * cancelamento (com o convite que tira o evento da agenda). Antes o cascade
   * apagava tudo calado e o dinheiro ficava. Estorno que falha interrompe a
   * exclusão (nada é apagado), como nas assinaturas.
   */
  async cancelFutureAppointmentsOfBarbershops(barbershopIds: number[]) {
    if (barbershopIds.length === 0) return;
    const appts = await this.prisma.appointment.findMany({
      where: this.futureAppointmentsWhere(barbershopIds),
      select: {
        id: true,
        depositPaid: true,
        depositPaidAt: true,
        prepaidAt: true,
        contactEmail: true,
        customer: { select: { email: true } },
        barbershop: { select: { country: true } },
      },
      orderBy: { startAt: 'asc' },
    });
    for (const a of appts) {
      let refunded = false;
      if (a.depositPaid && a.depositPaidAt)
        refunded = (await this.refundOnlineDeposit(a.id)) || refunded;
      if (a.prepaidAt) refunded = (await this.refundPrepayment(a.id)) || refunded;
      await this.prisma.appointment.update({
        where: { id: a.id },
        data: { status: 'CANCELLED' },
      });
      const to = appointmentContactEmail(a);
      if (!to) continue;
      const lang = langForCountry(a.barbershop.country);
      const reason = {
        pt: 'A unidade encerrou o atendimento pelo app.',
        en: 'The business stopped taking bookings through the app.',
        es: 'La unidad dejó de atender por la app.',
      }[lang];
      const money = {
        pt: ' O que você pagou pelo app foi devolvido.',
        en: ' What you paid through the app has been refunded.',
        es: ' Lo que pagaste por la app fue devuelto.',
      }[lang];
      // O e-mail é montado agora (enfileirado com tudo pronto): depois de
      // apagar não há mais o horário pra carregar
      await this.sendAppointmentEmail(
        a.id,
        'appointment_cancelled',
        to,
        refunded ? reason + money : reason,
      ).catch((err) =>
        this.logger.error(`Erro ao avisar o cancelamento do agendamento #${a.id}:`, err),
      );
    }
  }

  /**
   * Cancela na hora, no Stripe, as assinaturas de serviço dos clientes das
   * unidades (antes de apagar a unidade ou a conta do dono). Assinatura que
   * o Stripe já não conhece não impede nada; outro erro interrompe, pra não
   * apagar a unidade deixando a cobrança rodando. O resto do ciclo já pago
   * volta pro cartão do cliente (unusedClubCycles).
   */
  async cancelClientSubscriptionsOfBarbershops(barbershopIds: number[]) {
    if (barbershopIds.length === 0) return;
    // Calculado antes de cancelar: depois a assinatura já não está ACTIVE
    const refunds = await this.unusedClubCycles(barbershopIds);
    const subs = await this.prisma.clientSubscription.findMany({
      where: { barbershopId: { in: barbershopIds }, status: { not: 'CANCELED' } },
      select: { id: true, stripeSubscriptionId: true },
    });
    for (const sub of subs) {
      try {
        await this.stripeService.cancelSubscription(sub.stripeSubscriptionId);
      } catch (error: any) {
        if (error?.code !== 'resource_missing') throw error;
      }
      await this.prisma.clientSubscription.update({
        where: { id: sub.id },
        data: { status: 'CANCELED', canceledAt: new Date(), cancelAtPeriodEnd: false },
      });
    }
    for (const refund of refunds) await this.refundUnusedClubCycle(refund);
  }

  /**
   * Parte do ciclo pago do clube que o cliente não vai usar: o tempo que
   * falta do ciclo ou, no plano com sessões contadas, as sessões que
   * sobraram (o menor dos dois, pra não devolver o que ele já usou). Tira o
   * que já foi estornado antes.
   */
  async unusedClubCycles(barbershopIds: number[], now = new Date(), clientAccountId?: number) {
    if (barbershopIds.length === 0) return [];
    const subs = await this.prisma.clientSubscription.findMany({
      where: {
        barbershopId: { in: barbershopIds },
        status: 'ACTIVE',
        ...(clientAccountId != null ? { clientAccountId } : {}),
      },
      select: {
        id: true,
        connectAccountId: true,
        usedThisCycle: true,
        sessionsPerCycle: true,
        barbershop: { select: { currency: true } },
        payments: {
          where: { status: 'SUCCEEDED', periodEnd: { gt: now } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            stripeInvoiceId: true,
            amount: true,
            refundedAmount: true,
            periodStart: true,
            periodEnd: true,
          },
        },
      },
    });
    const result: Array<{
      subscriptionId: number;
      payment: (typeof subs)[number]['payments'][number];
      connected: boolean;
      currency: string;
      amount: number;
    }> = [];
    for (const sub of subs) {
      const payment = sub.payments[0];
      if (!payment?.periodStart || !payment.periodEnd) continue;
      const length = payment.periodEnd.getTime() - payment.periodStart.getTime();
      if (length <= 0) continue;
      let share = Math.min(1, (payment.periodEnd.getTime() - now.getTime()) / length);
      const sessions = sub.sessionsPerCycle;
      if (sessions != null && sessions > 0) {
        share = Math.min(share, Math.max(0, sessions - sub.usedThisCycle) / sessions);
      }
      const paid = Number(payment.amount);
      const left = paid - Number(payment.refundedAmount ?? 0);
      const amount = round2(Math.min(left, paid * share));
      if (amount <= 0) continue;
      result.push({
        subscriptionId: sub.id,
        payment,
        connected: sub.connectAccountId != null,
        currency: sub.barbershop.currency,
        amount,
      });
    }
    return result;
  }

  /**
   * Devolve pelo Stripe o resto do ciclo do clube. Marca antes (condicional:
   * duas chamadas juntas não devolvem duas vezes) e desfaz se o Stripe
   * recusar. Erro não impede encerrar a unidade: a assinatura já foi
   * cancelada e o estorno fica no log pra ser feito à mão.
   */
  private async refundUnusedClubCycle(refund: {
    payment: { id: number; stripeInvoiceId: string; refundedAmount: Prisma.Decimal | null };
    connected: boolean;
    currency: string;
    amount: number;
  }) {
    const { payment } = refund;
    const before = payment.refundedAmount;
    const after = round2(Number(before ?? 0) + refund.amount);
    const claimed = await this.prisma.clientSubscriptionPayment.updateMany({
      where: { id: payment.id, refundedAmount: before },
      data: { refundedAmount: after },
    });
    if (claimed.count === 0) return;
    try {
      const invoice = await this.stripeService.getInvoice(payment.stripeInvoiceId);
      const intentId =
        typeof invoice.payment_intent === 'string'
          ? invoice.payment_intent
          : invoice.payment_intent?.id;
      if (!intentId) throw new Error(`Fatura ${payment.stripeInvoiceId} sem pagamento`);
      await this.stripeService.createRefund(
        intentId,
        toMinorUnits(refund.amount, refund.currency),
        'requested_by_customer',
        `club-close-refund-${payment.id}-${Math.round(after * 100)}`,
        // Foi pra conta da unidade: desfaz a transferência e devolve a taxa
        refund.connected,
      );
    } catch (err) {
      if ((err as { code?: string })?.code === 'charge_already_refunded') return;
      await this.prisma.clientSubscriptionPayment.updateMany({
        where: { id: payment.id, refundedAmount: after },
        data: { refundedAmount: before },
      });
      this.logger.error(
        `Resto do ciclo do clube não devolvido (pagamento ${payment.id}, ${refund.amount} ${refund.currency})`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /**
   * Aluguel da cadeira (espaço compartilhado) em que a unidade é o espaço ou
   * o profissional: cancela a cobrança mensal no Stripe antes de apagar a
   * unidade/conta ou de encerrar o vínculo — senão o profissional seguia
   * pagando por um espaço que não existe mais.
   */
  async cancelChairRentsOfBarbershops(barbershopIds: number[], onlyLinkId?: number) {
    if (barbershopIds.length === 0 && !onlyLinkId) return;
    const links = await this.prisma.sharedLocationMember.findMany({
      where: onlyLinkId
        ? { id: onlyLinkId, rentStripeSubscriptionId: { not: null } }
        : {
            rentStripeSubscriptionId: { not: null },
            OR: [
              { hostBarbershopId: { in: barbershopIds } },
              { memberBarbershopId: { in: barbershopIds } },
            ],
          },
      select: { id: true, rentStripeSubscriptionId: true },
    });
    for (const link of links) {
      try {
        await this.stripeService.cancelSubscription(
          must(link.rentStripeSubscriptionId, 'assinatura do aluguel'),
        );
      } catch (error: any) {
        if (error?.code !== 'resource_missing') throw error;
      }
      await this.prisma.sharedLocationMember.update({
        where: { id: link.id },
        data: { rentStripeSubscriptionId: null, rentStatus: 'NONE' },
      });
    }
  }

  /**
   * Encerrar a unidade acaba com o espaço compartilhado dos dois lados.
   * O aluguel no cartão é cancelado no Stripe. O cobrado à mão para de
   * gerar mensalidade; a que vence depois do encerramento sai. A que já
   * está atrasada fica (a prévia mostra).
   */
  async endSharedLocationsOfBarbershops(barbershopIds: number[]) {
    if (barbershopIds.length === 0) return;
    await this.cancelChairRentsOfBarbershops(barbershopIds);
    const links = await this.prisma.sharedLocationMember.findMany({
      where: {
        status: { in: ['PENDING', 'ACTIVE'] },
        OR: [
          { hostBarbershopId: { in: barbershopIds } },
          { memberBarbershopId: { in: barbershopIds } },
        ],
      },
      select: { id: true },
    });
    if (links.length === 0) return;
    const ids = links.map((link) => link.id);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.sharedLocationMember.updateMany({
        where: { id: { in: ids } },
        data: { status: 'REMOVED', respondedAt: now, rentStatus: 'NONE' },
      }),
      this.prisma.chairRentPayment.deleteMany({
        where: { sharedLocationMemberId: { in: ids }, status: 'DUE', dueDate: { gt: now } },
      }),
    ]);
  }

  /** Mensalidade manual já vencida, que continua devida depois do encerramento. */
  async overdueChairRentsOf(barbershopIds: number[]) {
    if (barbershopIds.length === 0) return [];
    const payments = await this.prisma.chairRentPayment.findMany({
      where: {
        status: 'DUE',
        dueDate: { lte: new Date() },
        link: {
          OR: [
            { hostBarbershopId: { in: barbershopIds } },
            { memberBarbershopId: { in: barbershopIds } },
          ],
        },
      },
      select: { amount: true, currency: true },
    });
    const byCurrency = new Map<string, number>();
    for (const payment of payments) {
      byCurrency.set(
        payment.currency,
        round2((byCurrency.get(payment.currency) ?? 0) + Number(payment.amount)),
      );
    }
    return [...byCurrency].map(([currency, amount]) => ({ currency, amount }));
  }

  // ============ CUSTOMER ============

  async createCustomer(
    userId: number,
    barbershopId: number,
    data: {
      name: string;
      phone?: string;
      email?: string;
      birthDate?: Date;
      notes?: string;
    },
  ) {
    const phone = data.phone?.trim();
    const email = data.email?.trim();
    if (!phone && !email) {
      throw new BadRequestException(
        'Informe pelo menos telefone ou email para cadastrar o cliente.',
      );
    }
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'basic');
    return this.prisma.customer.create({
      data: {
        networkId: barbershop.networkId,
        ...data,
        phone: phone || '(sem telefone)',
        email: email || null,
      },
    });
  }

  async getCustomers(
    userId: number,
    barbershopId: number,
    filters?: { isActive?: boolean; search?: string; limit?: number; offset?: number },
  ) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'basic');
    const where: any = { networkId: barbershop.networkId, deletedAt: null };
    if (filters?.isActive !== undefined) where.isActive = filters.isActive;
    if (filters?.search) {
      where.OR = [{ name: { contains: filters.search, mode: 'insensitive' } }];
      // Quem não vê o contato de todos não busca por ele (confirmaria o
      // telefone de alguém)
      if (ACCESS_RANK[barbershop.accessLevel] >= ACCESS_RANK.reception) {
        where.OR.push(
          { phone: { contains: filters.search } },
          { email: { contains: filters.search, mode: 'insensitive' } },
        );
      }
    }
    const customers = await this.prisma.customer.findMany({
      where,
      orderBy: { name: 'asc' },
      take: filters?.limit ?? 50,
      skip: filters?.offset ?? 0,
    });
    const canSee = await this.contactVisibility(userId, barbershop);
    return customers.map((c) => this.hideContact(canSee, c));
  }

  async getCustomer(userId: number, barbershopId: number, customerId: number) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'basic');
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, networkId: barbershop.networkId, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado');
    return this.hideContact(await this.contactVisibility(userId, barbershop), customer);
  }

  async updateCustomer(
    userId: number,
    barbershopId: number,
    customerId: number,
    data: Partial<{
      name: string;
      phone: string;
      email: string;
      birthDate: Date;
      notes: string;
      isActive: boolean;
      marketingOptOut: boolean;
    }>,
  ) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'reception');
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, networkId: barbershop.networkId, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado');
    // Quem saiu pelo link do e-mail só volta por conta própria (LGPD). A
    // equipe pode marcar "não quer receber", e isso vale para as outras
    // fichas da rede com o mesmo e-mail.
    if (data.marketingOptOut === false && customer.marketingOptOut) {
      throw new BadRequestException(
        'Quem saiu das campanhas só pode voltar a receber por conta própria.',
      );
    }
    const email = customer.email?.trim();
    if (data.marketingOptOut === true && email) {
      await this.prisma.customer.updateMany({
        where: {
          networkId: customer.networkId,
          deletedAt: null,
          email: { equals: email, mode: 'insensitive' },
        },
        data: { marketingOptOut: true },
      });
    }
    // Cliente do balcão, sem e-mail: as outras fichas com o mesmo telefone
    // também saem das campanhas.
    const phone = customer.phone?.trim();
    if (data.marketingOptOut === true && phone) {
      const variants = phoneDigitVariants(phone, callingCodeForCountry(barbershop.country) ?? '55');
      if (variants.length) {
        await this.prisma.$executeRaw`
          UPDATE "Customer"
             SET "marketingOptOut" = true
           WHERE "networkId" = ${customer.networkId}
             AND "deletedAt" IS NULL
             AND "phoneDigits" IN (${Prisma.join(variants)})
        `;
      }
    }
    // E-mail trocado numa ficha ligada a uma conta com o e-mail antigo: a
    // ligação sai (a conta antiga não segue vendo a ficha) (item 251)
    let unlink = {};
    if (data.email !== undefined && customer.clientAccountId != null) {
      const nextEmail = data.email?.trim().toLowerCase() || '';
      const account = await this.prisma.clientAccount.findUnique({
        where: { id: customer.clientAccountId },
        select: { email: true },
      });
      if (!account || account.email.trim().toLowerCase() !== nextEmail) {
        unlink = { clientAccountId: null };
      }
    }
    return this.prisma.customer.update({
      where: { id: customerId },
      data: { ...data, ...unlink },
    });
  }

  async deleteCustomer(userId: number, barbershopId: number, customerId: number) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, networkId: barbershop.networkId },
    });
    if (!customer || customer.deletedAt) throw new NotFoundException('Cliente não encontrado');
    // Horário marcado pela frente teria que ser cancelado (e estornado) antes
    const upcoming = await this.prisma.appointment.count({
      where: {
        customerId,
        status: { in: ['CONFIRMED', 'PENDING_PAYMENT', 'IN_PROGRESS'] },
        endAt: { gte: new Date() },
      },
    });
    if (upcoming > 0) {
      throw new BadRequestException(
        'Este cliente tem horários marcados. Cancele os horários antes de apagar a ficha.',
      );
    }
    // Pacote pago com sessões sobrando: some na ficha removida (ninguém acha
    // pra usar nem devolver). Resolve antes, como os horários
    const packages = await this.prisma.clientPackage.count({
      where: { customerId, status: 'ACTIVE', remainderRefundedAt: null },
    });
    if (packages > 0) throw new BadRequestException(CUSTOMER_HAS_PACKAGES_MESSAGE);
    // Anonimiza em vez de apagar: a exclusão em cascata levava atendimentos,
    // caixinhas, pagamentos e a avaliação do profissional (registro
    // financeiro fica 5 anos; avaliação não some apagando o cliente). Saem os
    // dados pessoais, a ficha técnica e a lista de espera.
    await this.prisma.$transaction([
      this.prisma.consentForm.deleteMany({ where: { customerId } }),
      this.prisma.waitlistEntry.deleteMany({ where: { customerId } }),
      // Taxa pendente da ficha removida sai da lista como perdoada
      this.prisma.noShowFee.updateMany({
        where: { customerId, status: 'PENDING' },
        data: { status: 'WAIVED' },
      }),
      // Indicação ainda não completada sai (a completada fica como registro)
      this.prisma.customerReferral.deleteMany({
        where: { completedAt: null, OR: [{ referrerId: customerId }, { referredId: customerId }] },
      }),
      this.prisma.customer.update({
        where: { id: customerId },
        data: {
          name: REMOVED_CUSTOMER_NAME,
          phone: '',
          email: null,
          birthDate: null,
          notes: null,
          clientAccountId: null,
          marketingOptOut: true,
          isActive: false,
          blockedReason: null,
          // Pontos não ficam presos numa ficha que ninguém acha
          loyaltyPoints: 0,
          deletedAt: new Date(),
        },
      }),
      // Histórico da ficha (inclusive a linha que esta exclusão acabou de
      // gravar): sai o nome, o telefone e o e-mail (item 283)
      this.prisma.$executeRaw`
        UPDATE "ChangeLog" SET
          "entityName" = ${REMOVED_CUSTOMER_NAME},
          changes = (
            SELECT coalesce(jsonb_object_agg(k, CASE
              WHEN k IN ('name', 'phone', 'email') THEN jsonb_build_array(
                CASE WHEN v -> 0 IS NULL OR v -> 0 = 'null'::jsonb THEN NULL ELSE to_jsonb('•••'::text) END,
                CASE WHEN v -> 1 IS NULL OR v -> 1 = 'null'::jsonb THEN NULL ELSE to_jsonb('•••'::text) END)
              ELSE v END), '{}'::jsonb)
            FROM jsonb_each(changes) AS e(k, v)
          )
        WHERE "entityType" = 'Customer' AND "entityId" = ${String(customerId)}`,
    ]);
  }

  /**
   * Bloqueio de cliente pela unidade (gerente para cima): o cliente
   * bloqueado não agenda online em nenhuma unidade da rede nem manda
   * mensagem no chat. O atendimento no balcão continua possível.
   */
  async setCustomerBlocked(
    userId: number,
    barbershopId: number,
    customerId: number,
    blocked: boolean,
    reason?: string | null,
    options?: { cancelSubscriptions?: boolean; refundUnused?: boolean },
  ) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, networkId: barbershop.networkId },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado');
    if (blocked && options?.cancelSubscriptions) {
      await this.cancelCustomerClub(
        barbershop.networkId,
        customerId,
        options.refundUnused === true,
      );
    }
    const trimmed = reason?.trim().slice(0, 500) || null;
    const updated = await this.prisma.customer.update({
      where: { id: customerId },
      data: blocked
        ? {
            blockedAt: customer.blockedAt ?? new Date(),
            blockedReason: trimmed,
            blockedByUserId: userId,
          }
        : { blockedAt: null, blockedReason: null, blockedByUserId: null },
    });
    return this.hideContact(await this.contactVisibility(userId, barbershop), updated);
  }

  /**
   * O que o bloqueio não desliga sozinho: assinatura do clube (ainda cobra)
   * e pacote com sessão sobrando. A tela mostra os dois e pode cancelar o clube.
   */
  async customerBlockPreview(userId: number, barbershopId: number, customerId: number) {
    const shop = await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, networkId: shop.networkId, deletedAt: null },
      select: { id: true, phone: true },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado');
    const accountId = await this.clientAccountIdForCustomer(shop.networkId, customerId);
    const phoneIds = await this.customerIdsByPhone(shop.networkId, customer.phone);
    const linked = accountId
      ? await this.prisma.customer.findMany({
          where: { networkId: shop.networkId, clientAccountId: accountId, deletedAt: null },
          select: { id: true },
        })
      : [];
    const customerIds = [...new Set([customer.id, ...phoneIds, ...linked.map((row) => row.id)])];
    const subs = accountId
      ? await this.prisma.clientSubscription.findMany({
          where: {
            clientAccountId: accountId,
            status: { in: ['ACTIVE', 'PAST_DUE', 'INCOMPLETE'] },
            barbershop: { networkId: shop.networkId },
          },
          select: {
            id: true,
            plan: { select: { name: true } },
            barbershop: { select: { id: true, name: true, currency: true } },
          },
        })
      : [];
    const shopIds = [...new Set(subs.map((sub) => sub.barbershop.id))];
    const refunds =
      accountId && shopIds.length
        ? await this.unusedClubCycles(shopIds, new Date(), accountId)
        : [];
    const refundBySub = new Map(refunds.map((refund) => [refund.subscriptionId, refund.amount]));
    const packages = await this.prisma.clientPackage.findMany({
      where: {
        customerId: { in: customerIds },
        status: 'ACTIVE',
        remainderRefundedAt: null,
        barbershop: { networkId: shop.networkId },
      },
      select: {
        totalSessions: true,
        usedSessions: true,
        expiresAt: true,
        servicePackage: { select: { name: true } },
        barbershop: { select: { name: true } },
      },
    });
    const now = Date.now();
    return {
      subscriptions: subs.map((sub) => ({
        id: sub.id,
        planName: sub.plan.name,
        barbershopName: sub.barbershop.name,
        currency: sub.barbershop.currency,
        refundAmount: refundBySub.get(sub.id) ?? 0,
      })),
      packages: packages.flatMap((pkg) => {
        const remaining = pkg.totalSessions - pkg.usedSessions;
        if (remaining <= 0) return [];
        if (pkg.expiresAt && pkg.expiresAt.getTime() <= now) return [];
        return [
          {
            name: pkg.servicePackage.name,
            remaining,
            barbershopName: pkg.barbershop.name,
          },
        ];
      }),
    };
  }

  /**
   * Assinaturas do clube ainda cobrando nesta conta, em qualquer unidade,
   * com o estorno do ciclo se cancelar agora.
   */
  async accountClubPreview(clientAccountId: number) {
    const subs = await this.prisma.clientSubscription.findMany({
      where: {
        clientAccountId,
        status: { in: ['ACTIVE', 'PAST_DUE', 'INCOMPLETE'] },
      },
      select: {
        id: true,
        barbershopId: true,
        plan: { select: { name: true } },
        barbershop: { select: { name: true, currency: true } },
      },
    });
    const shopIds = [...new Set(subs.map((sub) => sub.barbershopId))];
    const refunds = shopIds.length
      ? await this.unusedClubCycles(shopIds, new Date(), clientAccountId)
      : [];
    const refundBySub = new Map(refunds.map((refund) => [refund.subscriptionId, refund.amount]));
    return subs.map((sub) => ({
      id: sub.id,
      planName: sub.plan.name,
      barbershopName: sub.barbershop.name,
      currency: sub.barbershop.currency,
      refundAmount: refundBySub.get(sub.id) ?? 0,
    }));
  }

  /** Para a cobrança do clube desta conta em todas as unidades. */
  async cancelAccountClub(clientAccountId: number, refundUnused: boolean) {
    const subs = await this.prisma.clientSubscription.findMany({
      where: {
        clientAccountId,
        status: { in: ['ACTIVE', 'PAST_DUE', 'INCOMPLETE'] },
      },
      select: { id: true, status: true, stripeSubscriptionId: true, barbershopId: true },
    });
    await this.cancelClubSubs(subs, clientAccountId, refundUnused);
  }

  /** Para a cobrança do clube desta ficha na rede. O estorno do ciclo é opcional. */
  private async cancelCustomerClub(networkId: number, customerId: number, refundUnused: boolean) {
    const accountId = await this.clientAccountIdForCustomer(networkId, customerId);
    if (accountId == null) return;
    const subs = await this.prisma.clientSubscription.findMany({
      where: {
        clientAccountId: accountId,
        status: { in: ['ACTIVE', 'PAST_DUE', 'INCOMPLETE'] },
        barbershop: { networkId },
      },
      select: { id: true, status: true, stripeSubscriptionId: true, barbershopId: true },
    });
    await this.cancelClubSubs(subs, accountId, refundUnused);
  }

  private async cancelClubSubs(
    subs: Array<{
      id: number;
      status: string;
      stripeSubscriptionId: string;
      barbershopId: number;
    }>,
    clientAccountId: number,
    refundUnused: boolean,
  ) {
    if (subs.length === 0) return;
    const shopIds = [...new Set(subs.map((sub) => sub.barbershopId))];
    const refunds = refundUnused
      ? await this.unusedClubCycles(shopIds, new Date(), clientAccountId)
      : [];
    const refundBySub = new Map(refunds.map((refund) => [refund.subscriptionId, refund]));
    for (const sub of subs) {
      try {
        if (sub.status === 'ACTIVE' && !refundUnused) {
          await this.stripeService.updateSubscription(sub.stripeSubscriptionId, {
            cancel_at_period_end: true,
          });
          await this.prisma.clientSubscription.update({
            where: { id: sub.id },
            data: { cancelAtPeriodEnd: true },
          });
        } else {
          try {
            await this.stripeService.cancelSubscription(sub.stripeSubscriptionId);
          } catch (error: any) {
            if (error?.code !== 'resource_missing') throw error;
          }
          await this.prisma.clientSubscription.update({
            where: { id: sub.id },
            data: { status: 'CANCELED', canceledAt: new Date(), cancelAtPeriodEnd: false },
          });
        }
      } catch (err) {
        this.logger.error(`Erro ao cancelar a assinatura do clube #${sub.id}:`, err);
        throw new BadRequestException(CLUB_CANCEL_FAILED_MESSAGE);
      }
      const refund = refundBySub.get(sub.id);
      if (refund) await this.refundUnusedClubCycle(refund);
    }
  }

  /** Ficha da rede com este telefone, escrito de qualquer jeito (só os dígitos contam) */
  private async customerIdsByPhone(networkId: number, phone: string, onlyBlocked = false) {
    const variants = phoneDigitVariants(phone);
    if (!variants.length) return [];
    const rows = await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT id FROM "Customer"
      WHERE "networkId" = ${networkId}
        AND "deletedAt" IS NULL
        AND "phoneDigits" IN (${Prisma.join(variants)})
        ${onlyBlocked ? Prisma.sql`AND "blockedAt" IS NOT NULL` : Prisma.empty}
      ORDER BY id ASC
    `;
    return rows.map((r) => r.id);
  }

  /** Recusa cliente bloqueado (pelo telefone, e-mail ou conta) no que é online */
  private async ensureNotBlocked(
    networkId: number,
    input: {
      customerPhone?: string | null;
      customerPhones?: Array<string | null | undefined>;
      customerEmail?: string | null;
      customerEmails?: Array<string | null | undefined>;
      clientAccountId?: number | null;
    },
  ) {
    const phones = [input.customerPhone, ...(input.customerPhones ?? [])]
      .map((phone) => phone?.trim())
      .filter((phone): phone is string => !!phone);
    const blockedIds: number[] = [];
    for (const phone of phones) {
      blockedIds.push(...(await this.customerIdsByPhone(networkId, phone, true)));
    }
    const or: Prisma.CustomerWhereInput[] = phones.map((phone) => ({ phone }));
    if (blockedIds.length) or.push({ id: { in: [...new Set(blockedIds)] } });
    const emails = [input.customerEmail, ...(input.customerEmails ?? [])]
      .map((email) => email?.trim())
      .filter((email): email is string => !!email);
    for (const email of emails) or.push({ email: { equals: email, mode: 'insensitive' } });
    if (input.clientAccountId) or.push({ clientAccountId: input.clientAccountId });
    if (or.length === 0) return;
    const blocked = await this.prisma.customer.findFirst({
      where: { networkId, blockedAt: { not: null }, OR: or },
      select: { id: true },
    });
    if (blocked) {
      throw new ForbiddenException(
        'Não é possível agendar online nesta unidade. Fale diretamente com a unidade.',
      );
    }
  }

  /**
   * Conta suspensa pela plataforma não agenda pela página, nem sem login:
   * vale o e-mail e o telefone da conta e os das fichas ligadas a ela.
   * Cancelar um horário pelo link continua liberado.
   */
  private async ensureNotPlatformSuspended(input: {
    customerPhone?: string | null;
    customerPhones?: Array<string | null | undefined>;
    customerEmail?: string | null;
    customerEmails?: Array<string | null | undefined>;
    clientAccountId?: number | null;
  }) {
    const deny = () => {
      throw new ForbiddenException(PLATFORM_SUSPENDED_BOOKING_MESSAGE);
    };
    if (input.clientAccountId) {
      const account = await this.prisma.clientAccount.findFirst({
        where: { id: input.clientAccountId, deletedAt: null, suspendedAt: { not: null } },
        select: { id: true },
      });
      if (account) deny();
    }
    const emails = [input.customerEmail, ...(input.customerEmails ?? [])]
      .map((email) => email?.trim())
      .filter((email): email is string => !!email);
    if (emails.length) {
      const byAccount = await this.prisma.clientAccount.findFirst({
        where: {
          deletedAt: null,
          suspendedAt: { not: null },
          OR: emails.map((email) => ({ email: { equals: email, mode: 'insensitive' as const } })),
        },
        select: { id: true },
      });
      if (byAccount) deny();
      const byCustomer = await this.prisma.customer.findFirst({
        where: {
          deletedAt: null,
          clientAccount: { deletedAt: null, suspendedAt: { not: null } },
          OR: emails.map((email) => ({ email: { equals: email, mode: 'insensitive' as const } })),
        },
        select: { id: true },
      });
      if (byCustomer) deny();
    }
    const phones = [input.customerPhone, ...(input.customerPhones ?? [])]
      .map((phone) => phone?.trim())
      .filter((phone): phone is string => !!phone);
    for (const phone of phones) {
      const variants = phoneDigitVariants(phone);
      if (!variants.length) continue;
      const accounts = await this.prisma.$queryRaw<{ id: number }[]>`
        SELECT id FROM "ClientAccount"
        WHERE "deletedAt" IS NULL
          AND "suspendedAt" IS NOT NULL
          AND phone IS NOT NULL
          AND regexp_replace(phone, '\\D', '', 'g') IN (${Prisma.join(variants)})
        LIMIT 1
      `;
      if (accounts.length) deny();
      const customers = await this.prisma.$queryRaw<{ id: number }[]>`
        SELECT c.id FROM "Customer" c
        JOIN "ClientAccount" a ON a.id = c."clientAccountId"
        WHERE c."deletedAt" IS NULL
          AND a."deletedAt" IS NULL
          AND a."suspendedAt" IS NOT NULL
          AND c."phoneDigits" IN (${Prisma.join(variants)})
        LIMIT 1
      `;
      if (customers.length) deny();
    }
  }

  /**
   * O mesmo cliente (telefone ou conta) não marca dois horários ao mesmo
   * tempo, nem passa de 5 horários futuros pela página pública.
   */
  private async assertPublicCustomerCanBook(
    client: {
      customer: Prisma.TransactionClient['customer'];
      appointment: Prisma.TransactionClient['appointment'];
    },
    networkId: number,
    phone: string,
    clientAccountId: number | null | undefined,
    startAt: Date,
    endAt: Date,
  ) {
    const ids = new Set(await this.customerIdsByPhone(networkId, phone));
    if (clientAccountId) {
      const linked = await client.customer.findMany({
        where: { networkId, clientAccountId, deletedAt: null },
        select: { id: true },
      });
      for (const row of linked) ids.add(row.id);
    }
    if (ids.size === 0) return;
    const customerId = { in: [...ids] };
    const overlap = await client.appointment.findFirst({
      where: {
        customerId,
        barbershop: { networkId },
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { id: true },
    });
    if (overlap) throw new BadRequestException('Você já tem um horário nesse período');
    const upcoming = await client.appointment.count({
      where: {
        customerId,
        barbershop: { networkId },
        status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] },
        startAt: { gt: new Date() },
      },
    });
    if (upcoming >= PUBLIC_UPCOMING_LIMIT) {
      throw new BadRequestException(
        'Você já tem 5 horários marcados. Cancele um para marcar outro.',
      );
    }
  }

  // ============ BARBER ============

  /** Confere a vaga do plano pra alguém que vai passar a atender (dono não ocupa) */
  private async ensureSeatFor(barbershopId: number, personUserId: number | null) {
    if (personUserId != null && (await this.shopOwnerIds(barbershopId)).includes(personUserId)) {
      return;
    }
    await this.ensureBarberLimitNotExceeded(barbershopId);
  }

  async createBarber(
    userId: number,
    barbershopId: number,
    data: {
      name: string;
      phone: string;
      email?: string;
      avatarUrl?: string;
      specialization?: string;
      specialties?: TreatmentCategory[];
      hireDate?: Date;
      takesAppointments?: boolean | null;
    },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    await assertSoloSinglePerson(this.prisma, barbershopId);
    // Só ocupa vaga quem atende (o padrão aqui é barbeiro)
    if (data.takesAppointments !== false) await this.ensureBarberLimitNotExceeded(barbershopId);

    const phone = data.phone.trim();
    const existingByPhone = await this.prisma.barber.findFirst({
      where: { barbershopId, phone, isActive: true },
    });
    if (existingByPhone) {
      throw new BadRequestException('Já existe um funcionário com este telefone nesta unidade');
    }

    if (data.email) {
      const email = data.email.toLowerCase().trim();
      const existingByEmail = await this.prisma.barber.findFirst({
        where: { barbershopId, email, isActive: true },
      });
      if (existingByEmail) {
        throw new BadRequestException('Já existe um funcionário com este email nesta unidade');
      }
    }

    return this.prisma.barber.create({
      data: { barbershopId, ...data },
    });
  }

  async getBarbers(userId: number, barbershopId: number, activeOnly?: boolean) {
    const shop = await this.ensureBarbershopAccess(userId, barbershopId, 'basic');
    const where: any = { barbershopId };
    if (activeOnly) where.isActive = true;
    // O link do convite entra na equipe: só gerente e dono recebem
    const canInvite = ACCESS_RANK[shop.accessLevel] >= ACCESS_RANK.manager;
    const barbers = await this.prisma.barber.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        schedules: true,
        employeeInvites: {
          where: { status: 'PENDING' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { inviteToken: true, expiresAt: true },
        },
      },
    });
    return barbers.map(({ employeeInvites, ...barber }) => ({
      ...barber,
      pendingInviteToken: canInvite ? employeeInvites[0]?.inviteToken ?? null : null,
      pendingInviteExpiresAt: canInvite ? employeeInvites[0]?.expiresAt ?? null : null,
    }));
  }

  async updateBarber(
    userId: number,
    barbershopId: number,
    barberId: number,
    data: Partial<{
      name: string;
      phone: string;
      email: string;
      avatarUrl: string;
      specialization: string;
      specialties: TreatmentCategory[];
      isActive: boolean;
      staffType: string;
      takesAppointments: boolean | null;
      accessStartsAt: string | Date | null;
      accessEndsAt: string | Date | null;
    }>,
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const barber = await this.prisma.barber.findFirst({
      where: { id: barberId, barbershopId },
    });
    if (!barber) throw new NotFoundException('Profissional não encontrado');
    const period = parseEngagementPeriod(
      data.accessStartsAt === undefined ? barber.accessStartsAt : data.accessStartsAt,
      data.accessEndsAt === undefined ? barber.accessEndsAt : data.accessEndsAt,
    );
    if (data.accessStartsAt !== undefined) data.accessStartsAt = period.accessStartsAt;
    if (data.accessEndsAt !== undefined) data.accessEndsAt = period.accessEndsAt;
    if (data.staffType !== undefined && !isStaffType(data.staffType)) {
      throw new BadRequestException('Cargo inválido');
    }
    // Mudou o cargo sem dizer se atende: volta a seguir o cargo
    if (data.staffType !== undefined && data.takesAppointments === undefined) {
      data.takesAppointments = null;
    }
    // Foto ocultada pela moderação: um link novo (quando é ele que aparece)
    // é outra foto e volta à página
    if (
      barber.avatarHiddenAt &&
      !barber.avatarKey &&
      data.avatarUrl !== undefined &&
      data.avatarUrl !== barber.avatarUrl
    ) {
      Object.assign(data, { avatarHiddenAt: null });
    }
    const servesBefore = takesAppointments(barber);
    const servesAfter = takesAppointments({
      takesAppointments:
        data.takesAppointments === undefined ? barber.takesAppointments : data.takesAppointments,
      staffType: data.staffType ?? barber.staffType,
    });
    // Quem deixa de atender não pode ter horário marcado
    if (servesBefore && !servesAfter) {
      const upcoming = await this.prisma.appointment.count({
        where: {
          barberId,
          startAt: { gte: new Date() },
          status: { notIn: ['CANCELLED', 'COMPLETED', 'NO_SHOW'] },
        },
      });
      if (upcoming > 0) {
        throw new BadRequestException(
          'Esse profissional tem agendamentos marcados. Remarque-os antes de ele deixar de atender.',
        );
      }
    }
    // Passou a ocupar vaga (começou a atender, voltou a ficar ativo ou o
    // vínculo encerrado foi estendido e voltou a valer)
    const now = new Date();
    const activeAfter = data.isActive ?? barber.isActive;
    const endsAfter = data.accessEndsAt === undefined ? barber.accessEndsAt : data.accessEndsAt;
    const inPeriodBefore = barber.accessEndsAt == null || barber.accessEndsAt >= now;
    const inPeriodAfter = endsAfter == null || new Date(endsAfter) >= now;
    if (
      activeAfter &&
      servesAfter &&
      inPeriodAfter &&
      !(barber.isActive && servesBefore && inPeriodBefore)
    ) {
      await this.ensureSeatFor(barbershopId, barber.userId);
    }
    // Desmarcar "Ativo" na edição é o mesmo que remover da equipe: cancela o
    // convite pendente e avisa dono e gerente dos horários que ficaram
    if (barber.isActive && data.isActive === false) {
      const [updated] = await this.prisma.$transaction([
        this.prisma.barber.update({ where: { id: barberId }, data }),
        this.prisma.employeeInvite.updateMany({
          where: { barberId, status: 'PENDING' },
          data: { status: 'CANCELLED' },
        }),
      ]);
      this.realtime.notify(barbershopId, 'BARBER', 'UPDATED');
      await this.warnFutureAppointments(barbershopId, barber.name, barberId, now);
      return updated;
    }
    return this.prisma.barber.update({ where: { id: barberId }, data });
  }

  async deleteBarber(userId: number, barbershopId: number, barberId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const barber = await this.prisma.barber.findFirst({
      where: { id: barberId, barbershopId },
    });
    if (!barber) throw new NotFoundException('Profissional não encontrado');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.barber.update({
        where: { id: barberId },
        data: { isActive: false },
      }),
      // O link do convite pendente deixaria a pessoa entrar num vínculo já desligado
      this.prisma.employeeInvite.updateMany({
        where: { barberId, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      }),
    ]);
    this.realtime.notify(barbershopId, 'BARBER', 'UPDATED');
    await this.warnFutureAppointments(barbershopId, barber.name, barberId, now);
  }

  /** Quem administra a unidade fica sabendo dos horários que ainda estão neste profissional. */
  private async warnFutureAppointments(
    barbershopId: number,
    barberName: string,
    barberId: number,
    now: Date,
  ) {
    const [shop, managers, future] = await Promise.all([
      this.prisma.barbershop.findUnique({
        where: { id: barbershopId },
        select: { ownerUserId: true },
      }),
      this.prisma.barber.findMany({
        where: { barbershopId, isActive: true, staffType: 'manager', userId: { not: null } },
        select: { userId: true },
      }),
      this.prisma.appointment.count({
        where: {
          barberId,
          startAt: { gte: now },
          status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] },
        },
      }),
    ]);
    if (!future || !shop) return;
    const userIds = [
      ...new Set(
        [shop.ownerUserId, ...managers.map((m) => m.userId)].filter((id): id is number => !!id),
      ),
    ];
    if (!userIds.length) return;
    const copy: Record<Lang, { title: string; message: string }> = {
      pt: {
        title: 'Horários para remanejar',
        message: `${barberName} saiu da equipe e ainda tem ${future} horário(s) marcado(s). Passe esses clientes para outra pessoa.`,
      },
      en: {
        title: 'Appointments to reassign',
        message: `${barberName} left the team and still has ${future} upcoming appointment(s). Move those clients to someone else.`,
      },
      es: {
        title: 'Horarios para reasignar',
        message: `${barberName} salió del equipo y todavía tiene ${future} cita(s). Pase esos clientes a otra persona.`,
      },
    };
    if (this.notifications) {
      await this.notifications.createNotificationsForUsers(
        userIds,
        {
          title: copy.pt.title,
          message: copy.pt.message,
          type: NotificationType.WARNING,
          actionUrl: `/barbershops/${barbershopId}/appointments`,
          localized: copy,
        },
        { inApp: 'teamInApp' },
      );
      return;
    }
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, isActive: true, deleted_at: null },
      select: { id: true, userSystemConfig: { select: { language: true } } },
    });
    await this.prisma.userNotification.createMany({
      data: users.map((user) => {
        const text = copy[normalizeLang(user.userSystemConfig?.language)];
        return {
          userId: user.id,
          type: 'warning',
          title: text.title,
          message: text.message,
          actionUrl: `/barbershops/${barbershopId}/appointments`,
        };
      }),
    });
  }

  async reactivateBarber(userId: number, barbershopId: number, barberId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const barber = await this.prisma.barber.findFirst({
      where: { id: barberId, barbershopId },
    });
    if (!barber) throw new NotFoundException('Profissional não encontrado');
    // Antes não conferia o plano: reativar quem atende ocupa vaga de novo
    if (!barber.isActive && takesAppointments(barber)) {
      await this.ensureSeatFor(barbershopId, barber.userId);
    }
    return this.prisma.barber.update({
      where: { id: barberId },
      data: { isActive: true },
    });
  }

  async requestBarberPasswordReset(userId: number, barbershopId: number, barberId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const barber = await this.prisma.barber.findFirst({
      where: { id: barberId, barbershopId },
      include: { user: true },
    });
    if (!barber) throw new NotFoundException('Profissional não encontrado');
    const email = barber.user?.email ?? barber.email;
    if (!email) throw new BadRequestException('Profissional não possui email cadastrado');
    const user = await this.prisma.user.findFirst({
      where: { email, provider: 'local' },
    });
    if (!user)
      throw new BadRequestException(
        'O funcionário ainda não criou a conta. Peça que aceite o convite por email primeiro.',
      );
    await this.userService.forgotPass({ email });
    return true;
  }

  // ============ SERVICES (BarbershopService) ============

  async createService(
    userId: number,
    barbershopId: number,
    data: {
      name: string;
      description?: string;
      durationMinutes: number;
      price: number | Decimal;
      category: TreatmentCategory;
      depositAmount?: number | Decimal | null;
      displayOrder?: number;
    },
  ) {
    const shop = await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    checkServiceValues(data, shop.currency);
    const { depositAmount, ...rest } = data;
    return this.prisma.barbershopService.create({
      data: {
        barbershopId,
        ...rest,
        price: new Decimal(data.price),
        depositAmount: depositAmount != null ? new Decimal(depositAmount) : null,
        displayOrder: data.displayOrder ?? 0,
      },
    });
  }

  async getServices(userId: number, barbershopId: number, activeOnly?: boolean) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'basic');
    const where: any = { barbershopId };
    if (activeOnly) where.isActive = true;
    return this.prisma.barbershopService.findMany({
      where,
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async updateService(
    userId: number,
    barbershopId: number,
    serviceId: number,
    data: Partial<{
      name: string;
      description: string;
      durationMinutes: number;
      price: number | Decimal;
      category: TreatmentCategory;
      depositAmount: number | Decimal | null;
      isActive: boolean;
      displayOrder: number;
    }>,
  ) {
    const shop = await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const current = await this.prisma.barbershopService.findFirst({
      where: { id: serviceId, barbershopId },
    });
    if (!current) throw new NotFoundException('Serviço não encontrado');
    if (data.isActive === false && current.isActive) {
      await this.assertServiceDeactivationConfirmed(barbershopId, serviceId, false);
    }
    // O sinal é conferido com o preço que vai ficar (o novo ou o atual)
    checkServiceValues(
      {
        ...data,
        depositAmount:
          data.depositAmount !== undefined ? data.depositAmount : current.depositAmount,
      },
      shop.currency,
      current,
    );
    const price = data.price !== undefined ? new Decimal(data.price) : undefined;
    const depositAmount =
      data.depositAmount !== undefined
        ? data.depositAmount != null
          ? new Decimal(data.depositAmount)
          : null
        : undefined;
    return this.prisma.barbershopService.update({
      where: { id: serviceId },
      data: { ...data, price, depositAmount },
    });
  }

  async deleteService(userId: number, barbershopId: number, serviceId: number, confirm = false) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const current = await this.prisma.barbershopService.findFirst({
      where: { id: serviceId, barbershopId },
    });
    if (!current) throw new NotFoundException('Serviço não encontrado');
    await this.assertServiceDeactivationConfirmed(barbershopId, serviceId, confirm);
    await this.prisma.barbershopService.update({
      where: { id: serviceId },
      data: { isActive: false },
    });
  }

  /** O que continua ligado ao serviço: a tela mostra e a pessoa confirma. */
  async serviceDeactivationPreview(userId: number, barbershopId: number, serviceId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const current = await this.prisma.barbershopService.findFirst({
      where: { id: serviceId, barbershopId },
      select: { id: true },
    });
    if (!current) throw new NotFoundException('Serviço não encontrado');
    return this.serviceDeactivationLinks(barbershopId, serviceId);
  }

  private async serviceDeactivationLinks(barbershopId: number, serviceId: number) {
    const [plans, packagesForSale, balanceRows, futureAppointments] = await Promise.all([
      this.prisma.clientSubscriptionPlan.findMany({
        where: { barbershopId, serviceId, isActive: true },
        select: {
          id: true,
          name: true,
          _count: {
            select: {
              subscriptions: {
                where: { status: { in: ['ACTIVE', 'PAST_DUE', 'INCOMPLETE'] } },
              },
            },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.servicePackage.findMany({
        where: { barbershopId, serviceId, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM "ClientPackage" cp
        JOIN "ServicePackage" sp ON sp.id = cp."servicePackageId"
        WHERE cp."barbershopId" = ${barbershopId}
          AND sp."serviceId" = ${serviceId}
          AND cp.status = 'ACTIVE'
          AND cp."remainderRefundedAt" IS NULL
          AND cp."usedSessions" < cp."totalSessions"
      `,
      this.prisma.appointment.count({
        where: {
          barbershopId,
          startAt: { gte: new Date() },
          status: { in: ['CONFIRMED', 'PENDING_PAYMENT', 'IN_PROGRESS'] },
          services: { some: { serviceId } },
        },
      }),
    ]);
    return {
      plans: plans.map((plan) => ({
        id: plan.id,
        name: plan.name,
        subscribers: plan._count.subscriptions,
      })),
      packagesForSale,
      packagesWithBalance: Number(balanceRows[0]?.count ?? 0),
      futureAppointments,
    };
  }

  private async assertServiceDeactivationConfirmed(
    barbershopId: number,
    serviceId: number,
    confirm: boolean,
  ) {
    const links = await this.serviceDeactivationLinks(barbershopId, serviceId);
    const linked =
      links.plans.length > 0 ||
      links.packagesForSale.length > 0 ||
      links.packagesWithBalance > 0 ||
      links.futureAppointments > 0;
    if (linked && !confirm) {
      throw new BadRequestException(
        'Este serviço tem plano, pacote ou horário marcado. Confirme a desativação.',
      );
    }
  }

  // ============ PRODUCT CATEGORIES ============

  async getProductCategories(userId: number, barbershopId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    return this.prisma.productCategory.findMany({
      where: { barbershopId },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async createProductCategory(
    userId: number,
    barbershopId: number,
    data: { name: string; icon?: string; color?: string; displayOrder?: number },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    return this.prisma.productCategory.create({
      data: {
        barbershopId,
        name: data.name.trim(),
        icon: data.icon || null,
        color: data.color || null,
        displayOrder: data.displayOrder ?? 0,
      },
    });
  }

  async updateProductCategory(
    userId: number,
    barbershopId: number,
    categoryId: number,
    data: Partial<{ name: string; icon?: string; color?: string; displayOrder?: number }>,
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const current = await this.prisma.productCategory.findFirst({
      where: { id: categoryId, barbershopId },
    });
    if (!current) throw new NotFoundException('Categoria não encontrada nesta unidade');
    return this.prisma.productCategory.update({
      where: { id: categoryId },
      data: {
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.icon !== undefined && { icon: data.icon || null }),
        ...(data.color !== undefined && { color: data.color || null }),
        ...(data.displayOrder !== undefined && { displayOrder: data.displayOrder }),
      },
    });
  }

  async deleteProductCategory(userId: number, barbershopId: number, categoryId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const current = await this.prisma.productCategory.findFirst({
      where: { id: categoryId, barbershopId },
    });
    if (!current) throw new NotFoundException('Categoria não encontrada nesta unidade');
    await this.prisma.productCategory.delete({ where: { id: categoryId } });
  }

  // ============ PRODUCTS ============

  async createProduct(
    userId: number,
    barbershopId: number,
    data: {
      name: string;
      categoryId?: number;
      sku?: string;
      description?: string;
      salePrice: number | Decimal;
      costPrice?: number | Decimal;
      unit?: string;
      icon?: string;
    },
  ) {
    const shop = await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    checkMoney('Preço de venda', Number(data.salePrice), shop.currency);
    checkMoney('Custo', data.costPrice != null ? Number(data.costPrice) : null, shop.currency);
    if (data.categoryId) await this.categoryOfShop(barbershopId, data.categoryId);
    return this.prisma.barbershopProduct.create({
      data: {
        barbershopId,
        ...data,
        categoryId: data.categoryId ?? null,
        salePrice: new Decimal(data.salePrice),
        costPrice: data.costPrice != null ? new Decimal(data.costPrice) : null,
        unit: data.unit ?? 'UNIT',
      },
    });
  }

  async getProducts(userId: number, barbershopId: number, activeOnly?: boolean) {
    const shop = await this.ensureBarbershopAccess(userId, barbershopId);
    const where: any = { barbershopId };
    if (activeOnly) where.isActive = true;
    const products = await this.prisma.barbershopProduct.findMany({
      where,
      include: { category: true },
      orderBy: { name: 'asc' },
    });
    return products.map((p) => withCostFor(shop.accessLevel, p));
  }

  async updateProduct(
    userId: number,
    barbershopId: number,
    productId: number,
    data: Partial<{
      name: string;
      categoryId: number;
      sku: string;
      description: string;
      salePrice: number | Decimal;
      costPrice: number | Decimal;
      unit: string;
      isActive: boolean;
      icon: string;
    }>,
  ) {
    const shop = await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const current = await this.prisma.barbershopProduct.findFirst({
      where: { id: productId, barbershopId },
    });
    if (!current) throw new NotFoundException('Produto não encontrado');
    checkMoney(
      'Preço de venda',
      data.salePrice != null ? Number(data.salePrice) : null,
      shop.currency,
    );
    checkMoney('Custo', data.costPrice != null ? Number(data.costPrice) : null, shop.currency);
    if (data.categoryId) await this.categoryOfShop(barbershopId, data.categoryId);
    const salePrice = data.salePrice !== undefined ? new Decimal(data.salePrice) : undefined;
    const costPrice = data.costPrice !== undefined ? new Decimal(data.costPrice) : undefined;
    const updateData: any = { ...data, salePrice, costPrice };
    if (data.categoryId !== undefined) updateData.categoryId = data.categoryId || null;
    return this.prisma.barbershopProduct.update({
      where: { id: productId },
      data: updateData,
    });
  }

  async deleteProduct(userId: number, barbershopId: number, productId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const current = await this.prisma.barbershopProduct.findFirst({
      where: { id: productId, barbershopId },
    });
    if (!current) throw new NotFoundException('Produto não encontrado');
    await this.prisma.barbershopProduct.update({
      where: { id: productId },
      data: { isActive: false },
    });
  }

  private async categoryOfShop(barbershopId: number, categoryId: number) {
    const category = await this.prisma.productCategory.findFirst({
      where: { id: categoryId, barbershopId },
    });
    if (!category) throw new NotFoundException('Categoria não encontrada nesta unidade');
    return category;
  }

  // ============ INVENTORY ============

  async getInventory(userId: number, barbershopId: number) {
    const shop = await this.ensureBarbershopAccess(userId, barbershopId);
    await this.ensureModuleAccess(barbershopId, 'inventory');
    const items = await this.prisma.inventoryItem.findMany({
      where: { barbershopId },
      include: { product: { include: { category: true } } },
      orderBy: { product: { name: 'asc' } },
    });
    return items.map((i) => ({ ...i, product: withCostFor(shop.accessLevel, i.product) }));
  }

  /**
   * Ajuste manual de estoque (compra, contagem, perda...). Diferente da
   * baixa automática de venda (ver createSale), aqui bloqueamos o saldo
   * ficar negativo — é entrada manual, então um erro de digitação não deve
   * silenciosamente deixar o estoque errado.
   */
  async adjustInventory(
    userId: number,
    barbershopId: number,
    data: { productId: number; quantityChange: number; movementType?: string; notes?: string },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    await this.ensureModuleAccess(barbershopId, 'inventory');
    // "SALE" é só da baixa automática da venda: uma entrada manual com esse
    // tipo se confundia com ela no estorno
    if (data.movementType != null && !STOCK_MOVEMENTS.includes(data.movementType)) {
      throw new BadRequestException(STOCK_MOVEMENT_MESSAGE);
    }
    if (!Number.isFinite(data.quantityChange) || data.quantityChange === 0) {
      throw new BadRequestException(STOCK_QUANTITY_MESSAGE);
    }
    const product = await this.prisma.barbershopProduct.findFirst({
      where: { id: data.productId, barbershopId },
    });
    if (!product) {
      throw new NotFoundException('Produto não encontrado nesta unidade');
    }
    return this.prisma.$transaction(async (tx) => {
      const {
        inventoryItem: item,
        quantityBefore,
        quantityAfter,
      } = await moveStock(tx, barbershopId, data.productId, product.unit, data.quantityChange);
      // Confere depois de aplicar (o saldo que voltou é o de verdade, mesmo
      // com outra baixa ao mesmo tempo); negativo desfaz a transação
      if (quantityAfter < 0) {
        throw new BadRequestException('Estoque não pode ficar negativo');
      }
      await tx.inventoryMovement.create({
        data: {
          inventoryItemId: item.id,
          movementType: data.movementType ?? 'ADJUSTMENT',
          quantityChange: data.quantityChange,
          quantityBefore,
          quantityAfter,
          referenceType: 'MANUAL',
          notes: data.notes,
        },
      });
      return tx.inventoryItem.findUnique({
        where: { id: item.id },
        include: { product: { include: { category: true } } },
      });
    });
  }

  async updateInventoryItem(
    userId: number,
    barbershopId: number,
    productId: number,
    data: { minQuantity?: number; location?: string },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    await this.ensureModuleAccess(barbershopId, 'inventory');
    if (data.minQuantity != null && (!Number.isFinite(data.minQuantity) || data.minQuantity < 0)) {
      throw new BadRequestException(STOCK_MIN_MESSAGE);
    }
    const product = await this.prisma.barbershopProduct.findFirst({
      where: { id: productId, barbershopId },
    });
    if (!product) {
      throw new NotFoundException('Produto não encontrado nesta unidade');
    }
    return this.prisma.inventoryItem.upsert({
      where: { barbershopId_productId: { barbershopId, productId } },
      create: {
        barbershopId,
        productId,
        quantity: 0,
        unit: product.unit,
        minQuantity: data.minQuantity,
        location: data.location,
      },
      update: {
        ...(data.minQuantity !== undefined && { minQuantity: data.minQuantity }),
        ...(data.location !== undefined && { location: data.location || null }),
      },
      include: { product: { include: { category: true } } },
    });
  }

  async getInventoryMovements(userId: number, barbershopId: number, productId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    await this.ensureModuleAccess(barbershopId, 'inventory');
    const item = await this.prisma.inventoryItem.findUnique({
      where: { barbershopId_productId: { barbershopId, productId } },
    });
    if (!item) return [];
    return this.prisma.inventoryMovement.findMany({
      where: { inventoryItemId: item.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  // ============ BARBER SCHEDULE ============

  async getBarberSchedules(userId: number, barbershopId: number, barberId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'basic');
    return this.prisma.barberSchedule.findMany({
      where: { barberId, isActive: true },
      orderBy: { dayOfWeek: 'asc' },
    });
  }

  async getBarberSchedulesByBarber(userId: number, barberId: number) {
    const barber = await this.prisma.barber.findUnique({ where: { id: barberId } });
    if (!barber) throw new NotFoundException('Profissional não encontrado');
    return this.getBarberSchedules(userId, barber.barbershopId, barberId);
  }

  async createBarberSchedule(
    userId: number,
    input: {
      barberId: number;
      dayOfWeek: number;
      startTime: string;
      endTime: string;
      breakStart?: string;
      breakEnd?: string;
    },
  ) {
    const barber = await this.prisma.barber.findUnique({ where: { id: input.barberId } });
    if (!barber) throw new NotFoundException('Profissional não encontrado');
    await this.ensureCanManageBarber(userId, barber.barbershopId, barber.id);
    // As mesmas regras da escala da semana (antes passava qualquer texto)
    if (!Number.isInteger(input.dayOfWeek) || input.dayOfWeek < 0 || input.dayOfWeek > 6) {
      throw new BadRequestException('Dia da semana inválido');
    }
    checkShift(input.startTime, input.endTime, input.breakStart, input.breakEnd);
    const taken = await this.prisma.barberSchedule.findUnique({
      where: { barberId_dayOfWeek: { barberId: barber.id, dayOfWeek: input.dayOfWeek } },
      select: { id: true },
    });
    if (taken) throw new BadRequestException(SHIFT_DAY_TAKEN_MESSAGE);
    await this.ensureShiftFreeAcrossShops(
      input.barberId,
      input.dayOfWeek,
      input.startTime,
      input.endTime,
    );
    return this.withWaitlistOpening(barber.barbershopId, { barberId: barber.id }, () =>
      this.prisma.barberSchedule.create({
        data: {
          barberId: input.barberId,
          dayOfWeek: input.dayOfWeek,
          startTime: input.startTime,
          endTime: input.endTime,
          breakStart: input.breakStart,
          breakEnd: input.breakEnd,
        },
      }),
    );
  }

  async updateBarberSchedule(
    userId: number,
    id: number,
    data: {
      startTime?: string;
      endTime?: string;
      breakStart?: string;
      breakEnd?: string;
      isActive?: boolean;
    },
  ) {
    const schedule = await this.prisma.barberSchedule.findUnique({
      where: { id },
      include: { barber: true },
    });
    if (!schedule) throw new NotFoundException('Horário não encontrado');
    await this.ensureCanManageBarber(userId, schedule.barber.barbershopId, schedule.barberId);
    const startTime = data.startTime ?? schedule.startTime;
    const endTime = data.endTime ?? schedule.endTime;
    const active = data.isActive ?? schedule.isActive;
    if (active) {
      checkShift(
        startTime,
        endTime,
        data.breakStart !== undefined ? data.breakStart : schedule.breakStart,
        data.breakEnd !== undefined ? data.breakEnd : schedule.breakEnd,
      );
      await this.ensureShiftFreeAcrossShops(
        schedule.barberId,
        schedule.dayOfWeek,
        startTime,
        endTime,
      );
    }
    return this.withWaitlistOpening(
      schedule.barber.barbershopId,
      { barberId: schedule.barberId },
      () => this.prisma.barberSchedule.update({ where: { id }, data }),
    );
  }

  async deleteBarberSchedule(userId: number, id: number) {
    const schedule = await this.prisma.barberSchedule.findUnique({
      where: { id },
      include: { barber: true },
    });
    if (!schedule) throw new NotFoundException('Horário não encontrado');
    await this.ensureCanManageBarber(userId, schedule.barber.barbershopId, schedule.barberId);
    await this.prisma.barberSchedule.delete({ where: { id } });
  }

  // ============ BARBER TIME OFF ============

  /**
   * Folga/férias/afastamento de um profissional (gerente e dono; o
   * barbeiro, só a própria). O período sai da página pública e da série;
   * horários já marcados nele continuam — volta quantos são, pra equipe
   * remarcar ou cancelar.
   */
  async createBarberTimeOff(
    userId: number,
    input: { barberId: number; startAt: string; endAt: string; reason?: string },
  ) {
    const barber = await this.prisma.barber.findUnique({ where: { id: input.barberId } });
    if (!barber) throw new NotFoundException('Profissional não encontrado');
    await this.ensureCanManageBarber(userId, barber.barbershopId, barber.id);
    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);
    if (isNaN(startAt.getTime()) || isNaN(endAt.getTime()) || endAt <= startAt) {
      throw new BadRequestException('Período inválido');
    }
    if (endAt.getTime() - startAt.getTime() > MAX_TIME_OFF_DAYS * 86_400_000) {
      throw new BadRequestException(`O período pode ter no máximo ${MAX_TIME_OFF_DAYS} dias`);
    }
    const reason = input.reason ?? 'PERSONAL';
    if (!TIME_OFF_REASONS.includes(reason)) throw new BadRequestException('Motivo inválido');
    const [timeOff, affectedAppointments] = await Promise.all([
      this.prisma.barberTimeOff.create({
        data: { barberId: input.barberId, startAt, endAt, reason },
      }),
      this.prisma.appointment.count({
        where: {
          barberId: barber.id,
          status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] },
          startAt: { lt: endAt },
          endAt: { gt: startAt },
        },
      }),
    ]);
    this.realtime.notify(barber.barbershopId, 'APPOINTMENT', 'UPDATED');
    return { ...timeOff, affectedAppointments };
  }

  /** Folgas da unidade num período (fundo da agenda); barbeiro vê só as dele. */
  async getBarbershopTimeOffs(userId: number, barbershopId: number, startAt: Date, endAt: Date) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'basic');
    const own = await this.ownBarberIdIfBarber(userId, barbershop);
    const rows = await this.prisma.barberTimeOff.findMany({
      where: {
        barber: { barbershopId },
        ...(own !== null ? { barberId: own } : {}),
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      include: { barber: { select: { name: true } } },
      orderBy: { startAt: 'asc' },
      take: 500,
    });
    const reason = timeOffReasonFor(barbershop.accessLevel, own !== null);
    return rows.map(({ barber, ...t }) => ({
      ...t,
      reason: reason(t.reason),
      barberName: barber.name,
    }));
  }

  async deleteBarberTimeOff(userId: number, timeOffId: number) {
    const timeOff = await this.prisma.barberTimeOff.findUnique({
      where: { id: timeOffId },
      include: { barber: true },
    });
    if (!timeOff) throw new NotFoundException('Afastamento não encontrado');
    await this.ensureCanManageBarber(userId, timeOff.barber.barbershopId, timeOff.barberId);
    // Folga desfeita: os dias dela podem ter aberto horário
    const tz = safeTimeZone(
      (
        await this.prisma.barbershop.findUnique({
          where: { id: timeOff.barber.barbershopId },
          select: { timezone: true },
        })
      )?.timezone,
    );
    await this.withWaitlistOpening(
      timeOff.barber.barbershopId,
      {
        barberId: timeOff.barberId,
        from: toZonedParts(timeOff.startAt, tz).dateStr,
        to: toZonedParts(timeOff.endAt, tz).dateStr,
      },
      () => this.prisma.barberTimeOff.delete({ where: { id: timeOffId } }),
    );
    this.realtime.notify(timeOff.barber.barbershopId, 'APPOINTMENT', 'UPDATED');
    return true;
  }

  async getBarberTimeOffsByBarber(
    userId: number,
    barberId: number,
    filters?: { startAt?: Date; endAt?: Date },
  ) {
    const barber = await this.prisma.barber.findUnique({ where: { id: barberId } });
    if (!barber) throw new NotFoundException('Profissional não encontrado');
    const shop = await this.ensureBarbershopAccess(userId, barber.barbershopId, 'basic');
    // Barbeiro e barbeiro básico: só as próprias folgas (como na agenda)
    const own = await this.ownBarberIdIfBarber(userId, shop);
    if (own !== null && own !== barberId) {
      throw new NotFoundException('Profissional não encontrado');
    }
    const where: any = { barberId };
    if (filters?.startAt || filters?.endAt) {
      where.AND = [];
      if (filters.startAt) where.AND.push({ endAt: { gte: filters.startAt } });
      if (filters.endAt) where.AND.push({ startAt: { lte: filters.endAt } });
    }
    const rows = await this.prisma.barberTimeOff.findMany({
      where,
      orderBy: { startAt: 'desc' },
    });
    const reason = timeOffReasonFor(shop.accessLevel, own !== null);
    return rows.map((t) => ({ ...t, reason: reason(t.reason) }));
  }

  // ============ APPOINTMENTS ============

  /**
   * Trava a agenda do barbeiro (e do recurso, se houver) até o fim da
   * transação. Sem isso, a checagem de conflito ("tem alguém nesse
   * horário?") e a gravação eram passos separados: duas reservas
   * simultâneas passavam as duas pela checagem e o mesmo horário era
   * vendido duas vezes (reproduzido no teste de integração com 5 reservas
   * ao mesmo tempo). Advisory lock do Postgres por barbeiro: reservas de
   * barbeiros diferentes continuam em paralelo.
   */
  private async lockSchedule(tx: Prisma.TransactionClient, barberId: number, resourceId?: number) {
    // Quem tem conta pode atender em várias unidades: a trava é da pessoa,
    // pra duas unidades não venderem o mesmo horário dela ao mesmo tempo
    const barber = await tx.barber.findUnique({
      where: { id: barberId },
      select: { userId: true },
    });
    if (barber?.userId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(3, ${barber.userId}::int)`;
    } else {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(1, ${barberId}::int)`;
    }
    if (resourceId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(2, ${resourceId}::int)`;
    }
  }

  // Tudo que vem por id do front precisa pertencer a esta barbearia/rede —
  // antes dava pra agendar/vender pra cliente de outra franquia (e resgatar
  // os pontos de fidelidade dele), ou usar barbeiro/serviço/produto de outra
  // unidade, só trocando o id na requisição.
  private async ensureCustomerOfNetwork(networkId: number, customerId: number) {
    // Ficha excluída (anonimizada) não recebe agendamento, venda nem fila
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, networkId, deletedAt: null },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado');
  }

  /**
   * Profissional desta unidade que atende. Com `active`, também precisa
   * estar ativo (agendar ou mover horário pra ele); a venda não pede, pra
   * ainda dar pra cobrar o atendimento de quem já saiu
   */
  private async ensureBarberOfBarbershop(
    barbershopId: number,
    barberId: number,
    opts: { active?: boolean } = {},
  ) {
    const barber = await this.prisma.barber.findFirst({
      where: {
        id: barberId,
        barbershopId,
        ...BOOKABLE_STAFF,
        ...(opts.active ? { isActive: true } : {}),
      },
      select: { id: true },
    });
    if (!barber) throw new NotFoundException('Profissional não encontrado');
  }

  private async ensureResourceOfBarbershop(barbershopId: number, resourceId: number) {
    const resource = await this.prisma.resource.findFirst({
      where: { id: resourceId, barbershopId, isActive: true },
      select: { id: true },
    });
    if (!resource) throw new NotFoundException('Recurso não encontrado');
  }

  private async ensureItemsOfBarbershop(
    barbershopId: number,
    serviceIds: number[],
    productIds: number[] = [],
  ) {
    const uniqueServices = [...new Set(serviceIds)];
    const uniqueProducts = [...new Set(productIds)];
    const [services, products] = await Promise.all([
      uniqueServices.length
        ? this.prisma.barbershopService.count({
            where: { id: { in: uniqueServices }, barbershopId },
          })
        : 0,
      uniqueProducts.length
        ? this.prisma.barbershopProduct.count({
            where: { id: { in: uniqueProducts }, barbershopId },
          })
        : 0,
    ]);
    if (services !== uniqueServices.length) throw new NotFoundException('Serviço não encontrado');
    if (products !== uniqueProducts.length) throw new NotFoundException('Produto não encontrado');
  }

  private async ensureServiceHistoriesOfBarbershop(barbershopId: number, historyIds: number[]) {
    const unique = [...new Set(historyIds)];
    if (unique.length === 0) return;
    const found = await this.prisma.serviceHistory.count({
      where: { id: { in: unique }, barbershopId },
    });
    if (found !== unique.length) {
      throw new NotFoundException('Histórico de atendimento não encontrado nesta unidade');
    }
  }

  private async ensureResourceAvailable(
    barbershopId: number,
    resourceId: number,
    startAt: Date,
    endAt: Date,
    excludeAppointmentId?: number,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const conflict = await client.appointment.findFirst({
      where: {
        barbershopId,
        resourceId,
        id: excludeAppointmentId ? { not: excludeAppointmentId } : undefined,
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
    });
    if (conflict) {
      throw new BadRequestException('Recurso já reservado nesse horário');
    }
  }

  /** Os vínculos da mesma pessoa em todas as unidades (ou só este, sem conta) */
  private async samePersonBarberIds(
    barberId: number,
    person: { userId?: number | null; professionalId?: number | null } | null | undefined,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<number[]> {
    if (person?.professionalId) {
      const all = await client.barber.findMany({
        where: { professionalId: person.professionalId },
        select: { id: true },
      });
      return [...new Set([barberId, ...all.map((b) => b.id)])];
    }
    if (person?.userId) {
      const all = await client.barber.findMany({
        where: { userId: person.userId },
        select: { id: true },
      });
      return [...new Set([barberId, ...all.map((b) => b.id)])];
    }
    return [barberId];
  }

  /**
   * Escala semanal: o mesmo turno não vale em duas unidades. Compara com a
   * escala própria da pessoa nas outras unidades em que está ativa. O horário
   * padrão da outra unidade (dia sem escala própria) não entra: com ele, quem
   * atende em duas unidades não conseguiria marcar escala em nenhuma.
   */
  async ensureShiftFreeAcrossShops(
    barberId: number,
    dayOfWeek: number,
    startTime: string,
    endTime: string,
  ) {
    const barber = await this.prisma.barber.findUnique({
      where: { id: barberId },
      select: { userId: true, professionalId: true },
    });
    const ids = await this.samePersonBarberIds(barberId, barber);
    const others = ids.filter((id) => id !== barberId);
    if (others.length === 0) return;
    const shifts = await this.prisma.barberSchedule.findMany({
      where: {
        barberId: { in: others },
        dayOfWeek,
        isActive: true,
        barber: currentEngagement(),
      },
      select: { startTime: true, endTime: true },
    });
    if (shifts.some((shift) => shiftsOverlap(startTime, endTime, shift.startTime, shift.endTime))) {
      throw new BadRequestException(
        'Este profissional já tem escala nesse horário em outra unidade',
      );
    }
  }

  // Faltava checar conflito por BARBEIRO (só existia para resourceId) — dois
  // agendamentos podiam ser criados para o mesmo profissional no mesmo
  // horário sem nenhum aviso. Usado tanto pelo fluxo de staff quanto pelo
  // agendamento público.
  async ensureBarberAvailable(
    barbershopId: number,
    barberId: number,
    startAt: Date,
    endAt: Date,
    excludeAppointmentId?: number,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const barber = await client.barber.findFirst({
      where: { id: barberId, barbershopId },
      select: { userId: true, professionalId: true, accessStartsAt: true, accessEndsAt: true },
    });
    if (barber && !withinEngagement(barber, startAt)) {
      throw new BadRequestException(
        'Esse horário está fora do período deste profissional na unidade',
      );
    }
    // A mesma pessoa pode atender em outras unidades: o horário dela é um só
    const barberIds = await this.samePersonBarberIds(barberId, barber, client);
    const conflict = await client.appointment.findFirst({
      where: {
        barberId: { in: barberIds },
        id: excludeAppointmentId ? { not: excludeAppointmentId } : undefined,
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { barbershopId: true },
    });
    if (conflict) {
      // De outra unidade só diz que está ocupado — nada do atendimento de lá
      throw new BadRequestException(
        conflict.barbershopId === barbershopId
          ? 'Este profissional já tem um agendamento nesse horário'
          : 'Este profissional já está ocupado em outra unidade nesse horário',
      );
    }
  }

  async createAppointment(
    userId: number,
    barbershopId: number,
    data: {
      customerId: number;
      barberId: number;
      resourceId?: number;
      startAt: Date;
      endAt: Date;
      status?: string;
      notes?: string;
      source?: string;
      depositAmount?: number;
      depositPaid?: boolean;
      /** Forma do sinal recebido à mão (obrigatória com depositPaid) */
      depositPaymentMethod?: string;
      services: Array<{ serviceId: number; quantity?: number; unitPrice: number }>;
      /** Agendamento recorrente (ver AppointmentSeriesService) */
      seriesId?: string;
      seriesIndex?: number;
    },
    /** notify = false: a série manda um e-mail só, com todas as datas */
    opts: { notify?: boolean } = {},
  ) {
    // Fim antes do início escapava da checagem de conflito (startAt < endAt
    // nunca batia) e data inválida virava erro 500 do banco
    if (isNaN(new Date(data.startAt).getTime()) || isNaN(new Date(data.endAt).getTime())) {
      throw new BadRequestException('Horário inválido');
    }
    if (new Date(data.endAt) <= new Date(data.startAt)) {
      throw new BadRequestException('O fim tem que ser depois do início');
    }
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'basic');
    if (data.source !== 'HISTORY') {
      await assertSoloBookingAllowed(this.prisma, barbershopId, data.startAt);
    }
    const ownBarberId = await this.ownBarberIdIfBarber(userId, barbershop);
    if (ownBarberId !== null && data.barberId !== ownBarberId) {
      throw new ForbiddenException('Seu cargo só permite agendar na sua própria agenda.');
    }
    await this.ensureCustomerOfNetwork(barbershop.networkId, data.customerId);
    await this.ensureBarberOfBarbershop(barbershopId, data.barberId, { active: true });
    if (data.resourceId) await this.ensureResourceOfBarbershop(barbershopId, data.resourceId);
    await this.ensureItemsOfBarbershop(
      barbershopId,
      data.services.map((s) => s.serviceId),
    );
    const { services, depositAmount, depositPaid, depositPaymentMethod, ...appointmentData } = data;
    // Preço e quantidade com a mesma conferência da venda: é a base da taxa
    // de falta, do preço no link do cliente e do sinal
    for (const s of services) {
      checkMoney('Preço do serviço', s.unitPrice, barbershop.currency);
      const qty = s.quantity ?? 1;
      if (!Number.isInteger(qty) || qty < 1 || qty > 1000) {
        throw new BadRequestException('Quantidade inválida');
      }
    }
    checkMoney('Sinal', depositAmount, barbershop.currency);
    // Se nenhum valor de sinal foi informado, usa o sugerido no primeiro
    // serviço (se essa unidade configurou um) — evita a equipe ter que
    // lembrar de repetir o valor toda vez.
    let resolvedDeposit = depositAmount;
    if (resolvedDeposit === undefined && services[0]) {
      const svc = await this.prisma.barbershopService.findUnique({
        where: { id: services[0].serviceId },
      });
      resolvedDeposit = svc?.depositAmount ? Number(svc.depositAmount) : undefined;
    }
    const servicesTotal = services.reduce((sum, s) => sum + s.unitPrice * (s.quantity ?? 1), 0);
    if (resolvedDeposit != null && resolvedDeposit > servicesTotal + 0.005) {
      throw new BadRequestException(APPOINTMENT_DEPOSIT_MESSAGE);
    }
    // Sinal pago à mão: da recepção para cima, com a forma, e o dinheiro
    // entra no caixa aberto (antes qualquer cargo marcava e ele não entrava)
    const manualDeposit = depositPaid
      ? await this.manualDepositReceipt(userId, barbershop, depositPaymentMethod)
      : null;
    const created = await this.prisma.$transaction(async (tx) => {
      // Checagem de conflito e gravação sob a mesma trava (ver lockSchedule)
      await this.lockSchedule(tx, data.barberId, data.resourceId);
      await this.ensureBarberAvailable(
        barbershopId,
        data.barberId,
        data.startAt,
        data.endAt,
        undefined,
        tx,
      );
      if (data.resourceId) {
        await this.ensureResourceAvailable(
          barbershopId,
          data.resourceId,
          data.startAt,
          data.endAt,
          undefined,
          tx,
        );
      }
      const appointment = await tx.appointment.create({
        data: {
          barbershopId,
          ...appointmentData,
          status: appointmentData.status ?? 'CONFIRMED',
          source: appointmentData.source ?? 'PHONE',
          depositAmount: resolvedDeposit != null ? new Decimal(resolvedDeposit) : null,
          depositPaid: depositPaid ?? false,
          ...(manualDeposit ?? {}),
        },
      });
      await tx.appointmentService.createMany({
        data: services.map((s) => ({
          appointmentId: appointment.id,
          serviceId: s.serviceId,
          quantity: s.quantity ?? 1,
          unitPrice: new Decimal(s.unitPrice),
        })),
      });
      return tx.appointment.findUniqueOrThrow({
        where: { id: appointment.id },
        include: { services: true, customer: true, barber: true },
      });
    });
    // Marcado pela equipe (telefone, balcão): o cliente também recebe a
    // confirmação com o link pra remarcar/cancelar, como no agendamento online
    const confirmationTo = created ? appointmentContactEmail(created) : null;
    if (opts.notify !== false && created && created.status === 'CONFIRMED' && confirmationTo) {
      this.sendAppointmentEmail(created.id, 'appointment_confirmation', confirmationTo).catch(
        (err) =>
          this.logger.error(`Erro ao enviar confirmação do agendamento #${created.id}:`, err),
      );
    }
    return (
      created &&
      this.hideAppointmentContact(await this.contactVisibility(userId, barbershop), created)
    );
  }

  async getAppointments(
    userId: number,
    barbershopId: number,
    filters?: {
      barberId?: number;
      customerId?: number;
      status?: string;
      startFrom?: Date;
      startTo?: Date;
      limit?: number;
      offset?: number;
    },
  ) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'basic');
    const where: any = { barbershopId };
    if (filters?.barberId) where.barberId = filters.barberId;
    // Barbeiro vê só a própria agenda
    const ownBarberId = await this.ownBarberIdIfBarber(userId, barbershop);
    if (ownBarberId !== null) where.barberId = ownBarberId;
    if (filters?.customerId) where.customerId = filters.customerId;
    if (filters?.status) where.status = filters.status;
    if (filters?.startFrom || filters?.startTo) {
      where.startAt = {};
      if (filters.startFrom) where.startAt.gte = filters.startFrom;
      if (filters.startTo) where.startAt.lte = filters.startTo;
    }
    const appointments = await this.prisma.appointment.findMany({
      where,
      include: {
        services: { include: { service: true } },
        customer: true,
        barber: true,
        sale: { select: { id: true } },
      },
      orderBy: { startAt: 'asc' },
      // Agenda (semana/mês): o período inteiro — com 50 fixo, numa semana
      // movimentada os horários além do 50º simplesmente não apareciam
      take: filters?.limit ?? (filters?.startFrom && filters?.startTo ? MAX_AGENDA_ROWS : 50),
      skip: filters?.offset ?? 0,
    });
    const canSee = await this.contactVisibility(userId, barbershop);
    return appointments.map(({ sale, ...a }) => {
      const appt = this.hideAppointmentContact(canSee, { ...a, saleId: sale?.id ?? null });
      return {
        ...appt,
        customerName: appt.customer?.name ?? null,
        customerPhone: appt.customer?.phone || null,
      };
    });
  }

  /**
   * Agenda da franquia num período (o que o calendário mostra): no máximo
   * NETWORK_AGENDA_MAX_DAYS e até NETWORK_AGENDA_CAP agendamentos. Antes era
   * um corte fixo de 200 em ordem crescente — no mês, uma franquia com
   * movimento perdia os últimos dias. truncated avisa se ainda assim cortou.
   */
  async getNetworkAgenda(
    userId: number,
    filters: { barbershopId?: number; status?: string; startFrom: Date; startTo: Date },
  ) {
    const { startFrom, startTo } = filters;
    if (isNaN(startFrom.getTime()) || isNaN(startTo.getTime()) || startTo <= startFrom) {
      throw new BadRequestException('Período inválido');
    }
    const days = (startTo.getTime() - startFrom.getTime()) / 86_400_000;
    if (days > NETWORK_AGENDA_MAX_DAYS) {
      throw new BadRequestException(
        `Período de no máximo ${NETWORK_AGENDA_MAX_DAYS} dias na agenda da franquia`,
      );
    }
    const rows = await this.queryNetworkAppointments(userId, filters, NETWORK_AGENDA_CAP + 1);
    return {
      appointments: rows.slice(0, NETWORK_AGENDA_CAP),
      truncated: rows.length > NETWORK_AGENDA_CAP,
      limit: NETWORK_AGENDA_CAP,
    };
  }

  /** Lista da franquia (legado): com período, até NETWORK_AGENDA_CAP; sem, 200 */
  async getNetworkAppointments(
    userId: number,
    filters?: {
      barbershopId?: number;
      status?: string;
      startFrom?: Date;
      startTo?: Date;
    },
  ) {
    const bounded = !!(filters?.startFrom && filters?.startTo);
    return this.queryNetworkAppointments(userId, filters, bounded ? NETWORK_AGENDA_CAP : 200);
  }

  private async queryNetworkAppointments(
    userId: number,
    filters:
      | { barbershopId?: number; status?: string; startFrom?: Date; startTo?: Date }
      | undefined,
    take: number,
  ) {
    const barbershops = await this.getMyBarbershops(userId);
    const allIds = barbershops.map((b) => b.id);
    if (allIds.length === 0) return [];

    const barbershopIds =
      filters?.barbershopId && allIds.includes(filters.barbershopId)
        ? [filters.barbershopId]
        : allIds;

    // Onde a pessoa é barbeiro, entra só a agenda dela
    const where: any = {
      barbershopId: { in: barbershopIds },
      OR: [
        { barbershop: { ownerUserId: userId } },
        { barbershop: { network: { ownerUserId: userId } } },
        {
          barbershop: {
            barbers: {
              some: {
                userId,
                staffType: { in: ['manager', 'reception'] },
                ...currentEngagement(),
              },
            },
          },
        },
        { barber: { userId, ...currentEngagement() } },
      ],
    };
    if (filters?.status) where.status = filters.status;
    if (filters?.startFrom || filters?.startTo) {
      where.startAt = {};
      if (filters.startFrom) where.startAt.gte = filters.startFrom;
      if (filters.startTo) where.startAt.lt = filters.startTo;
    }
    const rows = await this.prisma.appointment.findMany({
      where,
      include: {
        services: { include: { service: true } },
        customer: { select: { name: true } },
        barber: { select: { name: true } },
      },
      orderBy: { startAt: 'asc' },
      take,
    });
    // Nomes pra agenda da franquia (antes todo evento aparecia como
    // "Cliente — Profissional", porque o tipo não expunha os nomes)
    return rows.map((a) => ({
      ...a,
      customerName: a.customer?.name ?? null,
      barberName: a.barber?.name ?? null,
    }));
  }

  async getAppointment(userId: number, barbershopId: number, appointmentId: number) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'basic');
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, barbershopId },
      include: { services: { include: { service: true } }, customer: true, barber: true },
    });
    if (!appointment) throw new NotFoundException('Agendamento não encontrado');
    this.ensureOwnAppointment(await this.ownBarberIdIfBarber(userId, barbershop), appointment);
    return this.hideAppointmentContact(
      await this.contactVisibility(userId, barbershop),
      appointment,
    );
  }

  /**
   * Trocar o profissional de um atendimento com caixinha dele: só quando a
   * caixinha ainda está com a unidade (recebida por ela e não repassada).
   * A que já chegou ao profissional (na mão, pelo app ou já paga) fica com ele
   */
  private async ensureTipsCanMove(appointmentId: number) {
    const tips = await this.prisma.appointmentTip.findMany({
      where: { appointmentId, destination: 'professional' },
      select: { receivedByUnit: true, method: true, payEntryId: true },
    });
    const entryIds = tips.map((t) => t.payEntryId).filter((id): id is number => id != null);
    const paid = entryIds.length
      ? await this.prisma.barberPayEntry.count({
          where: { id: { in: entryIds }, payoutId: { not: null } },
        })
      : 0;
    const reached = paid > 0 || tips.some((t) => !t.receivedByUnit || t.method === 'STRIPE');
    if (reached) throw new BadRequestException(TIP_REACHED_PROFESSIONAL_MESSAGE);
  }

  async updateAppointment(
    userId: number,
    barbershopId: number,
    appointmentId: number,
    data: Partial<{
      customerId: number;
      barberId: number;
      resourceId: number;
      startAt: Date;
      endAt: Date;
      notes: string;
      status: string;
    }>,
    opts: { refundDeposit?: boolean; cancelledBy?: string } = {},
  ) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'basic');
    if (opts.cancelledBy != null && !['client', 'business'].includes(opts.cancelledBy)) {
      throw new BadRequestException('Quem cancelou: cliente ou unidade');
    }
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, barbershopId },
    });
    if (!appointment) throw new NotFoundException('Agendamento não encontrado');
    const ownBarberId = await this.ownBarberIdIfBarber(userId, barbershop);
    this.ensureOwnAppointment(ownBarberId, appointment);
    if (ownBarberId !== null && data.barberId && data.barberId !== ownBarberId) {
      throw new ForbiddenException('Seu cargo só permite mexer na sua própria agenda.');
    }
    if (data.customerId) await this.ensureCustomerOfNetwork(barbershop.networkId, data.customerId);
    const barberChanged = !!data.barberId && data.barberId !== appointment.barberId;
    if (barberChanged) {
      await this.ensureBarberOfBarbershop(barbershopId, data.barberId as number, { active: true });
      await this.ensureTipsCanMove(appointmentId);
    }
    if (data.resourceId) await this.ensureResourceOfBarbershop(barbershopId, data.resourceId);
    if (
      data.status != null &&
      data.status !== appointment.status &&
      !STAFF_APPOINTMENT_STATUSES.includes(data.status)
    ) {
      throw new BadRequestException('Situação do agendamento inválida');
    }
    // Mudou só o início: mantém a duração (antes o fim ficava o antigo e o
    // atendimento podia terminar antes de começar, escapando da checagem
    // de conflito)
    if (data.startAt && !data.endAt) {
      const duration = appointment.endAt.getTime() - appointment.startAt.getTime();
      data = { ...data, endAt: new Date(new Date(data.startAt).getTime() + duration) };
    }
    const newStart = new Date(data.startAt ?? appointment.startAt);
    const newEnd = new Date(data.endAt ?? appointment.endAt);
    if (newEnd <= newStart) throw new BadRequestException('O fim tem que ser depois do início');
    if (data.status != null && data.status !== appointment.status) {
      assertStatusFitsTime(data.status, newStart);
    }
    if (
      data.status != null &&
      data.status !== appointment.status &&
      (data.status === 'CANCELLED' || data.status === 'NO_SHOW')
    ) {
      const sale = await this.prisma.sale.findFirst({
        where: { appointmentId },
        select: { id: true },
      });
      if (sale) {
        throw new BadRequestException(
          'Apague ou estorne a venda antes de mudar a situação deste horário.',
        );
      }
    }
    // Horário novo. Dentro de 24 h o e-mail de remarcação já é o lembrete;
    // mais longe, o lembrete de 24 h volta a valer.
    if (newStart.getTime() !== appointment.startAt.getTime()) {
      data = { ...data, reminderSentAt: reminderSentAtAfterMove(newStart) } as typeof data;
    }
    const barberId = data.barberId ?? appointment.barberId;
    const resourceId = data.resourceId ?? appointment.resourceId ?? undefined;
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockSchedule(tx, barberId, resourceId);
      await this.ensureBarberAvailable(
        barbershopId,
        barberId,
        data.startAt ?? appointment.startAt,
        data.endAt ?? appointment.endAt,
        appointmentId,
        tx,
      );
      if (resourceId) {
        await this.ensureResourceAvailable(
          barbershopId,
          resourceId,
          data.startAt ?? appointment.startAt,
          data.endAt ?? appointment.endAt,
          appointmentId,
          tx,
        );
      }
      if (barberChanged) {
        // A caixinha que a unidade recebeu e ainda não repassou vai com o
        // atendimento para o profissional novo (e o lançamento dela também)
        const tips = await tx.appointmentTip.findMany({
          where: { appointmentId, destination: 'professional' },
          select: { id: true, payEntryId: true },
        });
        await tx.appointmentTip.updateMany({
          where: { id: { in: tips.map((t) => t.id) } },
          data: { barberId },
        });
        await tx.barberPayEntry.updateMany({
          where: {
            id: { in: tips.map((t) => t.payEntryId).filter((id): id is number => id != null) },
            payoutId: null,
          },
          data: { barberId },
        });
      }
      return tx.appointment.update({
        where: { id: appointmentId },
        data: {
          ...data,
          // Cancela pela unidade: o link antigo deixa de mudar o horário.
          // A versão anterior ainda abre, só para ver o status e o estorno.
          ...(data.status === 'CANCELLED' && appointment.status !== 'CANCELLED'
            ? { linkVersion: { increment: 1 } }
            : {}),
        },
        include: { services: { include: { service: true } }, customer: true, barber: true },
      });
    });

    // Vaga liberada por cancelamento — avisa o primeiro da lista de espera
    // que combine (mesma data, mesmo barbeiro/serviço se especificado).
    // Não bloqueia a resposta da mutation nem falha ela: notificação é
    // best-effort (erro de WhatsApp/e-mail não deve impedir o cancelamento).
    const moved =
      data.startAt != null && new Date(data.startAt).getTime() !== appointment.startAt.getTime();
    if (data.status === 'CANCELLED' && appointment.status !== 'CANCELLED') {
      this.checkWaitlistOnCancellation(barbershopId, updated).catch((err) =>
        this.logger.error(
          `Erro ao verificar lista de espera do agendamento #${appointmentId}:`,
          err,
        ),
      );
    }

    // Remarcou pela agenda: o horário antigo ficou livre
    if (moved && appointment.status === 'CONFIRMED' && data.status !== 'CANCELLED') {
      this.checkWaitlistOnCancellation(barbershopId, {
        ...updated,
        startAt: appointment.startAt,
        barberId: appointment.barberId,
      }).catch((err) =>
        this.logger.error(
          `Erro ao verificar lista de espera do agendamento #${appointmentId}:`,
          err,
        ),
      );
    }

    // Falta ou cancelamento do cliente com taxa: o atendimento pago antes
    // pelo app cobre a taxa. A unidade retém só ela e devolve o resto, em vez
    // de devolver tudo (cancelamento) ou ficar com tudo (falta) e ainda
    // registrar a taxa como devida (item 242)
    const feeStatusChange =
      (data.status === 'NO_SHOW' ||
        (data.status === 'CANCELLED' && opts.cancelledBy !== 'business')) &&
      appointment.status !== data.status;
    let prepaidRetained: number | null = null;
    if (feeStatusChange && appointment.prepaidAt && !appointment.prepaidRefundedAt) {
      try {
        prepaidRetained = await this.retainFeeFromPrepayment(
          barbershopId,
          updated,
          must(data.status, 'situação'),
        );
        if (prepaidRetained != null) {
          const refreshed = await this.prisma.appointment.findUnique({
            where: { id: appointmentId },
            select: { prepaidRefundedAt: true, prepaidRefundedAmount: true },
          });
          if (refreshed) Object.assign(updated, refreshed);
        }
      } catch (err) {
        this.logger.error(`Erro ao reter a taxa do pago antes #${appointmentId}:`, err);
      }
    }

    // A unidade cancelou: o sinal pago online volta pro cliente (a equipe
    // pode optar por reter, ex.: cliente avisou em cima da hora). Falta
    // (NO_SHOW) retém o sinal — é pra isso que ele existe.
    if (
      data.status === 'CANCELLED' &&
      appointment.status !== 'CANCELLED' &&
      opts.refundDeposit !== false &&
      appointment.depositPaid &&
      appointment.depositPaidAt
    ) {
      try {
        if (await this.refundOnlineDeposit(appointmentId)) {
          Object.assign(updated, { depositPaid: false, depositRefundedAt: new Date() });
        }
      } catch (err) {
        this.logger.error(`Erro ao estornar o sinal do agendamento #${appointmentId}:`, err);
      }
    }

    // A unidade cancelou: o atendimento pago antes pelo app volta sempre
    // (diferente do sinal, que a equipe pode reter)
    if (
      data.status === 'CANCELLED' &&
      appointment.status !== 'CANCELLED' &&
      appointment.prepaidAt &&
      prepaidRetained == null
    ) {
      try {
        if (await this.refundPrepayment(appointmentId)) {
          Object.assign(updated, { prepaidRefundedAt: new Date() });
        }
      } catch (err) {
        this.logger.error(`Erro ao estornar o pagamento do agendamento #${appointmentId}:`, err);
      }
    }

    // Taxa de no-show/cancelamento tardio: cobrança 100% manual (mesma
    // filosofia do sinal e do cartão-presente) — só calcula e registra o
    // valor devido, não cobra sozinho. Best-effort: nunca bloqueia a
    // mutation nem falha o cancelamento em si.
    // Cancelamento pela unidade (profissional doente, imprevisto) não é culpa
    // do cliente: sem taxa
    if (feeStatusChange) {
      this.recordNoShowFee(
        barbershopId,
        updated,
        must(data.status, 'situação'),
        prepaidRetained ?? 0,
      ).catch((err) =>
        this.logger.error(
          `Erro ao registrar taxa de no-show do agendamento #${appointmentId}:`,
          err,
        ),
      );
    }

    // Falta ou cancelamento desfeito (marcado por engano): a taxa pendente sai.
    // Já cobrada fica (o dinheiro entrou no caixa; a devolução é outra venda)
    if (
      (appointment.status === 'NO_SHOW' || appointment.status === 'CANCELLED') &&
      data.status != null &&
      data.status !== appointment.status &&
      data.status !== 'NO_SHOW' &&
      data.status !== 'CANCELLED'
    ) {
      await this.prisma.noShowFee.deleteMany({ where: { appointmentId, status: 'PENDING' } });
    }

    // A equipe mudou o horário ou cancelou: o cliente fica sabendo (antes só
    // descobria no lembrete, ou chegando na barbearia)
    const to = appointmentContactEmail(updated);
    if (to && updated.startAt > new Date()) {
      const moved = updated.startAt.getTime() !== appointment.startAt.getTime();
      const cancelledNow = data.status === 'CANCELLED' && appointment.status !== 'CANCELLED';
      const template = cancelledNow
        ? 'appointment_cancelled'
        : moved && updated.status === 'CONFIRMED'
        ? 'appointment_rescheduled'
        : null;
      if (template) {
        this.sendAppointmentEmail(updated.id, template, to).catch((err) =>
          this.logger.error(`Erro ao avisar o cliente do agendamento #${appointmentId}:`, err),
        );
      }
    }

    return this.hideAppointmentContact(await this.contactVisibility(userId, barbershop), updated);
  }

  /**
   * Taxa de falta ou de cancelamento tardio deste horário, já descontado o
   * sinal pago online que a unidade reteve. null = sem taxa (desligada, fora
   * do prazo ou serviço sem valor).
   */
  private async noShowFeeFor(
    barbershopId: number,
    appointment: {
      startAt: Date;
      services: Array<{ unitPrice: Decimal; quantity: number }>;
      depositPaid?: boolean | null;
      depositPaidAt?: Date | null;
      depositAmount?: Decimal | null;
      depositRefundedAt?: Date | null;
    },
    newStatus: string,
  ): Promise<{ amount: number; currency: string; reason: 'NO_SHOW' | 'LATE_CANCELLATION' } | null> {
    const barbershop = await this.prisma.barbershop.findUnique({
      where: { id: barbershopId },
      include: { network: true },
    });
    if (!barbershop) return null;
    const network = networkMoneyRules(barbershop, barbershop.network);
    if (!network.noShowFeeEnabled) return null;

    const isNoShow = newStatus === 'NO_SHOW';
    const isLateCancellation =
      newStatus === 'CANCELLED' &&
      appointment.startAt.getTime() - Date.now() < network.lateCancellationWindowHours * 3600000;
    if (!isNoShow && !isLateCancellation) return null;

    const serviceTotal = appointment.services.reduce(
      (sum, s) => sum + Number(s.unitPrice) * s.quantity,
      0,
    );
    if (serviceTotal <= 0) return null;

    let feeAmount = 0;
    if (network.noShowFeeType === 'PERCENT' && network.noShowFeeValue) {
      feeAmount = serviceTotal * (network.noShowFeeValue / 100);
    } else if (network.noShowFeeType === 'FIXED' && network.noShowFeeValue) {
      feeAmount = network.noShowFeeValue;
    }
    // O sinal pago online que a unidade reteve já é parte da taxa: cobra só o
    // que falta (nada, se o sinal cobre). Em centavos da moeda da unidade.
    const retained =
      appointment.depositPaid && appointment.depositPaidAt && !appointment.depositRefundedAt
        ? Number(appointment.depositAmount ?? 0)
        : 0;
    feeAmount = roundMoney(
      roundMoney(feeAmount, barbershop.currency) - retained,
      barbershop.currency,
    );
    if (feeAmount <= 0) return null;
    return {
      amount: feeAmount,
      currency: barbershop.currency,
      reason: isNoShow ? 'NO_SHOW' : 'LATE_CANCELLATION',
    };
  }

  /**
   * Horário pago antes pelo app que vira falta ou cancelamento tardio: a
   * unidade fica com a taxa (até o que foi pago) e devolve o resto. Devolve
   * quanto ficou retido, ou null quando não há taxa (aí vale a regra de
   * sempre: cancelamento devolve tudo, falta fica com a unidade).
   */
  private async retainFeeFromPrepayment(
    barbershopId: number,
    appointment: {
      id: number;
      startAt: Date;
      services: Array<{ unitPrice: Decimal; quantity: number }>;
      prepaidAmount?: Decimal | null;
      prepaidRefundedAmount?: Decimal | null;
      depositPaid?: boolean | null;
      depositPaidAt?: Date | null;
      depositAmount?: Decimal | null;
      depositRefundedAt?: Date | null;
    },
    newStatus: string,
  ): Promise<number | null> {
    const fee = await this.noShowFeeFor(barbershopId, appointment, newStatus);
    if (!fee) return null;
    const paid = Number(appointment.prepaidAmount ?? 0);
    const remaining = roundMoney(
      paid - Number(appointment.prepaidRefundedAmount ?? 0),
      fee.currency,
    );
    if (remaining <= 0) return null;
    const retained = Math.min(fee.amount, remaining);
    const back = roundMoney(remaining - retained, fee.currency);
    if (back > 0) await this.refundPrepayment(appointment.id, back);
    return retained;
  }

  private async recordNoShowFee(
    barbershopId: number,
    appointment: {
      id: number;
      startAt: Date;
      services: Array<{ unitPrice: Decimal; quantity: number }>;
      customer: { id: number };
      depositPaid?: boolean | null;
      depositPaidAt?: Date | null;
      depositAmount?: Decimal | null;
      depositRefundedAt?: Date | null;
    },
    newStatus: string,
    /** Parte da taxa que já ficou com a unidade, do pago antes pelo app */
    prepaidRetained = 0,
  ) {
    // appointmentId é único em NoShowFee — calcula uma vez só, mesmo que o
    // status mude de novo depois.
    const existing = await this.prisma.noShowFee.findUnique({
      where: { appointmentId: appointment.id },
    });
    if (existing) return;
    const fee = await this.noShowFeeFor(barbershopId, appointment, newStatus);
    if (!fee) return;
    // O que o pago antes já cobriu não fica devido de novo
    const due = roundMoney(fee.amount - prepaidRetained, fee.currency);
    if (due <= 0) return;

    await this.prisma.noShowFee.create({
      data: {
        appointmentId: appointment.id,
        customerId: appointment.customer.id,
        barbershopId,
        amount: new Decimal(due),
        currency: fee.currency,
        reason: fee.reason,
      },
    });
  }

  async deleteAppointment(userId: number, barbershopId: number, appointmentId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, barbershopId },
      include: {
        sale: { select: { id: true } },
        professionalReview: { select: { id: true } },
        customerRatings: { select: { id: true }, take: 1 },
        tips: { select: { id: true }, take: 1 },
        noShowFee: { select: { id: true } },
        chatThreads: { select: { id: true, retainUntil: true, closedAt: true } },
      },
    });
    if (!appointment) throw new NotFoundException('Agendamento não encontrado');
    if (appointment.depositPaid && appointment.depositPaidAt) {
      throw new BadRequestException(
        'Este horário tem sinal pago online. Cancele (o sinal é estornado) em vez de excluir.',
      );
    }
    const happened =
      appointment.status === 'COMPLETED' ||
      appointment.status === 'IN_PROGRESS' ||
      appointment.status === 'NO_SHOW';
    const reportedChat = appointment.chatThreads.some(
      (thread) => thread.retainUntil || thread.closedAt,
    );
    if (
      happened ||
      appointment.sale ||
      appointment.professionalReview ||
      appointment.customerRatings.length > 0 ||
      appointment.tips.length > 0 ||
      appointment.noShowFee ||
      appointment.prepaidAt ||
      reportedChat
    ) {
      throw new BadRequestException(
        'Este horário já aconteceu ou tem registro ligado. Cancele (ou marque falta) em vez de excluir.',
      );
    }
    // Horário futuro que o cliente já tinha recebido (e posto na agenda pelo
    // convite): avisa e apaga o evento do calendário dele. O e-mail é montado
    // antes de apagar (depois não há mais o que carregar)
    if (appointment.status === 'CONFIRMED' && appointment.startAt > new Date()) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: appointment.customerId },
        select: { email: true },
      });
      const to = appointmentContactEmail({ contactEmail: appointment.contactEmail, customer });
      if (to) {
        await this.sendAppointmentEmail(appointmentId, 'appointment_cancelled', to).catch((err) =>
          this.logger.error(`Erro ao avisar exclusão do agendamento #${appointmentId}:`, err),
        );
      }
    }
    const services = await this.prisma.appointmentService.findMany({
      where: { appointmentId },
      select: { serviceId: true },
    });
    const threadIds = appointment.chatThreads.map((thread) => thread.id);
    await this.prisma.$transaction(async (tx) => {
      if (threadIds.length) {
        await tx.chatMessage.deleteMany({ where: { threadId: { in: threadIds } } });
        await tx.chatThread.deleteMany({ where: { id: { in: threadIds } } });
      }
      await tx.appointment.delete({ where: { id: appointmentId } });
    });
    // Excluir também libera a vaga (cancelar já avisava a lista de espera)
    if (appointment.status === 'CONFIRMED' || appointment.status === 'PENDING_PAYMENT') {
      this.checkWaitlistOnCancellation(barbershopId, { ...appointment, services }).catch((err) =>
        this.logger.error(
          `Erro ao verificar lista de espera do agendamento #${appointmentId}:`,
          err,
        ),
      );
    }
  }

  /**
   * Estorna o sinal pago online (Stripe). Marca antes de chamar o Stripe —
   * dois cliques, ou cliente e unidade ao mesmo tempo, não estornam duas
   * vezes — e desfaz a marca se o Stripe recusar. Sem sinal online pago
   * (ou já estornado): false.
   */
  async refundOnlineDeposit(appointmentId: number) {
    const appt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { depositPaymentIntentId: true, depositPaidAt: true, depositStripeAccountId: true },
    });
    const intentId = appt?.depositPaymentIntentId;
    if (!intentId || !appt.depositPaidAt) return false;
    const now = new Date();
    const claimed = await this.prisma.appointment.updateMany({
      where: {
        id: appointmentId,
        depositPaid: true,
        depositRefundedAt: null,
        depositPaymentIntentId: intentId,
      },
      data: { depositPaid: false, depositRefundedAt: now },
    });
    if (claimed.count === 0) return false;
    try {
      await this.stripeService.createRefund(
        intentId,
        undefined,
        'requested_by_customer',
        `deposit-refund-${intentId}`,
        // Foi pra conta da unidade: desfaz a transferência e devolve a taxa
        !!appt.depositStripeAccountId,
      );
    } catch (err) {
      // Já estornado direto no painel do Stripe: vale como estornado
      if ((err as { code?: string })?.code === 'charge_already_refunded') return true;
      await this.prisma.appointment.updateMany({
        where: { id: appointmentId, depositRefundedAt: now },
        data: { depositPaid: true, depositRefundedAt: null },
      });
      throw err;
    }
    return true;
  }

  /**
   * Devolve o atendimento pago antes pelo app, inteiro (cancelamento: o que
   * restar) ou parte (amount, ex.: trocou por um serviço mais barato).
   * Desfaz a transferência pra unidade e devolve a taxa da plataforma na
   * mesma proporção. Sem pagamento (ou já devolvido inteiro): false.
   */
  async refundPrepayment(appointmentId: number, amount?: number) {
    const appt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        prepaidAt: true,
        prepaidAmount: true,
        prepaidPaymentIntentId: true,
        prepaidRefundedAt: true,
        prepaidRefundedAmount: true,
        barbershop: { select: { currency: true } },
      },
    });
    const intentId = appt?.prepaidPaymentIntentId;
    if (!intentId || !appt.prepaidAt || appt.prepaidRefundedAt) return false;
    const paid = Number(appt.prepaidAmount ?? 0);
    const before = Number(appt.prepaidRefundedAmount ?? 0);
    const remaining = Math.round((paid - before) * 100) / 100;
    if (remaining <= 0) return false;
    const value = amount == null ? remaining : Math.round(amount * 100) / 100;
    if (!(value > 0) || value > remaining) {
      throw new BadRequestException(`O estorno vai de 0,01 até ${remaining.toFixed(2)}`);
    }
    const after = Math.round((before + value) * 100) / 100;
    const full = after >= paid;
    const now = new Date();
    // Condicional: dois estornos ao mesmo tempo não passam do que foi pago
    const claimed = await this.prisma.appointment.updateMany({
      where: {
        id: appointmentId,
        prepaidRefundedAt: null,
        prepaidRefundedAmount: appt.prepaidRefundedAmount ?? null,
      },
      data: { prepaidRefundedAmount: after, prepaidRefundedAt: full ? now : null },
    });
    if (claimed.count === 0) return false;
    try {
      await this.stripeService.createRefund(
        intentId,
        toMinorUnits(value, appt.barbershop.currency),
        'requested_by_customer',
        `prepayment-refund-${intentId}-${Math.round(after * 100)}`,
        true,
      );
    } catch (err) {
      if ((err as { code?: string })?.code === 'charge_already_refunded') return true;
      await this.prisma.appointment.updateMany({
        where: { id: appointmentId, prepaidRefundedAmount: after },
        data: {
          prepaidRefundedAmount: appt.prepaidRefundedAmount ?? null,
          prepaidRefundedAt: null,
        },
      });
      throw err;
    }
    return true;
  }

  /** Estorno manual do atendimento pago pelo app (gerente e dono), ex.: falta */
  async refundAppointmentPrepayment(
    userId: number,
    barbershopId: number,
    appointmentId: number,
    amount?: number | null,
  ) {
    const barbershop = await this.ensureAccess(userId, barbershopId, 'manager');
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, barbershopId },
      select: { prepaidAt: true, prepaidRefundedAt: true, sale: { select: { id: true } } },
    });
    if (!appointment) throw new NotFoundException('Agendamento não encontrado');
    if (!appointment.prepaidAt) throw new BadRequestException('Este horário não foi pago pelo app');
    if (appointment.prepaidRefundedAt)
      throw new BadRequestException('O pagamento já foi estornado');
    if (appointment.sale) {
      throw new BadRequestException(
        'A conta deste horário já foi fechada: estorne pelo painel do Stripe',
      );
    }
    let refunded: boolean;
    try {
      refunded = await this.refundPrepayment(appointmentId, amount ?? undefined);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`Erro ao estornar o pagamento do agendamento #${appointmentId}:`, err);
      throw new BadRequestException('Não foi possível estornar agora. Tente de novo.');
    }
    if (!refunded) throw new BadRequestException('O pagamento já foi estornado');
    const updated = await this.prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      include: { services: { include: { service: true } }, customer: true, barber: true },
    });
    return this.hideAppointmentContact(await this.contactVisibility(userId, barbershop), updated);
  }

  /** Estorno manual do sinal pago online (gerente e dono). */
  async refundAppointmentDeposit(userId: number, barbershopId: number, appointmentId: number) {
    const barbershop = await this.ensureAccess(userId, barbershopId, 'manager');
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, barbershopId },
    });
    if (!appointment) throw new NotFoundException('Agendamento não encontrado');
    if (appointment.depositRefundedAt) throw new BadRequestException('O sinal já foi estornado');
    if (!appointment.depositPaid || !appointment.depositPaidAt) {
      throw new BadRequestException('Este horário não tem sinal pago online');
    }
    let refunded: boolean;
    try {
      refunded = await this.refundOnlineDeposit(appointmentId);
    } catch (err) {
      this.logger.error(`Erro ao estornar o sinal do agendamento #${appointmentId}:`, err);
      throw new BadRequestException('Não foi possível estornar agora. Tente de novo.');
    }
    if (!refunded) throw new BadRequestException('O sinal já foi estornado');
    const updated = await this.prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      include: { services: { include: { service: true } }, customer: true, barber: true },
    });
    return this.hideAppointmentContact(await this.contactVisibility(userId, barbershop), updated);
  }

  /**
   * Recebimento do sinal à mão: recepção para cima, forma de pagamento
   * válida; em dinheiro, entra no caixa aberto (conta no fechamento)
   */
  private async manualDepositReceipt(
    userId: number,
    barbershop: { id: number; accessLevel: AccessLevel },
    method: string | null | undefined,
  ) {
    if (ACCESS_RANK[barbershop.accessLevel] < ACCESS_RANK.reception) {
      throw new ForbiddenException(DEPOSIT_RECEPTION_MESSAGE);
    }
    if (!method || !SALE_PAYMENT_METHODS.includes(method)) {
      throw new BadRequestException(DEPOSIT_METHOD_MESSAGE);
    }
    const session =
      method === 'CASH'
        ? await this.prisma.cashSession.findFirst({
            where: { barbershopId: barbershop.id, status: 'OPEN' },
            select: { id: true },
          })
        : null;
    return {
      depositManualMethod: method,
      depositReceivedAt: new Date(),
      depositReceivedByUserId: userId,
      depositCashSessionId: session?.id ?? null,
    };
  }

  async setAppointmentDepositPaid(
    userId: number,
    barbershopId: number,
    appointmentId: number,
    depositPaid: boolean,
    paymentMethod?: string | null,
  ) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId);
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, barbershopId },
    });
    if (!appointment) throw new NotFoundException('Agendamento não encontrado');
    this.ensureOwnAppointment(await this.ownBarberIdIfBarber(userId, barbershop), appointment);
    // Sinal online: só o Stripe muda (pago) ou o estorno (desfaz)
    if (appointment.depositPaidAt || appointment.depositRefundedAt) {
      throw new BadRequestException(
        'Sinal pago online: use "Estornar sinal" pra devolver ao cliente.',
      );
    }
    if (depositPaid === appointment.depositPaid) return appointment;
    if (depositPaid) {
      const receipt = await this.manualDepositReceipt(userId, barbershop, paymentMethod);
      return this.prisma.appointment.update({
        where: { id: appointmentId },
        data: { depositPaid: true, ...receipt },
      });
    }
    // Desmarcar: da recepção para cima, e só se o caixa em que entrou está aberto
    if (ACCESS_RANK[barbershop.accessLevel] < ACCESS_RANK.reception) {
      throw new ForbiddenException(DEPOSIT_RECEPTION_MESSAGE);
    }
    if (appointment.depositCashSessionId != null) {
      const session = await this.prisma.cashSession.findUnique({
        where: { id: appointment.depositCashSessionId },
        select: { status: true },
      });
      if (session?.status !== 'OPEN') throw new BadRequestException(DEPOSIT_CASH_CLOSED_MESSAGE);
    }
    return this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        depositPaid: false,
        depositManualMethod: null,
        depositReceivedAt: null,
        depositReceivedByUserId: null,
        depositCashSessionId: null,
      },
    });
  }

  // ============ LISTA DE ESPERA ============
  // Manual (staff adiciona) — quando um agendamento cancela e combina com
  // uma entrada aqui, o primeiro da fila é avisado por WhatsApp/e-mail que
  // abriu vaga. Não reagenda sozinho, só notifica (evita criar um
  // agendamento que o cliente não confirmou de fato).

  async getWaitlistEntries(userId: number, barbershopId: number, status?: string) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId);
    const entries = await this.prisma.waitlistEntry.findMany({
      where: { barbershopId, status: status ?? undefined },
      include: { customer: true, barber: true, service: true },
      orderBy: { createdAt: 'asc' },
    });
    const canSee = await this.contactVisibility(userId, barbershop);
    return entries.map((e) => this.hideAppointmentContact(canSee, e));
  }

  async createWaitlistEntry(
    userId: number,
    barbershopId: number,
    data: { customerId: number; barberId?: number; serviceId?: number; date: Date; notes?: string },
  ) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId);
    // Cliente da rede, profissional e serviço desta unidade (antes ia qualquer
    // id: dava pra pôr cliente de outra rede na fila e avisá-lo em nome daqui)
    const [customer, barber, service] = await Promise.all([
      this.prisma.customer.findFirst({
        where: { id: data.customerId, networkId: barbershop.networkId },
        select: { id: true },
      }),
      data.barberId
        ? this.prisma.barber.findFirst({
            where: { id: data.barberId, barbershopId },
            select: { id: true },
          })
        : true,
      data.serviceId
        ? this.prisma.barbershopService.findFirst({
            where: { id: data.serviceId, barbershopId },
            select: { id: true },
          })
        : true,
    ]);
    if (!customer) throw new NotFoundException('Cliente não encontrado');
    if (!barber) throw new NotFoundException('Profissional não encontrado');
    if (!service) throw new NotFoundException('Serviço não encontrado');
    // Mesma janela da entrada online: de hoje até 60 dias (no fuso da unidade)
    const day =
      data.date instanceof Date && !isNaN(data.date.getTime())
        ? data.date.toISOString().slice(0, 10)
        : '';
    const today = toZonedParts(new Date(), safeTimeZone(barbershop.timezone)).dateStr;
    if (!day || day < today || day > addDaysStr(today, WAITLIST_MAX_DAYS_AHEAD)) {
      throw new BadRequestException(WAITLIST_DAY_RANGE_MESSAGE);
    }
    const entry = await this.prisma.waitlistEntry.create({
      data: { ...data, date: new Date(`${day}T00:00:00Z`), barbershopId },
      include: { customer: true, barber: true, service: true },
    });
    return this.hideAppointmentContact(await this.contactVisibility(userId, barbershop), entry);
  }

  async cancelWaitlistEntry(userId: number, barbershopId: number, id: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const entry = await this.prisma.waitlistEntry.findFirst({ where: { id, barbershopId } });
    if (!entry) throw new NotFoundException('Entrada da lista de espera não encontrada');
    return this.prisma.waitlistEntry.update({ where: { id }, data: { status: 'CANCELLED' } });
  }

  /**
   * Lista de espera online: dia cheio na tela de agendamento, o cliente pede
   * para ser avisado se abrir vaga naquele dia (com o profissional escolhido
   * ou qualquer um). Entra no fim da mesma fila que a equipe usa; um e-mail
   * confirma com o link para sair da lista.
   */
  async joinPublicWaitlist(input: {
    barbershopId: number;
    barberId?: number | null;
    serviceIds: number[];
    date: string;
    customerName: string;
    customerPhone: string;
    customerEmail: string;
    clientAccountId?: number;
  }) {
    const barbershop = await this.prisma.barbershop.findFirst({
      where: { id: input.barbershopId, isActive: true, ...ownerAcceptsPublic },
    });
    if (!barbershop) throw new NotFoundException('Unidade não encontrada');
    const name = input.customerName?.trim() ?? '';
    const phone = input.customerPhone?.trim() ?? '';
    const email = input.customerEmail?.trim().toLowerCase() ?? '';
    if (name.length < 2 || phone.length < 8) {
      throw new BadRequestException('Informe nome e telefone');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Informe um e-mail válido para receber o aviso');
    }
    const today = toZonedParts(new Date(), safeTimeZone(barbershop.timezone)).dateStr;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
      input.date < today ||
      input.date > addDaysStr(today, WAITLIST_MAX_DAYS_AHEAD)
    ) {
      throw new BadRequestException(WAITLIST_DAY_RANGE_MESSAGE);
    }
    let barberId: number | null = null;
    if (input.barberId != null) {
      const barber = await this.prisma.barber.findFirst({
        where: { id: input.barberId, barbershopId: barbershop.id, isActive: true },
        select: { id: true },
      });
      if (!barber) throw new NotFoundException('Profissional não encontrado');
      barberId = barber.id;
    }
    const service = input.serviceIds.length
      ? await this.prisma.barbershopService.findFirst({
          where: { id: { in: input.serviceIds }, barbershopId: barbershop.id },
          select: { id: true },
        })
      : null;
    if (input.serviceIds.length && !service) {
      throw new NotFoundException('Serviço não encontrado');
    }

    await this.ensureNotBlocked(barbershop.networkId, {
      customerPhone: phone,
      customerEmail: email,
      clientAccountId: input.clientAccountId,
    });
    await this.ensureNotPlatformSuspended({
      customerPhone: phone,
      customerEmail: email,
      clientAccountId: input.clientAccountId,
    });

    const networkId = barbershop.networkId;
    // O telefone digitado não é confirmado: a ficha achada por ele só vale se
    // for da mesma pessoa (mesmo e-mail, ou mesmo nome numa ficha sem
    // e-mail). Senão, ficha à parte, e a equipe junta se for a mesma (item 249)
    const sameIds = await this.customerIdsByPhone(networkId, phone);
    const candidates = sameIds.length
      ? await this.prisma.customer.findMany({
          where: { id: { in: sameIds } },
          orderBy: { id: 'asc' },
        })
      : [];
    let customer = candidates.find((c) => samePublicPerson(c, { name, email })) ?? null;
    if (!customer) {
      customer = await this.prisma.customer.create({
        data: {
          networkId,
          name,
          phone: normalizePhoneToE164(phone) ?? phone,
          email,
          clientAccountId: input.clientAccountId ?? null,
        },
      });
    }

    const date = new Date(`${input.date}T00:00:00Z`);
    const existing = await this.prisma.waitlistEntry.findFirst({
      where: {
        barbershopId: barbershop.id,
        customerId: customer.id,
        status: 'WAITING',
        date,
        barberId,
        serviceId: service?.id ?? null,
      },
    });
    if (existing) return { entryId: existing.id, alreadyWaiting: true };

    // Sem lotar a fila de uma unidade com a mesma pessoa
    // Só os dias que ainda vêm (os que passaram não seguram vaga no limite)
    // Conta todas as fichas com esse telefone: trocar o e-mail (outra ficha)
    // não abre outra cota
    const waiting = await this.prisma.waitlistEntry.count({
      where: {
        customerId: { in: [...new Set([...sameIds, customer.id])] },
        status: 'WAITING',
        source: 'online',
        date: { gte: new Date(`${today}T00:00:00Z`) },
      },
    });
    if (waiting >= WAITLIST_MAX_ONLINE_PER_CUSTOMER) {
      throw new BadRequestException(
        `Você já está na lista de espera de ${WAITLIST_MAX_ONLINE_PER_CUSTOMER} dias. Saia de algum pelo link do e-mail.`,
      );
    }
    // Cada entrada manda um e-mail ao endereço informado: sem virar
    // disparador contra o e-mail de outra pessoa (trocando telefone e IP)
    const sameEmailToday = await this.prisma.waitlistEntry.count({
      where: {
        contactEmail: email,
        source: 'online',
        createdAt: { gte: new Date(Date.now() - 86_400_000) },
      },
    });
    if (sameEmailToday >= WAITLIST_MAX_ONLINE_PER_EMAIL_DAY) {
      throw new BadRequestException(
        'Este e-mail já entrou em várias listas de espera hoje. Tente de novo amanhã.',
      );
    }

    const entry = await this.prisma.waitlistEntry.create({
      data: {
        barbershopId: barbershop.id,
        customerId: customer.id,
        barberId,
        serviceId: service?.id ?? null,
        date,
        source: 'online',
        contactEmail: email,
      },
      include: { barber: { select: { name: true } } },
    });
    this.realtime.notify(barbershop.id, 'WAITLIST', 'CREATED');

    const lang = langForCountry(barbershop.country);
    const dateStr = new Date(`${input.date}T12:00:00Z`).toLocaleDateString(LOCALE[lang], {
      timeZone: 'UTC',
    });
    try {
      await this.notificationQueue.email(
        {
          kind: 'customer',
          loggedAgainstUserId: barbershop.ownerUserId ?? 0,
          template: 'waitlist_joined',
          context: {
            CustomerName: name,
            BarbershopName: barbershop.name,
            WaitlistDate: dateStr,
            BarberName: entry.barber?.name ?? null,
            LeaveUrl: waitlistLeaveUrl(entry.id),
            Year: new Date().getFullYear(),
          },
          subject: {
            pt: `Você está na lista de espera de ${barbershop.name}`,
            en: `You're on the waitlist at ${barbershop.name}`,
            es: `Estás en la lista de espera de ${barbershop.name}`,
          },
          lang,
          meta: 'waitlist-joined',
          to: email,
        },
        `waitlist-joined-${entry.id}`,
      );
    } catch (err) {
      this.logger.error(`Erro ao enfileirar confirmação da lista de espera #${entry.id}:`, err);
    }
    return { entryId: entry.id, alreadyWaiting: false };
  }

  /** "Sair da lista de espera" pelo link do e-mail, sem login */
  async leaveWaitlist(token: string) {
    const id = verifyWaitlistLeaveToken(token);
    if (!id) throw new BadRequestException('Link inválido');
    const entry = await this.prisma.waitlistEntry.findUnique({
      where: { id },
      include: { barbershop: { select: { name: true, timezone: true } } },
    });
    if (!entry) throw new NotFoundException('Você não está mais na lista de espera');
    if (entry.status === 'WAITING' || entry.status === 'NOTIFIED') {
      const now = new Date();
      const offer =
        entry.status === 'NOTIFIED' && entry.offeredStartAt && entry.offeredStartAt > now
          ? entry.offeredStartAt
          : null;
      // A vaga só passa se este clique ainda é dono dela. O job do prazo
      // pode ter pegado o mesmo horário no meio do caminho.
      const claimed = await this.prisma.waitlistEntry.updateMany({
        where: {
          id,
          status: { in: ['WAITING', 'NOTIFIED'] },
          ...(offer ? { offeredStartAt: offer } : {}),
        },
        data: { status: 'CANCELLED', offeredStartAt: null, notifiedAt: null },
      });
      const cancelled =
        claimed.count === 1
          ? claimed
          : await this.prisma.waitlistEntry.updateMany({
              where: { id, status: { in: ['WAITING', 'NOTIFIED'] } },
              data: { status: 'CANCELLED', offeredStartAt: null, notifiedAt: null },
            });
      if (cancelled.count === 1) {
        this.realtime.notify(entry.barbershopId, 'WAITLIST', 'UPDATED');
      }
      if (claimed.count === 1 && offer) {
        try {
          await this.passWaitlistOffer({
            barbershopId: entry.barbershopId,
            offeredStartAt: offer,
            offeredBarberId: entry.offeredBarberId,
            offeredServiceIds: entry.offeredServiceIds,
            barbershop: entry.barbershop,
          });
        } catch (err) {
          this.logger.error(`Erro ao passar a vaga da lista de espera #${entry.id}:`, err);
        }
      }
    }
    return entry.barbershop.name;
  }

  /**
   * Um horário ficou livre (cancelado, remarcado, reserva sem sinal que
   * expirou): avisa o primeiro da lista de espera que combine. Horário que
   * já passou não interessa a ninguém.
   */
  async checkWaitlistOnCancellation(
    barbershopId: number,
    appointment: { startAt: Date; barberId: number; services: { serviceId: number }[] },
  ) {
    if (appointment.startAt <= new Date()) return;
    // WaitlistEntry.date é gravada como meia-noite UTC do dia escolhido
    // (new Date("YYYY-MM-DD")); o dia do agendamento tem de ser o do fuso da
    // unidade — em UTC, um horário depois das 21h em Brasília já caía no dia
    // seguinte e não achava ninguém na lista.
    // Pausada ou fora do ar: a página não aceita agendamento, ninguém é avisado
    const shop = await this.prisma.barbershop.findFirst({
      where: { id: barbershopId, isActive: true, closedAt: null, ...ownerAcceptsPublic },
      select: { timezone: true },
    });
    if (!shop) return;
    const localDate = toZonedParts(appointment.startAt, safeTimeZone(shop.timezone)).dateStr;
    const dayStart = new Date(`${localDate}T00:00:00Z`);
    const dayEnd = new Date(`${nextDateStr(localDate)}T00:00:00Z`);
    const serviceIds = appointment.services.map((s) => s.serviceId);

    const candidates = await this.prisma.waitlistEntry.findMany({
      where: {
        barbershopId,
        status: 'WAITING',
        date: { gte: dayStart, lt: dayEnd },
        OR: [{ barberId: null }, { barberId: appointment.barberId }],
      },
      include: { customer: true, barbershop: true },
      orderBy: { createdAt: 'asc' },
    });
    // Dois horários liberados juntos no mesmo dia: cada um avisa um da fila
    // (marca só se ainda estava esperando; quem perdeu vai pro próximo)
    let match: (typeof candidates)[number] | undefined;
    for (const c of candidates) {
      if (c.serviceId != null && !serviceIds.includes(c.serviceId)) continue;
      if (await this.closeWaitlistIfBooked(c, shop.timezone)) continue;
      const claimed = await this.prisma.waitlistEntry.updateMany({
        where: { id: c.id, status: 'WAITING' },
        data: {
          status: 'NOTIFIED',
          notifiedAt: new Date(),
          offeredStartAt: appointment.startAt,
          offeredBarberId: appointment.barberId,
          offeredServiceIds: serviceIds,
        },
      });
      if (claimed.count === 1) {
        match = c;
        break;
      }
    }
    if (!match) return;
    // Quem está na tela da lista de espera vê a entrada virar "avisado"
    this.realtime.notify(barbershopId, 'WAITLIST', 'UPDATED');
    await this.sendWaitlistNotice(match, appointment.startAt, localDate);
  }

  /**
   * O cliente já tem horário na unidade no dia da entrada (agendou pelo
   * aviso ou por conta própria): a entrada fecha (BOOKED) e não é avisada.
   */
  private async closeWaitlistIfBooked(
    entry: { id: number; barbershopId: number; customerId: number; date: Date },
    timezone: string | null | undefined,
  ) {
    const day = entry.date.toISOString().slice(0, 10);
    const tz = safeTimeZone(timezone);
    const booked = await this.prisma.appointment.findFirst({
      where: {
        barbershopId: entry.barbershopId,
        customerId: entry.customerId,
        status: { in: WAITLIST_BOOKED_STATUSES },
        startAt: { gte: zonedTimeToUtc(day, 0, tz), lt: zonedTimeToUtc(nextDateStr(day), 0, tz) },
      },
      select: { id: true },
    });
    if (!booked) return false;
    await this.prisma.waitlistEntry.updateMany({
      where: { id: entry.id, status: { in: ['WAITING', 'NOTIFIED'] } },
      data: { status: 'BOOKED', offeredStartAt: null },
    });
    return true;
  }

  /**
   * Fecha o que ficou para trás na lista de espera: dia que já passou (no
   * fuso da unidade) vira EXPIRED, e quem já tem horário no dia, BOOKED.
   * Antes ficavam "aguardando" para sempre e contavam no limite por cliente.
   */
  async closeStaleWaitlistEntries() {
    const expired = await this.prisma.$executeRaw`
      UPDATE "WaitlistEntry" w
         SET status = 'EXPIRED', "offeredStartAt" = NULL
        FROM "Barbershop" b
        LEFT JOIN pg_timezone_names t ON t.name = b.timezone
       WHERE b.id = w."barbershopId"
         AND w.status IN ('WAITING', 'NOTIFIED')
         AND w.date < date_trunc('day', now() AT TIME ZONE
               COALESCE(t.name, 'UTC'))`;
    const booked = await this.prisma.$executeRaw`
      UPDATE "WaitlistEntry" w
         SET status = 'BOOKED', "offeredStartAt" = NULL
        FROM "Barbershop" b
        LEFT JOIN pg_timezone_names t ON t.name = b.timezone
       WHERE b.id = w."barbershopId"
         AND w.status IN ('WAITING', 'NOTIFIED')
         AND EXISTS (
           SELECT 1 FROM "Appointment" a
            WHERE a."barbershopId" = w."barbershopId"
              AND a."customerId" = w."customerId"
              AND a.status IN ('CONFIRMED', 'PENDING_PAYMENT', 'COMPLETED')
              AND (a."startAt" AT TIME ZONE 'UTC' AT TIME ZONE
                    COALESCE(t.name, 'UTC'))::date
                  = w.date::date)`;
    if (expired || booked) {
      this.logger.log(
        `Lista de espera: ${expired} entrada(s) vencida(s), ${booked} já agendada(s)`,
      );
    }
    return { expired, booked };
  }

  /**
   * Quem foi avisado e não agendou no prazo: se o horário continua livre,
   * avisa o próximo da fila. Antes, o aviso ia só pra primeira pessoa e,
   * sem resposta, o horário ficava vago. Roda a cada poucos minutos.
   */
  async passExpiredWaitlistOffers() {
    const now = new Date();
    const expired = await this.prisma.waitlistEntry.findMany({
      where: {
        status: 'NOTIFIED',
        notifiedAt: { lte: new Date(now.getTime() - WAITLIST_OFFER_MINUTES * 60_000) },
        offeredStartAt: { gt: now },
      },
      select: {
        id: true,
        barbershopId: true,
        offeredStartAt: true,
        offeredBarberId: true,
        offeredServiceIds: true,
        barbershop: { select: { timezone: true } },
      },
      orderBy: { notifiedAt: 'asc' },
      take: 100,
    });
    let passed = 0;
    for (const e of expired) {
      const startAt = e.offeredStartAt;
      if (!startAt) continue;
      // Uma vez só (duas execuções juntas não passam a mesma vaga duas vezes)
      const claimed = await this.prisma.waitlistEntry.updateMany({
        where: { id: e.id, offeredStartAt: startAt },
        data: { offeredStartAt: null },
      });
      if (claimed.count === 0) continue;
      try {
        const result = await this.passWaitlistOffer(e);
        if (result === 'taken') {
          await this.backToWaiting(e.id);
          continue;
        }
        passed++;
      } catch (err) {
        this.logger.error(`Erro ao passar a vaga da lista de espera #${e.id}:`, err);
      }
      // Depois de passar a vaga (senão ela voltava para a mesma pessoa): quem
      // não conseguiu pegar volta a esperar, no mesmo lugar da fila
      await this.backToWaiting(e.id);
    }
    // Vaga oferecida cujo horário já passou (alguém pegou ou ninguém agendou):
    // a entrada volta a esperar os próximos horários do dia
    await this.prisma.waitlistEntry.updateMany({
      where: { status: 'NOTIFIED', offeredStartAt: { lte: now } },
      data: { status: 'WAITING', offeredStartAt: null, notifiedAt: null },
    });
    return passed;
  }

  /**
   * A vaga oferecida continua livre: avisa o próximo da fila. Quem chamou
   * já tirou o horário desta entrada. 'taken' = alguém já marcou esse horário.
   */
  private async passWaitlistOffer(e: {
    barbershopId: number;
    offeredStartAt: Date | null;
    offeredBarberId: number | null;
    offeredServiceIds: number[];
    barbershop: { timezone: string | null };
  }): Promise<'taken' | 'passed'> {
    const startAt = e.offeredStartAt;
    if (!startAt) return 'passed';
    if (e.offeredBarberId != null) {
      const taken = await this.prisma.appointment.findFirst({
        where: {
          barberId: e.offeredBarberId,
          status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] },
          startAt: { lte: startAt },
          endAt: { gt: startAt },
        },
        select: { id: true },
      });
      if (taken) return 'taken';
      await this.checkWaitlistOnCancellation(e.barbershopId, {
        startAt,
        barberId: e.offeredBarberId,
        services: e.offeredServiceIds.map((serviceId) => ({ serviceId })),
      });
      return 'passed';
    }
    // Horário que abriu na escala: só ele conta como novo (os outros
    // livres do dia já estavam livres e não avisam ninguém)
    const day = toZonedParts(startAt, safeTimeZone(e.barbershop.timezone)).dateStr;
    const scope = { from: day, to: day };
    const before = await this.waitlistOpeningSnapshot(e.barbershopId, scope);
    const offered = startAt.toISOString();
    for (const slots of before.values()) slots.delete(offered);
    await this.checkWaitlistOnOpening(e.barbershopId, scope, before);
    return 'passed';
  }

  /** Entrada avisada que não pegou a vaga volta a esperar (pela ordem de entrada) */
  private async backToWaiting(entryId: number) {
    await this.prisma.waitlistEntry.updateMany({
      where: { id: entryId, status: 'NOTIFIED' },
      data: { status: 'WAITING', offeredStartAt: null, notifiedAt: null },
    });
  }

  /**
   * Abriu horário novo (folga desfeita, fechamento removido, escala ou
   * horário de funcionamento ampliados): quem espera nesses dias e agora
   * tem um horário que antes não havia é avisado, na ordem de entrada. Quem
   * chama tira a foto (`waitlistOpeningSnapshot`) antes de mudar a agenda;
   * assim, uma entrada num dia que já tinha horário livre não é avisada à
   * toa. Cada horário novo avisa uma pessoa só, como no cancelamento.
   */
  async checkWaitlistOnOpening(
    barbershopId: number,
    opts: WaitlistOpeningScope = {},
    before?: Map<number, Set<string>>,
  ) {
    const found = await this.waitlistOpeningSlots(barbershopId, opts);
    const now = Date.now();
    const given = new Map<string, Set<string>>();
    let notified = 0;
    for (const { entry, day, slots } of found) {
      const had = before?.get(entry.id);
      const taken = given.get(day) ?? new Set<string>();
      const slot = slots.find((iso) => Date.parse(iso) > now && !had?.has(iso) && !taken.has(iso));
      if (!slot) continue;
      if (await this.closeWaitlistIfBooked(entry, entry.barbershop.timezone)) continue;
      // Condicional: a equipe pode ter mexido na entrada enquanto isso
      const claimed = await this.prisma.waitlistEntry.updateMany({
        where: { id: entry.id, status: 'WAITING' },
        data: {
          status: 'NOTIFIED',
          notifiedAt: new Date(),
          // Horário aberto na escala: sem profissional definido
          offeredStartAt: new Date(slot),
          offeredBarberId: null,
          offeredServiceIds: [],
        },
      });
      if (claimed.count === 0) continue;
      taken.add(slot);
      given.set(day, taken);
      notified++;
      await this.sendWaitlistNotice(entry, new Date(slot), day);
    }
    if (notified) this.realtime.notify(barbershopId, 'WAITLIST', 'UPDATED');
    return notified;
  }

  /** Horários livres de cada entrada aguardando, antes de a agenda mudar */
  async waitlistOpeningSnapshot(barbershopId: number, opts: WaitlistOpeningScope = {}) {
    const found = await this.waitlistOpeningSlots(barbershopId, opts);
    return new Map(found.map(({ entry, slots }) => [entry.id, new Set(slots)]));
  }

  /**
   * Muda a agenda e depois avisa a lista de espera do que abriu, sem segurar
   * quem mudou (o aviso roda em segundo plano).
   */
  async withWaitlistOpening<T>(
    barbershopId: number,
    opts: WaitlistOpeningScope,
    change: () => Promise<T>,
  ): Promise<T> {
    const before = await this.waitlistOpeningSnapshot(barbershopId, opts).catch(() => undefined);
    const result = await change();
    this.checkWaitlistOnOpening(barbershopId, opts, before).catch((err) =>
      this.logger.error(`Erro ao avisar a lista de espera (unidade #${barbershopId}):`, err),
    );
    return result;
  }

  private async waitlistOpeningSlots(barbershopId: number, opts: WaitlistOpeningScope) {
    const shop = await this.prisma.barbershop.findFirst({
      where: { id: barbershopId, isActive: true, closedAt: null, ...ownerAcceptsPublic },
      select: { timezone: true },
    });
    if (!shop) return [];
    const today = toZonedParts(new Date(), safeTimeZone(shop.timezone)).dateStr;
    const from = opts.from && opts.from > today ? opts.from : today;
    const last = addDaysStr(today, WAITLIST_MAX_DAYS_AHEAD);
    const to = opts.to && opts.to < last ? opts.to : last;
    if (from > to) return [];

    const entries = await this.prisma.waitlistEntry.findMany({
      where: {
        barbershopId,
        status: 'WAITING',
        date: {
          gte: new Date(`${from}T00:00:00Z`),
          lt: new Date(`${nextDateStr(to)}T00:00:00Z`),
        },
        ...(opts.barberId != null ? { OR: [{ barberId: null }, { barberId: opts.barberId }] } : {}),
      },
      include: { customer: true, barbershop: true },
      orderBy: { createdAt: 'asc' },
      take: WAITLIST_OPENING_MAX_ENTRIES,
    });
    if (!entries.length) return [];
    // Sem serviço na entrada: o mais curto da unidade
    const shortest = await this.prisma.barbershopService.findFirst({
      where: { barbershopId, isActive: true },
      orderBy: { durationMinutes: 'asc' },
      select: { id: true },
    });
    const found: { entry: (typeof entries)[number]; day: string; slots: string[] }[] = [];
    for (const entry of entries) {
      const serviceId = entry.serviceId ?? shortest?.id;
      if (!serviceId) continue;
      const day = entry.date.toISOString().slice(0, 10);
      try {
        const slots = await this.getPublicAvailableSlots(
          barbershopId,
          entry.barberId,
          [serviceId],
          day,
        );
        found.push({ entry, day, slots });
      } catch {
        // profissional ou serviço que saiu da página pública
      }
    }
    return found;
  }

  /** Aviso de vaga (e-mail e WhatsApp) para uma entrada da lista de espera */
  private async sendWaitlistNotice(
    match: Prisma.WaitlistEntryGetPayload<{ include: { customer: true; barbershop: true } }>,
    startAt: Date,
    localDate: string,
  ) {
    // Cliente não tem idioma salvo: língua do país da unidade
    const lang = langForCountry(match.barbershop.country);
    const dateStr = startAt.toLocaleDateString(LOCALE[lang], {
      timeZone: match.barbershop.timezone,
    });
    const timeStr = startAt.toLocaleTimeString(LOCALE[lang], {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: match.barbershop.timezone,
    });

    // Envio pela fila (tentativas + limite de taxa), sem segurar o
    // cancelamento esperando o Mailgun/a Meta responderem
    try {
      const to = match.contactEmail ?? match.customer.email;
      if (to) {
        await this.notificationQueue.email(
          {
            kind: 'customer',
            loggedAgainstUserId: match.barbershop.ownerUserId ?? 0,
            template: 'waitlist_slot_available',
            context: {
              CustomerName: match.customer.name,
              BarbershopName: match.barbershop.name,
              BarbershopPhone: match.barbershop.phone,
              AppointmentDate: dateStr,
              AppointmentTime: timeStr,
              BookUrl: waitlistBookUrl(match.barbershop.slug, localDate, match),
              Year: new Date().getFullYear(),
            },
            subject: {
              pt: `Vaga disponível em ${match.barbershop.name}`,
              en: `A slot opened up at ${match.barbershop.name}`,
              es: `Hay un horario disponible en ${match.barbershop.name}`,
            },
            lang,
            meta: 'waitlist-slot-available',
            to,
          },
          `waitlist-email-${match.id}`,
        );
      }

      // Quem entrou pela página recebe só no e-mail que informou: o telefone
      // digitado não é confirmado e pode ser o de outra pessoa (item 249)
      const phone =
        this.whatsappService.isConfigured() && match.source !== 'online'
          ? phoneForWhatsapp(match.customer.phone, match.barbershop.country)
          : null;
      if (phone) {
        await this.notificationQueue.whatsapp(
          {
            kind: 'waitlist-slot',
            to: phone,
            lang,
            params: {
              customerName: match.customer.name,
              barbershopName: match.barbershop.name,
              date: dateStr,
              time: timeStr,
            },
          },
          `waitlist-whatsapp-${match.id}`,
        );
      }
    } catch (err) {
      this.logger.error(`Erro ao enfileirar aviso da lista de espera #${match.id}:`, err);
    }
  }

  // ============ CAMPANHAS DE MARKETING (Message Blast) ============
  // Disparo segmentado por WhatsApp/e-mail. Guarda só o resumo de cada
  // campanha (não uma linha por destinatário) e respeita
  // Customer.marketingOptOut. WhatsApp precisa de um template genérico
  // aprovado (ver .env.example); sem credencial configurada, envia só
  // por e-mail.

  private async resolveMarketingSegment(
    networkId: number,
    barbershopId: number,
    segment: string,
    inactiveDays?: number,
    networkWide = false,
    country = 'BR',
  ) {
    // Quem saiu das campanhas em qualquer ficha da rede: o mesmo e-mail ou o
    // mesmo telefone em outra ficha também não recebe (item 191)
    const optedOut = await this.prisma.customer.findMany({
      where: { networkId, marketingOptOut: true },
      select: { email: true, phone: true },
    });
    // Bloqueado pela unidade não recebe. Gerente manda só pra quem já foi
    // atendido na unidade; a rede inteira é só do dono (antes o gerente de
    // uma unidade disparava pros clientes de todas)
    const baseWhere: Prisma.CustomerWhereInput = {
      networkId,
      isActive: true,
      marketingOptOut: false,
      deletedAt: null,
      blockedAt: null,
      ...(networkWide
        ? {}
        : {
            OR: [
              { appointments: { some: { barbershopId } } },
              { sales: { some: { barbershopId } } },
            ],
          }),
    };

    if (segment === 'INACTIVE') {
      const days = inactiveDays ?? 60;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const [recent, ever] = await Promise.all([
        this.prisma.serviceHistory.findMany({
          where: { barbershopId, performedAt: { gte: cutoff } },
          select: { customerId: true },
          distinct: ['customerId'],
        }),
        this.prisma.serviceHistory.findMany({
          where: { barbershopId },
          select: { customerId: true },
          distinct: ['customerId'],
        }),
      ]);
      const recentIds = new Set(recent.map((r) => r.customerId));
      const inactiveIds = ever.map((r) => r.customerId).filter((id) => !recentIds.has(id));
      return this.uniqueRecipients(
        optedOut,
        await this.prisma.customer.findMany({ where: { ...baseWhere, id: { in: inactiveIds } } }),
        country,
      );
    }

    if (segment === 'BIRTHDAY_MONTH') {
      // Mês corrente no fuso da unidade; birthDate é data de calendário
      // gravada como meia-noite UTC (new Date("YYYY-MM-DD")), então o mês
      // dela é o UTC — getMonth() no fuso local jogava quem nasceu no dia 1
      // pro mês anterior num servidor a oeste de Greenwich.
      const shop = await this.prisma.barbershop.findUnique({
        where: { id: barbershopId },
        select: { timezone: true },
      });
      const currentMonth =
        Number(toZonedParts(new Date(), safeTimeZone(shop?.timezone)).dateStr.slice(5, 7)) - 1;
      const customers = await this.prisma.customer.findMany({
        where: { ...baseWhere, birthDate: { not: null } },
      });
      return this.uniqueRecipients(
        optedOut,
        customers.filter((c) => c.birthDate && c.birthDate.getUTCMonth() === currentMonth),
        country,
      );
    }

    // ALL
    return this.uniqueRecipients(
      optedOut,
      await this.prisma.customer.findMany({ where: baseWhere }),
      country,
    );
  }

  /**
   * A mesma pessoa recebe a campanha uma vez: fichas duplicadas com o mesmo
   * e-mail (sem diferença de caixa) ou o mesmo telefone (normalizado) contam
   * como uma. Quem saiu das campanhas em qualquer ficha com esse e-mail ou
   * telefone fica de fora (antes o WhatsApp ia pela ficha repetida).
   */
  private uniqueRecipients<T extends { email: string | null; phone: string | null }>(
    optedOut: { email: string | null; phone: string | null }[],
    customers: T[],
    country = 'BR',
  ): T[] {
    const emailOf = (c: { email: string | null }) => c.email?.trim().toLowerCase() || null;
    const phoneOf = (c: { phone: string | null }) =>
      c.phone ? phoneForWhatsapp(c.phone, country) : null;
    const outEmails = new Set(optedOut.map(emailOf).filter((e): e is string => !!e));
    const outPhones = new Set(optedOut.map(phoneOf).filter((p): p is string => !!p));
    // Agrupa as fichas ligadas por e-mail ou telefone (A e B pelo e-mail, B e
    // C pelo telefone: as três são a mesma pessoa), sem depender da ordem
    const parent = customers.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const owner = new Map<string, number>();
    const keys = customers.map((c) => {
      const email = emailOf(c);
      const phone = phoneOf(c);
      return { email, phone, all: [email && `e:${email}`, phone && `p:${phone}`] };
    });
    keys.forEach(({ all }, i) => {
      for (const key of all) {
        if (!key) continue;
        const j = owner.get(key);
        if (j === undefined) owner.set(key, i);
        else parent[find(i)] = find(j);
      }
    });
    const groups = new Map<number, number[]>();
    customers.forEach((_, i) => {
      const root = find(i);
      groups.set(root, [...(groups.get(root) ?? []), i]);
    });
    const out: T[] = [];
    for (const members of groups.values()) {
      const optOut = members.some((i) => {
        const { email, phone } = keys[i];
        return (!!email && outEmails.has(email)) || (!!phone && outPhones.has(phone));
      });
      if (optOut) continue;
      // Uma ficha por pessoa, com o e-mail e o telefone que o grupo tiver
      const first = customers[members[0]];
      const withEmail = members.find((i) => keys[i].email);
      const withPhone = members.find((i) => keys[i].phone);
      out.push({
        ...first,
        email: withEmail != null ? customers[withEmail].email : first.email,
        phone: withPhone != null ? customers[withPhone].phone : first.phone,
      });
    }
    return out;
  }

  async previewMarketingSegment(
    userId: number,
    barbershopId: number,
    segment: string,
    inactiveDays?: number,
  ) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const customers = await this.resolveMarketingSegment(
      barbershop.networkId,
      barbershopId,
      segment,
      inactiveDays,
      barbershop.accessLevel === 'owner',
      barbershop.country,
    );
    return { recipientCount: customers.length };
  }

  async getMarketingCampaigns(userId: number, barbershopId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    return this.prisma.marketingCampaign.findMany({
      where: { barbershopId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async sendMarketingBlast(
    userId: number,
    barbershopId: number,
    data: {
      subject?: string;
      message: string;
      segment: string;
      inactiveDays?: number;
      sendEmail: boolean;
      sendWhatsapp: boolean;
    },
  ) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    // Unidade ou rede suspensa pela plataforma não dispara campanha (item 190)
    if (barbershop.platformSuspendedAt || barbershop.network?.platformSuspendedAt) {
      throw new BadRequestException(MARKETING_SUSPENDED_MESSAGE);
    }
    // Uma campanha por dia por unidade: disparos repetidos derrubam a
    // reputação de envio do domínio da plataforma (todas as unidades)
    const since = new Date(Date.now() - MARKETING_MIN_INTERVAL_HOURS * 3_600_000);
    const recent = await this.prisma.marketingCampaign.findFirst({
      where: { barbershopId, createdAt: { gte: since } },
      select: { id: true },
    });
    if (recent) throw new BadRequestException(MARKETING_DAILY_LIMIT_MESSAGE);
    const customers = await this.resolveMarketingSegment(
      barbershop.networkId,
      barbershopId,
      data.segment,
      data.inactiveDays,
      barbershop.accessLevel === 'owner',
      barbershop.country,
    );

    // Cria a campanha primeiro e enfileira um envio por cliente — antes o
    // loop enviava um por um dentro da própria requisição (milhares de
    // clientes = dezenas de minutos, timeout no meio e contagem errada).
    // Os workers atualizam emailSentCount/whatsappSentCount conforme enviam.
    const emailRecipients = data.sendEmail
      ? customers.filter((c): c is typeof c & { email: string } => !!c.email)
      : [];
    const lang = langForCountry(barbershop.country);
    let whatsappMessage = data.message;
    if (data.sendWhatsapp) {
      const prepared = whatsappMarketingBody(data.message ?? '', lang);
      if (!prepared.ok) {
        throw new BadRequestException(
          prepared.reason === 'too_long'
            ? 'A mensagem do WhatsApp pode ter no máximo 1.024 caracteres.'
            : 'Escreva a mensagem da campanha.',
        );
      }
      whatsappMessage = prepared.text;
    }
    const whatsappPhones =
      data.sendWhatsapp && this.whatsappService.isConfigured()
        ? customers
            .map((c) => phoneForWhatsapp(c.phone, barbershop.country))
            .filter((phone): phone is string => !!phone)
            .filter((phone, i, all) => all.indexOf(phone) === i)
        : [];

    if (emailRecipients.length > 0) {
      const sent = await this.prisma.marketingCampaign.aggregate({
        where: { barbershopId, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
        _sum: { emailQueuedCount: true },
      });
      if (
        (sent._sum.emailQueuedCount ?? 0) + emailRecipients.length >
        MARKETING_EMAILS_PER_30_DAYS
      ) {
        throw new BadRequestException(MARKETING_MONTHLY_LIMIT_MESSAGE);
      }
    }

    const campaign = await this.prisma.marketingCampaign.create({
      data: {
        barbershopId,
        createdByUserId: userId,
        subject: data.subject,
        message: data.message,
        segment: data.segment,
        inactiveDays: data.inactiveDays,
        sentByEmail: data.sendEmail,
        sentByWhatsapp: data.sendWhatsapp,
        recipientCount: customers.length,
        emailQueuedCount: emailRecipients.length,
        whatsappQueuedCount: whatsappPhones.length,
      },
    });

    await this.notificationQueue.emailBulk(
      emailRecipients.map((customer) => {
        // Cada e-mail leva o link de descadastro do próprio cliente (LGPD) e
        // os cabeçalhos de descadastro com um clique (Gmail/Yahoo exigem)
        const unsubscribe = unsubscribeLinks(customer.id);
        return {
          kind: 'customer' as const,
          loggedAgainstUserId: barbershop.ownerUserId ?? 0,
          template: 'marketing_blast',
          context: {
            BarbershopName: barbershop.name,
            Subject: data.subject ?? barbershop.name,
            Message: data.message,
            Year: new Date().getFullYear(),
            UnsubscribeURL: unsubscribe.page,
          },
          headers: unsubscribe.headers,
          subject: data.subject ?? barbershop.name,
          // Texto da campanha é do dono; o rodapé do template sai na língua do país da unidade
          lang,
          meta: 'marketing-blast',
          to: customer.email,
          campaignId: campaign.id,
        };
      }),
    );
    await this.notificationQueue.whatsappBulk(
      whatsappPhones.map((phone) => ({
        kind: 'marketing' as const,
        to: phone,
        message: whatsappMessage,
        campaignId: campaign.id,
        lang,
      })),
    );

    return campaign;
  }

  /**
   * Descadastro pelo link do e-mail de marketing (sem login). Marca a ficha
   * como fora das campanhas; devolve o nome da rede/unidade pra tela.
   */
  async unsubscribeFromMarketing(token: string): Promise<string> {
    const customerId = verifyUnsubscribeToken(token);
    if (!customerId) throw new BadRequestException('Link de descadastro inválido');
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: { network: { include: { barbershops: { take: 1, orderBy: { id: 'asc' } } } } },
    });
    if (!customer) throw new BadRequestException('Link de descadastro inválido');
    const email = customer.email?.trim();
    await this.prisma.customer.updateMany({
      where: {
        networkId: customer.networkId,
        marketingOptOut: false,
        ...(email ? { email: { equals: email, mode: 'insensitive' } } : { id: customer.id }),
      },
      data: { marketingOptOut: true },
    });
    return customer.network?.name || customer.network?.barbershops[0]?.name || 'Barbershop';
  }

  // ============ PÁGINA PÚBLICA E AGENDAMENTO ONLINE ============

  // Horário padrão e dias da semana: ver working-hours.ts (a tela de horário
  // de funcionamento usa os mesmos)
  private readonly DEFAULT_WORKING_HOURS = DEFAULT_WORKING_HOURS;
  private readonly WEEKDAY_KEYS = WEEKDAY_KEYS;

  async getPublicBarbershopByslug(slug: string) {
    const barbershop = await this.prisma.barbershop.findUnique({
      where: { slug },
      include: {
        services: { where: { isActive: true }, orderBy: { displayOrder: 'asc' } },
        barbers: {
          where: {
            isActive: true,
            AND: [
              BOOKABLE_STAFF,
              { OR: [{ accessEndsAt: null }, { accessEndsAt: { gte: new Date() } }] },
            ],
          },
          orderBy: { name: 'asc' },
        },
        ownerUser: { select: { isActive: true, deleted_at: true } },
        network: {
          select: {
            accentColor: true,
            grayColor: true,
            lateCancellationWindowHours: true,
            currency: true,
            noShowFeeEnabled: true,
            noShowFeeType: true,
            noShowFeeValue: true,
            ownerUser: { select: { isActive: true, deleted_at: true } },
          },
        },
        socialConnection: { select: { instagramUsername: true } },
        photos: {
          // A ocultada pela moderação sai da galeria
          where: { hiddenAt: null },
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          take: PORTFOLIO_PHOTOS,
          select: { id: true, key: true, caption: true },
        },
        socialPosts: {
          // O ocultado pela moderação sai da página
          where: { status: 'PUBLISHED', hiddenAt: null },
          orderBy: { publishedAt: 'desc' },
          take: PORTFOLIO_PHOTOS,
          select: { id: true, imageKey: true, caption: true },
        },
      },
    });
    if (!barbershop || !barbershop.isActive || !ownerAccountOpen(barbershop)) {
      throw new NotFoundException('Unidade não encontrada');
    }
    // Capa, logo e foto do profissional ocultados pela moderação saem da
    // página (e do SEO, que lê daqui) até a unidade enviar outra imagem
    if (barbershop.coverHiddenAt) barbershop.coverKey = null;
    if (barbershop.logoHiddenAt) barbershop.photoKey = null;
    barbershop.barbers = barbershop.barbers.map((b) =>
      b.avatarHiddenAt ? { ...b, avatarKey: null, avatarUrl: null } : b,
    );
    const imageUrl = barbershop.photoKey
      ? await this.s3Service.getDownloadUrl(barbershop.photoKey)
      : null;
    // Horário de funcionamento (o da unidade ou o padrão), domingo a sábado
    const week =
      parseBusinessHours(barbershop.businessHours) ??
      WEEKDAY_KEYS.map((_, i) => DEFAULT_WORKING_HOURS[i]);
    const openingHours = week.map((d, dayOfWeek) => ({
      dayOfWeek,
      open: d?.start ?? null,
      close: d?.end ?? null,
    }));
    // Galeria enviada pela unidade primeiro; completa com os posts publicados
    const portfolio = await Promise.all(
      [
        ...barbershop.photos.map((p) => ({
          key: p.key,
          caption: p.caption,
          photoId: p.id,
          postId: null,
        })),
        ...barbershop.socialPosts.map((p) => ({
          key: p.imageKey,
          caption: p.caption,
          photoId: null,
          postId: p.id,
        })),
      ]
        .slice(0, PORTFOLIO_PHOTOS)
        .map(async (p) => ({
          url: await this.s3Service.getDownloadUrl(p.key),
          caption: p.caption,
          photoId: p.photoId,
          postId: p.postId,
        })),
    );
    const coverUrl = barbershop.coverKey
      ? await this.s3Service.getDownloadUrl(barbershop.coverKey)
      : null;
    const { averageRating, reviewCount } = await this.getReviewSummary(barbershop.id);
    const completed = await this.prisma.appointment.count({
      where: { barbershopId: barbershop.id, status: 'COMPLETED' },
    });
    const badges = unitBadges({ averageRating, reviewCount, completed });
    const isFeatured = barbershop.featuredUntil != null && barbershop.featuredUntil > new Date();
    const canOfferSubscriptions = await this.canAccessModule(barbershop.id, 'subscriptions');
    const subscriptionPlans = canOfferSubscriptions
      ? await this.prisma.clientSubscriptionPlan.findMany({
          where: { barbershopId: barbershop.id, isActive: true, service: { isActive: true } },
          include: { service: true },
          orderBy: { name: 'asc' },
        })
      : [];
    const {
      socialConnection,
      socialPosts: _posts,
      photos: _photos,
      ownerUser: _owner,
      network,
      ...shop
    } = barbershop;
    const { ownerUser: _networkOwner, ...networkPublic } = network;
    return {
      ...shop,
      network: networkPublic,
      imageUrl,
      coverUrl,
      openingHours,
      portfolio,
      instagramUsername: socialConnection?.instagramUsername ?? null,
      averageRating,
      reviewCount,
      badges,
      isFeatured,
      subscriptionPlans: subscriptionPlans.map((p) => ({
        ...p,
        serviceName: p.service?.name ?? null,
      })),
      // Política de cancelamento, visível antes de agendar
      cancellationPolicy: {
        windowHours: network.lateCancellationWindowHours,
        // Taxa fixa em outra moeda não é cobrada nesta unidade (item 188)
        feeEnabled: networkMoneyRules(shop, network).noShowFeeEnabled && !!network.noShowFeeValue,
        feeType: network.noShowFeeType,
        feeValue: network.noShowFeeValue,
      },
      // Cores definidas pelo dono da franquia — a página pública usa as mesmas
      accentColor: network.accentColor,
      grayColor: network.grayColor,
    };
  }

  // Mesma página pública de sempre (getPublicBarbershopByslug), só que
  // resolvida a partir do host (subdomain.<domínio>) em vez do caminho
  // /u/:slug — usado quando o front detecta que está rodando num
  // subdomínio próprio da unidade.
  async getPublicBarbershopBySubdomain(subdomain: string) {
    const barbershop = await this.prisma.barbershop.findFirst({
      where: { subdomain: subdomain.trim().toLowerCase(), isActive: true },
    });
    if (!barbershop) throw new NotFoundException('Unidade não encontrada');
    return this.getPublicBarbershopByslug(barbershop.slug);
  }

  // Janela de trabalho de um barbeiro num dia da semana, com fallback em
  // cascata: agenda própria do barbeiro (BarberSchedule) > horário da
  // unidade (Barbershop.businessHours) > horário padrão embutido. Isso
  // porque, na prática, nenhuma unidade configurou nem uma coisa nem outra
  // ainda — sem esse fallback a página pública mostraria "sem horários
  // disponíveis" para toda unidade existente.
  private async getWorkingWindow(
    barbershopId: number,
    barberId: number,
    dayOfWeek: number,
  ): Promise<{
    start: string;
    end: string;
    breakStart?: string | null;
    breakEnd?: string | null;
  } | null> {
    const schedule = await this.prisma.barberSchedule.findUnique({
      where: { barberId_dayOfWeek: { barberId, dayOfWeek } },
    });
    if (schedule) {
      if (!schedule.isActive) return null;
      return {
        start: schedule.startTime,
        end: schedule.endTime,
        breakStart: schedule.breakStart,
        breakEnd: schedule.breakEnd,
      };
    }

    return this.shopHoursOn(barbershopId, dayOfWeek);
  }

  /** Horário da unidade no dia da semana (o cadastrado ou o padrão) */
  async shopHoursOn(
    barbershopId: number,
    dayOfWeek: number,
  ): Promise<{ start: string; end: string } | null> {
    const barbershop = await this.prisma.barbershop.findUnique({
      where: { id: barbershopId },
      select: { businessHours: true },
    });
    const days = parseBusinessHours(barbershop?.businessHours);
    if (days) return days[dayOfWeek];

    const fallback = this.DEFAULT_WORKING_HOURS[dayOfWeek];
    return fallback ? { ...fallback } : null;
  }

  /**
   * Expediente num dia específico, com os fechamentos da unidade (feriado,
   * reforma): dia fechado não tem expediente; horário especial limita o do
   * profissional — ou abre um dia que normalmente é fechado, pra quem não
   * tem folga marcada nesse dia da semana.
   */
  async getWorkingWindowOn(barbershopId: number, barberId: number, dateStr: string) {
    const dayOfWeek = dayOfWeekOf(dateStr);
    const [window, closure] = await Promise.all([
      this.getWorkingWindow(barbershopId, barberId, dayOfWeek),
      this.prisma.barbershopClosure.findUnique({
        where: { barbershopId_date: { barbershopId, date: dateStr } },
      }),
    ]);
    if (!closure) return window;
    if (!closure.openTime || !closure.closeTime) return null;
    const open = this.toMinutes(closure.openTime);
    const close = this.toMinutes(closure.closeTime);
    if (!window) {
      const ownSchedule = await this.prisma.barberSchedule.findUnique({
        where: { barberId_dayOfWeek: { barberId, dayOfWeek } },
        select: { id: true },
      });
      // Folga marcada nesse dia da semana continua sendo folga
      if (ownSchedule) return null;
      return { start: closure.openTime, end: closure.closeTime, breakStart: null, breakEnd: null };
    }
    const start = Math.max(this.toMinutes(window.start), open);
    const end = Math.min(this.toMinutes(window.end), close);
    if (start >= end) return null;
    const hhmm = (m: number) =>
      `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    return { ...window, start: hhmm(start), end: hhmm(end) };
  }

  private toMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  }

  /**
   * Serviços escolhidos na página pública (um ou vários, em sequência no
   * mesmo horário, como corte + barba): os da unidade, ativos, na ordem
   * pedida, e a duração somada.
   */
  private async publicServices(barbershopId: number, serviceIds: number[]) {
    const ids = [...new Set(serviceIds)].filter((id) => Number.isInteger(id));
    if (ids.length === 0) throw new BadRequestException('Escolha pelo menos um serviço');
    if (ids.length > 5) throw new BadRequestException('No máximo 5 serviços por agendamento');
    const found = await this.prisma.barbershopService.findMany({
      where: { id: { in: ids }, barbershopId, isActive: true },
    });
    if (found.length !== ids.length) throw new NotFoundException('Serviço não encontrado');
    const services = ids.map((id) =>
      must(
        found.find((s) => s.id === id),
        `serviço ${id}`,
      ),
    );
    return {
      services,
      durationMinutes: services.reduce((sum, s) => sum + s.durationMinutes, 0),
    };
  }

  /** Profissionais que a página pública oferece (ativos, no período, que atendem). */
  private publicBarbers(barbershopId: number) {
    return this.prisma.barber.findMany({
      where: { barbershopId, isActive: true, ...BOOKABLE_STAFF },
      orderBy: { id: 'asc' },
    });
  }

  /**
   * "Qualquer profissional": quem tem menos horários marcados no dia vem
   * primeiro — distribui os clientes da página pública pela equipe.
   */
  private async publicCandidatesByLoad(barbershopId: number, startAtInput: string) {
    const barbers = await this.publicBarbers(barbershopId);
    const day = new Date(startAtInput);
    if (isNaN(day.getTime())) throw new BadRequestException('Horário inválido');
    const counts = await this.prisma.appointment.groupBy({
      by: ['barberId'],
      where: {
        barbershopId,
        barberId: { in: barbers.map((b) => b.id) },
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        startAt: {
          gte: new Date(day.getTime() - 12 * 3_600_000),
          lte: new Date(day.getTime() + 12 * 3_600_000),
        },
      },
      _count: { _all: true },
    });
    const load = new Map(counts.map((c) => [c.barberId, c._count._all]));
    return [...barbers].sort(
      (a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || a.id - b.id,
    );
  }

  /**
   * Horários livres na página pública. Sem profissional ("qualquer
   * profissional", como no Booksy): todos os horários em que pelo menos um
   * está livre.
   */
  async getPublicAvailableSlots(
    barbershopId: number,
    barberId: number | null,
    serviceIds: number[],
    dateStr: string,
  ) {
    const { durationMinutes } = await this.publicServices(barbershopId, serviceIds);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || isNaN(Date.parse(`${dateStr}T00:00:00Z`))) {
      throw new BadRequestException('Data inválida');
    }
    // Tudo no fuso da unidade, não do servidor (ver common/timezone.util.ts)
    const shop = await this.prisma.barbershop.findFirst({
      where: { id: barbershopId, isActive: true, ...ownerAcceptsPublic },
      select: { timezone: true, minBookingLeadMinutes: true },
    });
    if (!shop) return [];
    const timeZone = safeTimeZone(shop?.timezone);
    const notBefore = new Date(Date.now() + (shop?.minBookingLeadMinutes ?? 0) * 60_000);
    // Além da janela do agendamento online, nada (a criação também recusa)
    const lastDay = addDaysStr(
      toZonedParts(new Date(), timeZone).dateStr,
      PUBLIC_BOOKING_WINDOW_DAYS,
    );
    if (dateStr > lastDay) return [];

    if (barberId != null) {
      const barber = await this.prisma.barber.findFirst({
        where: { id: barberId, barbershopId, isActive: true, ...BOOKABLE_STAFF },
      });
      if (!barber) throw new NotFoundException('Profissional não encontrado');
      return this.slotsForBarber(
        barbershopId,
        barber,
        durationMinutes,
        dateStr,
        timeZone,
        notBefore,
      );
    }
    const all = await Promise.all(
      (
        await this.publicBarbers(barbershopId)
      ).map((b) =>
        this.slotsForBarber(barbershopId, b, durationMinutes, dateStr, timeZone, notBefore),
      ),
    );
    return [...new Set(all.flat())].sort();
  }

  /**
   * Próximo horário livre (a partir de hoje ou de `fromDate`, até 60 dias):
   * do profissional escolhido ou, sem profissional, o mais cedo entre todos.
   * O cliente não precisa sair testando dia por dia.
   */
  async getPublicNextAvailableSlot(
    barbershopId: number,
    barberId: number | null,
    serviceIds: number[],
    fromDate?: string | null,
    maxDays = NEXT_AVAILABLE_DAYS,
  ): Promise<{ date: string; startAt: string } | null> {
    const { durationMinutes } = await this.publicServices(barbershopId, serviceIds);
    const shop = await this.prisma.barbershop.findUnique({
      where: { id: barbershopId },
      select: { timezone: true, businessHours: true, minBookingLeadMinutes: true },
    });
    if (!shop) throw new NotFoundException('Unidade não encontrada');
    const timeZone = safeTimeZone(shop.timezone);
    const notBefore = new Date(Date.now() + shop.minBookingLeadMinutes * 60_000);
    let barbers: Awaited<ReturnType<BarbershopService['publicBarbers']>>;
    if (barberId != null) {
      const barber = await this.prisma.barber.findFirst({
        where: { id: barberId, barbershopId, isActive: true, ...BOOKABLE_STAFF },
      });
      if (!barber) throw new NotFoundException('Profissional não encontrado');
      barbers = [barber];
    } else {
      barbers = await this.publicBarbers(barbershopId);
    }
    if (barbers.length === 0) return null;

    const today = toZonedParts(new Date(), timeZone).dateStr;
    const valid =
      !!fromDate &&
      /^\d{4}-\d{2}-\d{2}$/.test(fromDate) &&
      !isNaN(Date.parse(`${fromDate}T00:00:00Z`));
    // Data no passado vira hoje; além da janela do agendamento online, nada
    const lastDay = addDaysStr(today, PUBLIC_BOOKING_WINDOW_DAYS);
    if (valid && fromDate > lastDay) return null;
    const start = valid && fromDate > today ? fromDate : today;
    const daysLeft =
      Math.round(
        (Date.parse(`${lastDay}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
      ) + 1;
    maxDays = Math.min(maxDays, daysLeft);

    // Expediente, fechamentos, horários e folgas do período inteiro, de uma vez.
    const week =
      parseBusinessHours(shop.businessHours) ??
      WEEKDAY_KEYS.map((_, i) => DEFAULT_WORKING_HOURS[i]);
    const professionalIds = [
      ...new Set(barbers.map((b) => b.professionalId).filter((id): id is number => id != null)),
    ];
    const userIds = [
      ...new Set(
        barbers
          .filter((b) => b.professionalId == null && b.userId != null)
          .map((b) => b.userId as number),
      ),
    ];
    const rangeStart = zonedTimeToUtc(start, 0, timeZone);
    const rangeEnd = zonedTimeToUtc(addDaysStr(start, maxDays), 0, timeZone);
    const barberIds = barbers.map((b) => b.id);

    const [schedules, closures, links] = await Promise.all([
      this.prisma.barberSchedule.findMany({ where: { barberId: { in: barberIds } } }),
      this.prisma.barbershopClosure.findMany({
        where: { barbershopId, date: { gte: start, lt: addDaysStr(start, maxDays) } },
      }),
      professionalIds.length || userIds.length
        ? this.prisma.barber.findMany({
            where: {
              OR: [
                ...(professionalIds.length ? [{ professionalId: { in: professionalIds } }] : []),
                ...(userIds.length ? [{ userId: { in: userIds } }] : []),
              ],
            },
            select: { id: true, professionalId: true, userId: true },
          })
        : Promise.resolve(
            [] as { id: number; professionalId: number | null; userId: number | null }[],
          ),
    ]);

    const personIds = new Map<number, number[]>();
    for (const b of barbers) {
      const extra = b.professionalId
        ? links.filter((l) => l.professionalId === b.professionalId).map((l) => l.id)
        : b.userId
        ? links.filter((l) => l.userId === b.userId).map((l) => l.id)
        : [];
      personIds.set(b.id, [...new Set([b.id, ...extra])]);
    }
    const allBarberIds = [...new Set([...personIds.values()].flat())];

    const [appointments, timeOffs] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          barberId: { in: allBarberIds },
          status: { notIn: ['CANCELLED', 'NO_SHOW'] },
          startAt: { lt: rangeEnd },
          endAt: { gt: rangeStart },
        },
        select: { barberId: true, startAt: true, endAt: true },
      }),
      this.prisma.barberTimeOff.findMany({
        where: {
          barberId: { in: allBarberIds },
          startAt: { lt: rangeEnd },
          endAt: { gt: rangeStart },
        },
        select: { barberId: true, startAt: true, endAt: true },
      }),
    ]);

    const busyByBarber = new Map<number, { start: number; end: number }[]>();
    for (const row of [...appointments, ...timeOffs]) {
      const list = busyByBarber.get(row.barberId) ?? [];
      list.push({ start: row.startAt.getTime(), end: row.endAt.getTime() });
      busyByBarber.set(row.barberId, list);
    }
    const schedulesByBarber = new Map<number, typeof schedules>();
    for (const row of schedules) {
      const list = schedulesByBarber.get(row.barberId) ?? [];
      list.push(row);
      schedulesByBarber.set(row.barberId, list);
    }
    const closureByDate = new Map(closures.map((c) => [c.date, c]));

    for (let i = 0; i < maxDays; i++) {
      const date = addDaysStr(start, i);
      const dayStart = zonedTimeToUtc(date, 0, timeZone).getTime();
      const dayEnd = zonedTimeToUtc(nextDateStr(date), 0, timeZone).getTime();
      const closure = closureByDate.get(date) ?? null;
      let earliest: string | undefined;
      for (const b of barbers) {
        const window = this.windowOnDate(schedulesByBarber.get(b.id) ?? [], week, closure, date);
        const busy: { start: number; end: number }[] = [];
        for (const id of personIds.get(b.id) ?? [b.id]) {
          for (const range of busyByBarber.get(id) ?? []) {
            if (range.start < dayEnd && range.end > dayStart) busy.push(range);
          }
        }
        const slot = this.computeSlots(
          b,
          durationMinutes,
          date,
          timeZone,
          window,
          busy,
          true,
          notBefore,
        )[0];
        if (slot && (!earliest || slot < earliest)) earliest = slot;
      }
      if (earliest) return { date, startAt: earliest };
    }
    return null;
  }

  /**
   * Expediente de um dia a partir da escala, do horário da unidade e do
   * fechamento já carregados — mesma regra de getWorkingWindowOn.
   */
  private windowOnDate(
    schedules: {
      dayOfWeek: number;
      isActive: boolean;
      startTime: string;
      endTime: string;
      breakStart: string | null;
      breakEnd: string | null;
    }[],
    week: ({ start: string; end: string } | null)[],
    closure: { openTime: string | null; closeTime: string | null } | null,
    dateStr: string,
  ) {
    const dayOfWeek = dayOfWeekOf(dateStr);
    const schedule = schedules.find((s) => s.dayOfWeek === dayOfWeek);
    let window: {
      start: string;
      end: string;
      breakStart?: string | null;
      breakEnd?: string | null;
    } | null = null;
    if (schedule) {
      if (schedule.isActive) {
        window = {
          start: schedule.startTime,
          end: schedule.endTime,
          breakStart: schedule.breakStart,
          breakEnd: schedule.breakEnd,
        };
      }
    } else {
      const dayHours = week[dayOfWeek];
      if (dayHours) window = { start: dayHours.start, end: dayHours.end };
    }
    if (!closure) return window;
    if (!closure.openTime || !closure.closeTime) return null;
    if (!window) {
      // Folga marcada nesse dia da semana continua sendo folga
      if (schedule) return null;
      return { start: closure.openTime, end: closure.closeTime, breakStart: null, breakEnd: null };
    }
    const open = this.toMinutes(closure.openTime);
    const close = this.toMinutes(closure.closeTime);
    const startMin = Math.max(this.toMinutes(window.start), open);
    const endMin = Math.min(this.toMinutes(window.end), close);
    if (startMin >= endMin) return null;
    const hhmm = (m: number) =>
      `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    return { ...window, start: hhmm(startMin), end: hhmm(endMin) };
  }

  private async slotsForBarber(
    barbershopId: number,
    barber: {
      id: number;
      userId: number | null;
      professionalId?: number | null;
      accessStartsAt: Date | null;
      accessEndsAt: Date | null;
    },
    duration: number,
    dateStr: string,
    timeZone: string,
    notBefore?: Date,
  ) {
    const window = await this.getWorkingWindowOn(barbershopId, barber.id, dateStr);
    if (!window) return [];
    const barberIds = await this.samePersonBarberIds(barber.id, barber);

    const dayStart = zonedTimeToUtc(dateStr, 0, timeZone);
    const dayEnd = zonedTimeToUtc(nextDateStr(dateStr), 0, timeZone);

    const [appointments, timeOffs] = await Promise.all([
      // Ocupado aqui ou em outra unidade onde a pessoa também atende
      this.prisma.appointment.findMany({
        where: {
          barberId: { in: barberIds },
          status: { notIn: ['CANCELLED', 'NO_SHOW'] },
          startAt: { lt: dayEnd },
          endAt: { gt: dayStart },
        },
        select: { startAt: true, endAt: true },
      }),
      this.prisma.barberTimeOff.findMany({
        where: { barberId: { in: barberIds }, startAt: { lt: dayEnd }, endAt: { gt: dayStart } },
        select: { startAt: true, endAt: true },
      }),
    ]);

    const busyRanges = [...appointments, ...timeOffs].map((r) => ({
      start: r.startAt.getTime(),
      end: r.endAt.getTime(),
    }));
    return this.computeSlots(
      barber,
      duration,
      dateStr,
      timeZone,
      window,
      busyRanges,
      false,
      notBefore,
    );
  }

  /** Horários livres de um expediente já resolvido. `firstOnly` para no primeiro. */
  private computeSlots(
    barber: { accessStartsAt: Date | null; accessEndsAt: Date | null },
    duration: number,
    dateStr: string,
    timeZone: string,
    window: {
      start: string;
      end: string;
      breakStart?: string | null;
      breakEnd?: string | null;
    } | null,
    busyRanges: { start: number; end: number }[],
    firstOnly = false,
    notBefore?: Date,
  ) {
    if (!window) return [];
    const windowStartMin = this.toMinutes(window.start);
    const windowEndMin = this.toMinutes(window.end);
    const breakStartMin = window.breakStart ? this.toMinutes(window.breakStart) : null;
    const breakEndMin = window.breakEnd ? this.toMinutes(window.breakEnd) : null;

    const cutoff = notBefore ?? new Date();
    const slots: string[] = [];

    for (
      let minutes = windowStartMin;
      minutes + duration <= windowEndMin;
      minutes += SLOT_GRANULARITY_MIN
    ) {
      if (breakStartMin != null && breakEndMin != null) {
        const overlapsBreak = minutes < breakEndMin && minutes + duration > breakStartMin;
        if (overlapsBreak) continue;
      }

      const slotStart = zonedTimeToUtc(dateStr, minutes, timeZone);
      const slotEnd = new Date(slotStart.getTime() + duration * 60000);

      if (slotStart.getTime() <= cutoff.getTime()) continue;
      if (!withinEngagement(barber, slotStart)) continue;

      const overlapsBusy = busyRanges.some(
        (r) => slotStart.getTime() < r.end && slotEnd.getTime() > r.start,
      );
      if (overlapsBusy) continue;

      slots.push(slotStart.toISOString());
      if (firstOnly) return slots;
    }

    return slots;
  }

  /**
   * Horário escolhido pelo cliente (agendar ou remarcar pela página pública):
   * revalida no servidor a janela de trabalho e o intervalo — nunca confia só
   * na lista de horários que o cliente buscou antes (pode estar desatualizada
   * ou ter sido manipulada). Dia da semana e hora de parede no fuso da
   * unidade, não do servidor. O conflito com outros horários é checado por
   * quem chama, dentro da transação.
   */
  private async ensurePublicSlot(
    barbershop: { id: number; timezone: string | null; minBookingLeadMinutes?: number | null },
    barberId: number,
    durationMinutes: number,
    startAtInput: string,
  ) {
    const startAt = new Date(startAtInput);
    const leadMs = Math.max(0, barbershop.minBookingLeadMinutes ?? 0) * 60_000;
    const now = Date.now();
    if (isNaN(startAt.getTime()) || startAt.getTime() <= now + leadMs) {
      throw new BadRequestException(
        leadMs > 0 && startAt.getTime() > now
          ? 'Esse horário precisa de mais antecedência'
          : 'Horário inválido',
      );
    }
    const timeZone = safeTimeZone(barbershop.timezone);
    const local = toZonedParts(startAt, timeZone);
    const today = toZonedParts(new Date(), timeZone).dateStr;
    if (local.dateStr > addDaysStr(today, PUBLIC_BOOKING_WINDOW_DAYS)) {
      throw new BadRequestException('Esse dia ainda não está aberto para agendamento online');
    }
    const endAt = new Date(startAt.getTime() + durationMinutes * 60000);
    const window = await this.getWorkingWindowOn(barbershop.id, barberId, local.dateStr);
    if (!window) throw new BadRequestException('Profissional não atende nesse dia');
    const startMin = local.minutesOfDay;
    // Só os horários da lista (grade a partir do início do expediente): pela
    // API dava pra marcar 14:07 e deixar buracos de minutos na agenda
    if (
      startAt.getUTCSeconds() !== 0 ||
      startAt.getUTCMilliseconds() !== 0 ||
      (startMin - this.toMinutes(window.start)) % SLOT_GRANULARITY_MIN !== 0
    ) {
      throw new BadRequestException('Escolha um dos horários da lista');
    }
    const endMin = startMin + durationMinutes;
    if (startMin < this.toMinutes(window.start) || endMin > this.toMinutes(window.end)) {
      throw new BadRequestException('Horário fora do expediente do profissional');
    }
    if (window.breakStart && window.breakEnd) {
      const breakStartMin = this.toMinutes(window.breakStart);
      const breakEndMin = this.toMinutes(window.breakEnd);
      if (startMin < breakEndMin && endMin > breakStartMin) {
        throw new BadRequestException('Horário cai no intervalo do profissional');
      }
    }
    // Folga/férias: a lista de horários já tira, mas o horário chega do
    // navegador (lista antiga ou montado à mão) e passava aqui
    const person = await this.prisma.barber.findUnique({
      where: { id: barberId },
      select: { userId: true, professionalId: true },
    });
    const barberIds = await this.samePersonBarberIds(barberId, person);
    const off = await this.prisma.barberTimeOff.findFirst({
      where: { barberId: { in: barberIds }, startAt: { lt: endAt }, endAt: { gt: startAt } },
      select: { id: true },
    });
    if (off) throw new BadRequestException('Profissional de folga nesse horário');
    return { startAt, endAt };
  }

  /** Agenda fechada para gente nova. Quem já teve horário com o profissional continua. */
  private async professionalAcceptsNewBooking(barberId: number, customerId: number | null) {
    const barber = await this.prisma.barber.findUnique({
      where: { id: barberId },
      select: { professional: { select: { id: true, acceptingClients: true } } },
    });
    if (!barber?.professional || barber.professional.acceptingClients) return true;
    if (!customerId) return false;
    const prior = await this.prisma.appointment.count({
      where: {
        customerId,
        status: { not: 'CANCELLED' },
        barber: { professionalId: barber.professional.id },
      },
    });
    return acceptsNewClient(false, prior);
  }

  async createPublicAppointment(input: {
    barbershopId: number;
    /** Sem profissional: "qualquer profissional" — o sistema escolhe um livre */
    barberId?: number | null;
    /** Um serviço ou vários, em sequência no mesmo horário */
    serviceIds: number[];
    startAt: string;
    customerName: string;
    customerPhone: string;
    customerEmail?: string;
    notes?: string;
    clientAccountId?: number;
    referralCode?: string;
    channel?: string;
  }) {
    const barbershop = await this.prisma.barbershop.findFirst({
      where: { id: input.barbershopId, isActive: true, ...ownerAcceptsPublic },
    });
    if (!barbershop) throw new NotFoundException('Unidade não encontrada');
    const requestedStart = new Date(input.startAt);
    if (!isNaN(requestedStart.getTime())) {
      await assertSoloBookingAllowed(this.prisma, barbershop.id, requestedStart);
    }

    await this.ensureNotBlocked(barbershop.networkId, input);
    await this.ensureNotPlatformSuspended(input);

    const [returningId] = await this.customerIdsByPhone(barbershop.networkId, input.customerPhone);
    const returningCustomer = returningId != null ? { id: returningId } : null;

    const { services, durationMinutes } = await this.publicServices(
      input.barbershopId,
      input.serviceIds,
    );
    const auto = input.barberId == null;
    let candidates: Array<{ id: number }>;
    if (!auto) {
      const barber = await this.prisma.barber.findFirst({
        where: {
          id: must(input.barberId, 'profissional escolhido'),
          barbershopId: input.barbershopId,
          isActive: true,
          ...BOOKABLE_STAFF,
        },
      });
      if (!barber) throw new NotFoundException('Profissional não encontrado');
      candidates = [barber];
    } else {
      candidates = await this.publicCandidatesByLoad(input.barbershopId, input.startAt);
    }

    // Quem pode atender nesse horário (expediente, intervalo, período do
    // vínculo e agenda livre). Checagem rápida antes de criar o cliente — a
    // definitiva é dentro da transação, sob a trava da agenda
    let startAt!: Date;
    let endAt!: Date;
    const free: number[] = [];
    let lastError: unknown = null;
    let refusedNewClient = false;
    for (const c of candidates) {
      if (!(await this.professionalAcceptsNewBooking(c.id, returningCustomer?.id ?? null))) {
        refusedNewClient = true;
        if (!auto) {
          throw new BadRequestException('Este profissional não está aceitando clientes novos');
        }
        continue;
      }
      try {
        const slot = await this.ensurePublicSlot(barbershop, c.id, durationMinutes, input.startAt);
        await this.ensureBarberAvailable(input.barbershopId, c.id, slot.startAt, slot.endAt);
        startAt = slot.startAt;
        endAt = slot.endAt;
        free.push(c.id);
        if (!auto) break;
      } catch (err) {
        // Profissional escolhido: o motivo vai pro cliente; no automático, tenta o próximo
        if (!auto || !(err instanceof BadRequestException)) throw err;
        lastError = err;
      }
    }
    if (free.length === 0) {
      if (refusedNewClient && !lastError) {
        throw new BadRequestException('Não há profissional aceitando clientes novos neste horário');
      }
      throw lastError ?? new BadRequestException('Esse horário não está mais disponível');
    }

    const networkId = barbershop.networkId;
    const typedEmail = input.customerEmail?.trim() || null;
    // A mesma pessoa digitando o telefone com outra formatação não vira outra ficha
    const [existingId] = await this.customerIdsByPhone(networkId, input.customerPhone);
    let customer =
      existingId != null
        ? await this.prisma.customer.findUnique({ where: { id: existingId } })
        : null;
    if (!customer) {
      customer = await this.prisma.customer.create({
        data: {
          networkId,
          name: input.customerName,
          // Grava no formato internacional quando dá (o WhatsApp precisa dele)
          phone: normalizePhoneToE164(input.customerPhone) ?? input.customerPhone.trim(),
          email: typedEmail,
          clientAccountId: input.clientAccountId ?? null,
        },
      });

      // Registra a indicação (se veio um ?ref= válido) só na criação — cliente
      // já existente sendo reconhecido de novo não conta indicação retroativa.
      // Falha silenciosa em código inválido/de outra rede/auto-indicação: não
      // vale travar o agendamento por causa de um link de indicação quebrado.
      if (input.referralCode) {
        const code = input.referralCode.trim().toUpperCase();
        const referrer = code
          ? await this.prisma.customer.findFirst({
              where: { referralCode: code, networkId, deletedAt: null },
            })
          : null;
        if (referrer && referrer.id !== customer.id) {
          if (referrer) {
            await this.prisma.customerReferral.create({
              data: { networkId, referrerId: referrer.id, referredId: customer.id },
            });
          }
        }
      }
    }
    // Ficha que já existia (achada pelo telefone digitado) NÃO é ligada à
    // conta logada: o telefone não é confirmado, e ligar deixava qualquer um
    // ver o histórico de outra pessoa agendando com o telefone dela. A ficha
    // entra na conta quando o e-mail dela bate com o e-mail confirmado.
    // O e-mail digitado fica só neste horário (contactEmail), sem preencher
    // o da ficha: o telefone não é confirmado, e o e-mail na ficha a ligava à
    // conta de quem digitou quando ela confirmasse esse e-mail (item 250).

    const bookingCustomerId = customer.id;
    // Recusa cedo (o "qualquer profissional" não tenta o próximo barbeiro
    // com o mesmo erro). A trava de verdade é dentro da transação.
    await this.assertPublicCustomerCanBook(
      this.prisma,
      networkId,
      input.customerPhone,
      input.clientAccountId,
      startAt,
      endAt,
    );
    // Primeira vez no negócio: nenhum agendamento anterior na rede que não
    // tenha sido cancelado (ficha nova ou ficha que nunca veio)
    const firstVisit =
      (await this.prisma.appointment.count({
        where: {
          customerId: bookingCustomerId,
          barbershop: { networkId },
          status: { not: 'CANCELLED' },
        },
      })) === 0;
    const deposits = services.filter((sv) => sv.depositAmount != null);
    const depositAmount = deposits.length
      ? deposits.reduce((sum, sv) => sum.add(sv.depositAmount ?? 0), new Decimal(0))
      : null;
    // Sinal online: o horário fica reservado (aguardando pagamento) por
    // alguns minutos; sem pagar, é liberado (ver DepositPaymentService)
    const payOnline = barbershop.onlineDeposit && depositAmount != null && depositAmount.gt(0);
    const book = (barberId: number) =>
      this.prisma.$transaction(async (tx) => {
        const phoneKey = phoneDigitVariants(input.customerPhone).sort().join('|');
        if (phoneKey) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`public-customer:${networkId}:${phoneKey}`}))`;
        }
        await this.assertPublicCustomerCanBook(
          tx,
          networkId,
          input.customerPhone,
          input.clientAccountId,
          startAt,
          endAt,
        );
        await this.lockSchedule(tx, barberId);
        await this.ensureBarberAvailable(
          input.barbershopId,
          barberId,
          startAt,
          endAt,
          undefined,
          tx,
        );
        const appointment = await tx.appointment.create({
          data: {
            barbershopId: input.barbershopId,
            customerId: bookingCustomerId,
            barberId,
            startAt,
            endAt,
            status: payOnline ? 'PENDING_PAYMENT' : 'CONFIRMED',
            holdExpiresAt: payOnline ? new Date(Date.now() + DEPOSIT_HOLD_MINUTES * 60_000) : null,
            source: 'ONLINE',
            contactEmail: typedEmail,
            bookingChannel: bookingChannel(input.channel),
            firstVisit,
            notes: input.notes,
            depositAmount,
          },
        });
        await tx.appointmentService.createMany({
          data: services.map((sv) => ({
            appointmentId: appointment.id,
            serviceId: sv.id,
            unitPrice: sv.price,
          })),
        });
        return tx.appointment.findUnique({
          where: { id: appointment.id },
          include: { barbershop: true, barber: true, services: { include: { service: true } } },
        });
      });
    // No automático, se outra pessoa pegou o horário do escolhido nesse meio
    // tempo, vai pro próximo livre
    let created: Awaited<ReturnType<typeof book>> | null = null;
    for (const barberId of free) {
      try {
        created = await book(barberId);
        break;
      } catch (err) {
        if (customerBookingRefusal(err)) throw err;
        if (!auto || !(err instanceof BadRequestException) || barberId === free[free.length - 1]) {
          throw err;
        }
      }
    }

    // Confirmação por e-mail com o link pra cancelar/remarcar (best-effort:
    // o horário já está marcado, e-mail fora do ar não desfaz nada)
    // Aguardando o sinal: a confirmação sai quando o pagamento for aprovado
    const confirmationEmail = appointmentContactEmail({ contactEmail: typedEmail, customer });
    if (created && confirmationEmail && created.status === 'CONFIRMED') {
      const createdId = created.id;
      this.sendAppointmentEmail(createdId, 'appointment_confirmation', confirmationEmail).catch(
        (err) => this.logger.error(`Erro ao enviar confirmação do agendamento #${createdId}:`, err),
      );
    }
    return created;
  }

  /**
   * Confirmação ou aviso de horário remarcado, com o link "gerenciar
   * agendamento" (cancelar/remarcar sem login). Vai pela fila de e-mail.
   */
  /** Confirmação depois que o sinal online é pago */
  notifyAppointmentConfirmed(appointmentId: number, to: string) {
    return this.sendAppointmentEmail(appointmentId, 'appointment_confirmation', to);
  }

  /** Cancelamento pela unidade (ex.: fechamento no dia), com o motivo no e-mail */
  notifyAppointmentCancelled(
    appointmentId: number,
    to: string,
    reason?: string | null,
    seriesDates?: string[],
    /** Série: todos os horários cancelados saem do calendário do cliente */
    seriesAppointmentIds?: number[],
  ) {
    return this.sendAppointmentEmail(
      appointmentId,
      'appointment_cancelled',
      to,
      reason,
      seriesDates,
      seriesAppointmentIds,
    );
  }

  /** Série recorrente: uma confirmação só, com todas as datas (e um evento por data no convite) */
  notifySeriesConfirmed(
    firstAppointmentId: number,
    to: string,
    seriesDates: string[],
    seriesAppointmentIds?: number[],
  ) {
    return this.sendAppointmentEmail(
      firstAppointmentId,
      'appointment_confirmation',
      to,
      null,
      seriesDates,
      seriesAppointmentIds,
    );
  }

  private async sendAppointmentEmail(
    appointmentId: number,
    template: 'appointment_confirmation' | 'appointment_rescheduled' | 'appointment_cancelled',
    to: string,
    reason?: string | null,
    /** Datas da série recorrente (já formatadas), listadas no e-mail */
    seriesDates?: string[],
    /** Horários da série: todos vão no convite de calendário */
    seriesAppointmentIds?: number[],
  ) {
    const include = {
      customer: true,
      barber: true,
      barbershop: { include: { network: true } },
      services: { include: { service: true } },
    } as const;
    const appt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include,
    });
    if (!appt) return;
    const inviteAppointments = seriesAppointmentIds?.length
      ? await this.prisma.appointment.findMany({
          where: { id: { in: seriesAppointmentIds }, barbershopId: appt.barbershopId },
          include,
          orderBy: { startAt: 'asc' },
        })
      : [appt];
    const shop = appt.barbershop;
    // Cliente não tem idioma salvo: língua do país da unidade
    const lang = langForCountry(shop.country);
    const serviceNames =
      appt.services
        .map((s) => s.service?.name)
        .filter(Boolean)
        .join(', ') || '-';
    const subjects = {
      appointment_confirmation: {
        pt: `Horário confirmado em ${shop.name}`,
        en: `Appointment confirmed at ${shop.name}`,
        es: `Cita confirmada en ${shop.name}`,
      },
      appointment_rescheduled: {
        pt: `Horário remarcado em ${shop.name}`,
        en: `Appointment rescheduled at ${shop.name}`,
        es: `Cita reprogramada en ${shop.name}`,
      },
      appointment_cancelled: {
        pt: `Horário cancelado em ${shop.name}`,
        en: `Appointment cancelled at ${shop.name}`,
        es: `Cita cancelada en ${shop.name}`,
      },
    };
    await this.notificationQueue.email(
      {
        kind: 'customer',
        loggedAgainstUserId: shop.ownerUserId ?? 0,
        template,
        context: {
          CustomerName: appt.customer.name,
          BarbershopName: shop.name,
          BarbershopAddress: `${shop.address}, ${shop.city} - ${shop.state}`,
          BarbershopPhone: shop.phone,
          BarberName: appt.barber.name,
          ServiceNames: serviceNames,
          AppointmentDate: appt.startAt.toLocaleDateString(LOCALE[lang], {
            timeZone: shop.timezone,
          }),
          AppointmentTime: appt.startAt.toLocaleTimeString(LOCALE[lang], {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: shop.timezone,
          }),
          CancellationWindowHours: shop.network.lateCancellationWindowHours,
          ManageURL: appointmentManageUrl(appt.id, appt.linkVersion),
          // "Adicionar à agenda" (Google, Outlook, .ics pro Apple e outros)
          ...appointmentCalendarLinks(appt, createAppointmentToken(appt.id, appt.linkVersion)),
          BookURL: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/u/${shop.slug}`,
          Reason: reason || null,
          SeriesDates: seriesDates?.length ? seriesDates : null,
          Year: new Date().getFullYear(),
        },
        subject: subjects[template],
        lang,
        meta: template.replace('_', '-'),
        to,
        // Convite de calendário: o Gmail (e os outros) mostram o evento com o
        // nome do serviço e põem na agenda; no cancelamento, apagam
        attachments: [
          appointmentInvite(
            inviteAppointments,
            { name: appt.customer.name, email: to },
            { cancelled: template === 'appointment_cancelled' },
          ),
        ],
      },
      // Uma confirmação por agendamento; remarcação, uma por novo horário
      template === 'appointment_confirmation'
        ? `appointment-confirmation-${appt.id}`
        : template === 'appointment_cancelled'
        ? // A cada cancelamento (cancelado, reativado e cancelado de novo no
          // mesmo dia mandava só o primeiro: a fila guarda o id por 24 h)
          `appointment-cancelled-${appt.id}-${appt.updatedAt.getTime()}`
        : `appointment-rescheduled-${appt.id}-${appt.startAt.getTime()}`,
    );
  }

  // ============ CLIENTE GERENCIA O PRÓPRIO HORÁRIO (link do e-mail) ============
  // Como no Booksy: pelo link da confirmação/lembrete o cliente cancela ou
  // remarca sem login, até a janela da política de cancelamento da rede
  // (Network.lateCancellationWindowHours). Dentro da janela, só falando com
  // a unidade — assim o cliente nunca cai numa taxa de cancelamento tardio
  // por um clique; quem decide é a barbearia.

  private async loadManagedAppointment(token: string) {
    const id = verifyAppointmentToken(token);
    const appt = id
      ? await this.prisma.appointment.findUnique({
          where: { id },
          include: {
            customer: true,
            barber: true,
            barbershop: { include: { network: true } },
            services: { include: { service: true } },
          },
        })
      : null;
    const mode = appt ? appointmentLinkMode(token, 'appointment-manage', appt) : null;
    // Mesma resposta pra link adulterado, vencido ou agendamento apagado
    if (!appt || !mode) {
      throw new NotFoundException('Link inválido ou agendamento não encontrado');
    }
    const readOnly = mode === 'previous';
    const windowHours = appt.barbershop.network.lateCancellationWindowHours;
    const policyDeadline = new Date(appt.startAt.getTime() - windowHours * 3600000);
    // Prazo de arrependimento: logo depois de agendar, desfazer pelo link vale
    // sempre (até o horário). Antes quem marcava perto do horário já abria o
    // link com "o prazo passou"
    const graceEnd = Math.min(
      appt.createdAt.getTime() + BOOKING_GRACE_MINUTES * 60_000,
      appt.startAt.getTime(),
    );
    const changeDeadline = new Date(Math.max(policyDeadline.getTime(), graceEnd));
    const canChange = !readOnly && appt.status === 'CONFIRMED' && new Date() < changeDeadline;
    return { appt, windowHours, changeDeadline, canChange, readOnly };
  }

  private ensureChangeable(loaded: {
    canChange: boolean;
    readOnly: boolean;
    appt: { status: string };
  }) {
    if (loaded.readOnly) {
      throw new BadRequestException('Este link é só para consulta.');
    }
    if (loaded.canChange) return;
    if (loaded.appt.status === 'CANCELLED') {
      throw new BadRequestException('Este agendamento já foi cancelado');
    }
    if (loaded.appt.status !== 'CONFIRMED') {
      throw new BadRequestException('Este agendamento não pode mais ser alterado');
    }
    throw new BadRequestException(
      'O prazo para cancelar ou remarcar pelo link já passou. Fale com o estabelecimento.',
    );
  }

  async getManagedAppointment(token: string) {
    const { appt, windowHours, changeDeadline, canChange, readOnly } =
      await this.loadManagedAppointment(token);
    // Vários serviços no mesmo horário: nomes juntos, preço somado
    const services = appt.services.filter((s) => s.service);
    const shop = appt.barbershop;
    return {
      id: appt.id,
      status: appt.status,
      startAt: appt.startAt.toISOString(),
      endAt: appt.endAt.toISOString(),
      canChange,
      readOnly,
      changeDeadline: changeDeadline.toISOString(),
      cancellationWindowHours: windowHours,
      // Só o primeiro nome: a ficha é achada pelo telefone (não confirmado) e
      // quem agenda com o telefone de outra pessoa via o nome completo dela
      customerName: appt.customer.name.trim().split(/\s+/)[0] ?? '',
      barbershopId: shop.id,
      barbershopName: shop.name,
      barbershopSlug: shop.slug,
      barbershopPhone: shop.phone,
      barbershopAddress: `${shop.address}, ${shop.city} - ${shop.state}`,
      timezone: shop.timezone,
      barberId: appt.barberId,
      barberName: appt.barber.name,
      serviceId: services[0]?.service?.id ?? null,
      serviceIds: services.map((s) => s.service.id),
      serviceName: services.map((s) => s.service.name).join(' + '),
      price: services.reduce((sum, s) => sum + Number(s.unitPrice) * (s.quantity ?? 1), 0),
      currency: shop.currency,
      depositAmount: appt.depositAmount != null ? Number(appt.depositAmount) : null,
      depositPaid: appt.depositPaid,
      depositRefunded: appt.depositRefundedAt != null,
      holdExpiresAt: appt.holdExpiresAt?.toISOString() ?? null,
    };
  }

  /**
   * Próximos horários do cliente logado (fichas ligadas à conta pelo e-mail
   * confirmado), com o mesmo link de gerenciar do e-mail — remarcar e
   * cancelar direto da conta, como no Booksy.
   */
  async getClientUpcomingAppointments(clientAccountId: number) {
    const appts = await this.prisma.appointment.findMany({
      where: {
        customer: { clientAccountId },
        status: { in: ['CONFIRMED', 'IN_PROGRESS'] },
        endAt: { gte: new Date() },
      },
      select: { id: true, linkVersion: true },
      orderBy: { startAt: 'asc' },
      take: 20,
    });
    return Promise.all(
      appts.map(async (a) => {
        // Versão atual: um horário cancelado e reativado pela equipe tem versão > 0
        const token = createAppointmentToken(a.id, a.linkVersion);
        return { ...(await this.getManagedAppointment(token)), manageToken: token };
      }),
    );
  }

  async cancelManagedAppointment(token: string) {
    const loaded = await this.loadManagedAppointment(token);
    this.ensureChangeable(loaded);
    const { appt } = loaded;
    // Cancelar pelo link continua liberado mesmo com o cliente bloqueado.
    // Condicional no status: dois cliques não cancelam duas vezes.
    const updated = await this.prisma.appointment.updateMany({
      where: { id: appt.id, status: 'CONFIRMED' },
      data: { status: 'CANCELLED' },
    });
    if (updated.count === 0) {
      throw new BadRequestException('Este agendamento não pode mais ser alterado');
    }
    this.checkWaitlistOnCancellation(appt.barbershopId, appt).catch((err) =>
      this.logger.error(`Erro ao verificar lista de espera do agendamento #${appt.id}:`, err),
    );
    return { id: appt.id, barbershopId: appt.barbershopId };
  }

  async rescheduleManagedAppointment(token: string, startAtInput: string) {
    const loaded = await this.loadManagedAppointment(token);
    this.ensureChangeable(loaded);
    const { appt } = loaded;
    await this.ensureNotBlocked(appt.barbershop.networkId, {
      customerPhone: appt.customer?.phone,
      customerEmail: appt.customer?.email,
      clientAccountId: appt.customer?.clientAccountId,
    });
    await this.ensureNotPlatformSuspended({
      customerPhone: appt.customer?.phone,
      customerEmail: appt.customer?.email,
      clientAccountId: appt.customer?.clientAccountId,
    });
    const service = appt.services[0]?.service;
    if (!service)
      throw new BadRequestException('Este agendamento não pode ser remarcado pelo link');
    // O profissional precisa continuar atendendo pela página pública
    const barber = await this.prisma.barber.findFirst({
      where: { id: appt.barberId, isActive: true, ...BOOKABLE_STAFF },
      select: { id: true },
    });
    if (!barber) {
      throw new BadRequestException(
        'Este profissional não está mais disponível. Fale com o estabelecimento.',
      );
    }
    const durationMs = appt.endAt.getTime() - appt.startAt.getTime();
    const { startAt } = await this.ensurePublicSlot(
      appt.barbershop,
      appt.barberId,
      Math.round(durationMs / 60000),
      startAtInput,
    );
    const endAt = new Date(startAt.getTime() + durationMs);
    if (startAt.getTime() === appt.startAt.getTime()) {
      throw new BadRequestException('Escolha um horário diferente do atual');
    }

    await this.prisma.$transaction(async (tx) => {
      await this.lockSchedule(tx, appt.barberId, appt.resourceId ?? undefined);
      await this.ensureBarberAvailable(
        appt.barbershopId,
        appt.barberId,
        startAt,
        endAt,
        appt.id,
        tx,
      );
      if (appt.resourceId) {
        await this.ensureResourceAvailable(
          appt.barbershopId,
          appt.resourceId,
          startAt,
          endAt,
          appt.id,
          tx,
        );
      }
      const moved = await tx.appointment.updateMany({
        where: { id: appt.id, status: 'CONFIRMED', startAt: appt.startAt },
        // Dentro de 24 h o e-mail de remarcação já avisa; mais longe, o lembrete volta
        data: { startAt, endAt, reminderSentAt: reminderSentAtAfterMove(startAt) },
      });
      if (moved.count === 0) {
        throw new BadRequestException(
          'Este agendamento mudou enquanto você remarcava. Abra o link de novo.',
        );
      }
    });

    // Horário antigo ficou livre: pode ser a vaga de alguém da lista de espera
    this.checkWaitlistOnCancellation(appt.barbershopId, appt).catch((err) =>
      this.logger.error(`Erro ao verificar lista de espera do agendamento #${appt.id}:`, err),
    );
    const to = appointmentContactEmail(appt);
    if (to) {
      this.sendAppointmentEmail(appt.id, 'appointment_rescheduled', to).catch((err) =>
        this.logger.error(`Erro ao avisar remarcação do agendamento #${appt.id}:`, err),
      );
    }
    return { id: appt.id, barbershopId: appt.barbershopId, previousStartAt: appt.startAt };
  }

  // ============ BUSCA PÚBLICA (marketplace) ============

  // Distinct categories vêm direto dos serviços cadastrados (BarbershopService.category
  // é texto livre hoje — sem uma taxonomia própria ainda) para alimentar o filtro
  // de busca sem precisar de uma lista hardcoded no front.
  async getPublicServiceCategories(): Promise<TreatmentCategory[]> {
    const rows = await this.prisma.barbershopService.findMany({
      where: { isActive: true, barbershop: { isActive: true, ...ownerAcceptsPublic } },
      select: { category: true },
      distinct: ['category'],
    });
    return rows.map((r) => r.category).sort();
  }

  // Slugifica um nome de cidade pra comparação — remove acento, baixa a caixa,
  // troca não-alfanumérico por hífen. Usado pras páginas de SEO categoria×cidade
  // (/search/:categoria/:cidade): o slug da URL é comparado contra a cidade
  // cadastrada slugificada, em vez de "contains" em texto livre, porque o slug
  // vem sem acento (ex: "sao-jose-dos-campos") e não bateria com "São José dos
  // Campos" num contains case-insensitive comum (Postgres não ignora acento).
  slugifyCity(city: string): string {
    return city
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  async getPublicCities(): Promise<string[]> {
    const rows = await this.prisma.barbershop.findMany({
      where: { isActive: true, ...ownerAcceptsPublic },
      select: { city: true },
      distinct: ['city'],
    });
    return rows.map((r) => r.city).sort();
  }

  async searchPublicBarbershops(input: PublicSearchInput & { businessType?: string }) {
    const AND: Prisma.BarbershopWhereInput[] = [ownerAcceptsPublic];
    if (input.query) {
      AND.push({
        OR: [
          { name: { contains: input.query, mode: 'insensitive' } },
          { city: { contains: input.query, mode: 'insensitive' } },
          {
            services: {
              some: { isActive: true, name: { contains: input.query, mode: 'insensitive' } },
            },
          },
        ],
      });
    }
    if (input.city) AND.push({ city: { contains: input.city, mode: 'insensitive' } });
    if (input.businessType) AND.push({ businessType: this.parseBusinessType(input.businessType) });
    if (input.category) {
      AND.push({ services: { some: { isActive: true, category: input.category } } });
    }
    // Com um ponto: só o que está no raio (o retângulo corta no banco, pelo
    // índice de latitude/longitude; a distância exata sai em memória)
    const point =
      input.lat != null && input.lng != null ? { lat: input.lat, lng: input.lng } : null;
    const radiusKm = clampRadius(input.radiusKm);
    const box = point ? boundingBox(point.lat, point.lng, radiusKm) : null;
    if (box) {
      AND.push({ latitude: { gte: box.minLat, lte: box.maxLat } });
      if (box.minLng >= -180 && box.maxLng <= 180) {
        AND.push({ longitude: { gte: box.minLng, lte: box.maxLng } });
      } else {
        AND.push({ longitude: { not: null } });
      }
    }

    const now = new Date();
    // Fase 1: só o que filtra e ordena, de todos os candidatos (sem cortar
    // antes de ordenar: com um teto alto, a mais perto ou a mais bem avaliada
    // não fica de fora numa cidade com muitas unidades)
    const closureWhere = { date: { in: this.nearDateKeys(now) } };
    const closureSelect = { date: true, openTime: true, closeTime: true } as const;
    const candidatesAll = await this.prisma.barbershop.findMany({
      // Fora da vitrine pela moderação: não aparece na busca
      where: { isActive: true, searchHiddenAt: null, ...(AND.length ? { AND } : {}) },
      select: {
        id: true,
        name: true,
        city: true,
        latitude: true,
        longitude: true,
        featuredUntil: true,
        ...(input.openNow
          ? {
              businessHours: true,
              timezone: true,
              closures: { where: closureWhere, select: closureSelect },
            }
          : {}),
      },
      orderBy: { id: 'asc' },
      take: SEARCH_CANDIDATE_LIMIT,
    });

    const candidates = candidatesAll.filter(
      (b) =>
        (!input.citySlug || this.slugifyCity(b.city) === input.citySlug) &&
        (!box || (b.longitude != null && lngInBox(b.longitude, box))),
    );
    const candidateIds = candidates.map((b) => b.id);
    const [ratings, offers] = await Promise.all([
      this.getReviewSummaries(candidateIds),
      this.getServiceOffers(candidateIds),
    ]);

    const ranked = candidates
      .map((b) => {
        const offer = offers.get(b.id);
        const distanceKm =
          point && b.latitude != null && b.longitude != null
            ? Math.round(haversineKm(point.lat, point.lng, b.latitude, b.longitude) * 10) / 10
            : null;
        return {
          id: b.id,
          name: b.name,
          categories: offer?.categories ?? [],
          distanceKm,
          // Posição da unidade (fora do GraphQL): o cache da busca refaz a
          // distância com o ponto exato de cada pessoa
          points: b.latitude != null && b.longitude != null ? [[b.latitude, b.longitude]] : [],
          minPrice: offer?.minPrice ?? null,
          isFeatured: b.featuredUntil != null && b.featuredUntil > now,
          openNow: input.openNow ? isOpenAt(b as Parameters<typeof isOpenAt>[0], now) : false,
          ...(ratings.get(b.id) ?? { averageRating: null, reviewCount: 0 }),
        };
      })
      .filter(
        (r) =>
          (!point || (r.distanceKm != null && r.distanceKm <= radiusKm)) &&
          (input.minRating == null || (r.averageRating ?? 0) >= input.minRating) &&
          (input.maxPrice == null || (r.minPrice != null && r.minPrice <= input.maxPrice)) &&
          (!input.openNow || r.openNow),
      );
    const limited = rankResults(ranked, input.sort ?? 'relevance', !!point).slice(
      0,
      input.limit ?? 30,
    );

    // Fase 2: o que aparece no card, só das que vão ser mostradas
    const details = new Map(
      (
        await this.prisma.barbershop.findMany({
          where: { id: { in: limited.map((r) => r.id) } },
          select: {
            id: true,
            slug: true,
            businessType: true,
            city: true,
            state: true,
            address: true,
            photoKey: true,
            logoHiddenAt: true,
            currency: true,
            businessHours: true,
            timezone: true,
            network: { select: { name: true } },
            closures: { where: closureWhere, select: closureSelect },
          },
        })
      ).map((d) => [d.id, d]),
    );
    // Unidade apagada entre as duas consultas (exclusão de conta, por
    // exemplo): sai do resultado em vez de derrubar a busca de todo mundo
    const shown = limited.filter((r) => details.has(r.id));
    return Promise.all(
      shown.map(async (r) => {
        const d = must(details.get(r.id), `unidade ${r.id}`);
        return {
          ...r,
          slug: d.slug,
          businessType: d.businessType,
          city: d.city,
          state: d.state,
          address: d.address,
          networkName: d.network?.name ?? r.name,
          currency: d.currency,
          openNow: isOpenAt(d, now),
          // Logo ocultado pela moderação não aparece no card
          imageUrl:
            d.photoKey && !d.logoHiddenAt ? await this.s3Service.getDownloadUrl(d.photoKey) : null,
        };
      }),
    );
  }

  /** Hoje e os vizinhos (UTC ±1 dia): cobre o "hoje" de qualquer fuso */
  private nearDateKeys(now: Date): string[] {
    return [-1, 0, 1].map((d) =>
      new Date(now.getTime() + d * 86_400_000).toISOString().slice(0, 10),
    );
  }

  /**
   * Busca de profissionais: só quem deixou o perfil público (/p/:slug).
   * Nota, foto e unidades seguem as escolhas de privacidade dele; quem
   * esconde as unidades não entra na busca por distância (não revela onde
   * atende) e aparece pelas cidades que escolheu mostrar.
   */
  async searchPublicProfessionals(input: PublicSearchInput) {
    const point =
      input.lat != null && input.lng != null ? { lat: input.lat, lng: input.lng } : null;
    const radiusKm = clampRadius(input.radiusKm);
    const now = new Date();
    const activeBarber: Prisma.BarberWhereInput = {
      isActive: true,
      barbershop: { isActive: true, ...ownerAcceptsPublic },
      AND: [
        { OR: [{ accessStartsAt: null }, { accessStartsAt: { lte: now } }] },
        { OR: [{ accessEndsAt: null }, { accessEndsAt: { gte: now } }] },
      ],
    };
    const AND: Prisma.ProfessionalWhereInput[] = [];
    if (input.query) {
      AND.push({
        OR: [
          { user: { fullName: { contains: input.query, mode: 'insensitive' } } },
          { cities: { has: input.query } },
        ],
      });
    }
    if (input.category) {
      AND.push({
        OR: [
          { specialties: { has: input.category } },
          {
            barbers: {
              some: {
                ...activeBarber,
                barbershop: {
                  isActive: true,
                  ...ownerAcceptsPublic,
                  services: { some: { isActive: true, category: input.category } },
                },
              },
            },
          },
        ],
      });
    }
    // Com um ponto: só quem mostra as unidades e tem uma no retângulo do
    // raio (a distância exata sai em memória, como na busca de unidades)
    if (point) {
      const box = boundingBox(point.lat, point.lng, radiusKm);
      AND.push({
        showLocations: true,
        barbers: {
          some: {
            ...activeBarber,
            barbershop: {
              isActive: true,
              ...ownerAcceptsPublic,
              latitude: { gte: box.minLat, lte: box.maxLat },
              ...(box.minLng >= -180 && box.maxLng <= 180
                ? { longitude: { gte: box.minLng, lte: box.maxLng } }
                : { longitude: { not: null } }),
            },
          },
        },
      });
    }
    const professionals = await this.prisma.professional.findMany({
      where: {
        visibility: 'public',
        slug: { not: null },
        suspendedAt: null,
        user: { isActive: true },
        ...(AND.length ? { AND } : {}),
      },
      include: {
        user: { select: { fullName: true, photoKey: true, identityVerifiedAt: true } },
        barbers: {
          where: activeBarber,
          select: {
            specialization: true,
            barbershop: {
              select: {
                name: true,
                slug: true,
                city: true,
                latitude: true,
                longitude: true,
                id: true,
                currency: true,
              },
            },
          },
        },
      },
      take: 500,
    });

    const ratings = new Map(
      (
        await this.prisma.professionalReview.groupBy({
          by: ['professionalId'],
          where: { professionalId: { in: professionals.map((p) => p.id) }, hiddenAt: null },
          _avg: { rating: true },
          _count: { _all: true },
        })
      ).map((g) => [
        g.professionalId,
        {
          averageRating: g._avg.rating != null ? Math.round(g._avg.rating * 10) / 10 : null,
          reviewCount: g._count._all,
        },
      ]),
    );
    const offers = await this.getServiceOffers([
      ...new Set(professionals.flatMap((p) => p.barbers.map((b) => b.barbershop.id))),
    ]);
    const citySlugOf = (c: string) => this.slugifyCity(c);
    const wantedCity = input.citySlug ?? (input.city ? citySlugOf(input.city) : null);

    const results = professionals
      .map((p) => {
        const shops = p.showLocations ? p.barbers.map((b) => b.barbershop) : [];
        const cities = [...new Set([...p.cities, ...shops.map((s) => s.city)])];
        const distances = point
          ? shops.flatMap((s) =>
              s.latitude != null && s.longitude != null
                ? [haversineKm(point.lat, point.lng, s.latitude, s.longitude)]
                : [],
            )
          : [];
        const prices = p.barbers.flatMap((b) => {
          const min = offers.get(b.barbershop.id)?.minPrice;
          return min != null ? [min] : [];
        });
        const rating = p.showRating
          ? ratings.get(p.id) ?? { averageRating: null, reviewCount: 0 }
          : { averageRating: null, reviewCount: 0 };
        return {
          slug: must(p.slug, 'página do profissional'),
          name: p.user.fullName,
          photoKey: p.showPhoto ? p.user.photoKey : null,
          specialization: p.barbers.find((b) => b.specialization)?.specialization ?? null,
          specialties: p.specialties,
          cities,
          shops: shops.map((s) => ({ name: s.name, slug: s.slug })),
          acceptingClients: p.acceptingClients,
          // Atende a domicílio só com a identidade verificada
          homeService: homeServiceEnabled() && p.offersHomeService && !!p.user.identityVerifiedAt,
          distanceKm: distances.length ? Math.round(Math.min(...distances) * 10) / 10 : null,
          // Posições das unidades mostradas (fora do GraphQL), pro cache da busca
          points: shops.flatMap((s) =>
            s.latitude != null && s.longitude != null ? [[s.latitude, s.longitude]] : [],
          ),
          minPrice: prices.length ? Math.min(...prices) : null,
          currency: p.barbers[0]?.barbershop.currency ?? null,
          isFeatured: p.featuredUntil != null && p.featuredUntil > now,
          ...rating,
        };
      })
      .filter(
        (r) =>
          (!wantedCity || r.cities.some((c) => citySlugOf(c) === wantedCity)) &&
          (!point || (r.distanceKm != null && r.distanceKm <= radiusKm)) &&
          (input.minRating == null || (r.averageRating ?? 0) >= input.minRating) &&
          (input.maxPrice == null || (r.minPrice != null && r.minPrice <= input.maxPrice)),
      );

    const limited = rankResults(results, input.sort ?? 'relevance', !!point).slice(
      0,
      input.limit ?? 30,
    );
    return Promise.all(
      limited.map(async ({ photoKey, ...r }) => ({
        ...r,
        photoUrl: photoKey ? await this.s3Service.getDownloadUrl(photoKey) : null,
      })),
    );
  }

  // ============ ADMIN: POSICIONAMENTO "DESTAQUE" ============

  async getAdminBarbershops(query?: string) {
    return this.prisma.barbershop.findMany({
      where: query
        ? {
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { city: { contains: query, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: { name: 'asc' },
      take: 100,
    });
  }

  /** Profissionais com página (pública ou só na plataforma), destacados primeiro */
  async getAdminProfessionals(query?: string) {
    const q = query?.trim();
    const rows = await this.prisma.professional.findMany({
      where: {
        slug: { not: null },
        ...(q
          ? {
              OR: [
                { user: { fullName: { contains: q, mode: 'insensitive' } } },
                { slug: { contains: q, mode: 'insensitive' } },
                { cities: { has: q } },
              ],
            }
          : {}),
      },
      include: { user: { select: { fullName: true } } },
      orderBy: [{ featuredUntil: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
      take: 100,
    });
    return rows.map((p) => this.adminProfessional(p));
  }

  async setProfessionalFeatured(professionalId: number, featuredUntil: string | null) {
    const until = featuredUntil ? new Date(featuredUntil) : null;
    if (until && isNaN(until.getTime())) throw new BadRequestException('Data inválida');
    const exists = await this.prisma.professional.findUnique({
      where: { id: professionalId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Profissional não encontrado');
    const updated = await this.prisma.professional.update({
      where: { id: professionalId },
      data: { featuredUntil: until },
      include: { user: { select: { fullName: true } } },
    });
    // Destaque muda a ordem e o selo da busca: vale na hora, não em 45 s
    await this.searchCache?.bump();
    return this.adminProfessional(updated);
  }

  private adminProfessional(p: {
    id: number;
    slug: string | null;
    visibility: string;
    cities: string[];
    featuredUntil: Date | null;
    user: { fullName: string };
  }) {
    return {
      id: p.id,
      name: p.user.fullName,
      slug: p.slug,
      visibility: p.visibility,
      cities: p.cities,
      featuredUntil: p.featuredUntil?.toISOString() ?? null,
      isFeatured: p.featuredUntil != null && p.featuredUntil > new Date(),
    };
  }

  async setBarbershopFeatured(barbershopId: number, featuredUntil: string | null) {
    const updated = await this.prisma.barbershop.update({
      where: { id: barbershopId },
      data: { featuredUntil: featuredUntil ? new Date(featuredUntil) : null },
    });
    await this.searchCache?.bump();
    return updated;
  }

  // ============ AVALIAÇÕES ============

  // Só quem teve pelo menos um atendimento CONCLUÍDO nessa unidade pode
  // avaliar — evita review de quem nunca foi cliente de verdade (ex.:
  // concorrente, ou alguém que só olhou a página pública).
  private async ensureVerifiedCustomer(clientAccountId: number, barbershopId: number) {
    const visit = await this.prisma.appointment.findFirst({
      where: { barbershopId, status: 'COMPLETED', customer: { clientAccountId } },
    });
    if (!visit) {
      throw new ForbiddenException(
        'Você só pode avaliar unidades onde já teve um atendimento concluído.',
      );
    }
  }

  private privacyName(fullName: string): string {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length <= 1) return parts[0] ?? '';
    return `${parts[0]} ${parts[parts.length - 1][0]}.`;
  }

  async createOrUpdateReview(
    clientAccountId: number,
    barbershopId: number,
    rating: number,
    comment?: string,
  ) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new BadRequestException('A nota deve ser um número inteiro entre 1 e 5.');
    }
    await this.ensureVerifiedCustomer(clientAccountId, barbershopId);
    // Mesmo limite da avaliação pelo link (sem limite, um texto enorme ia
    // pra página pública da unidade)
    const text = comment?.trim().slice(0, 1000) || null;
    const existing = await this.prisma.review.findUnique({
      where: { barbershopId_clientAccountId: { barbershopId, clientAccountId } },
      select: { comment: true, reply: true },
    });
    // A ocultada pela moderação (mesmo "apagada" pelo cliente) é editada no
    // lugar: continua oculta, sem voltar ao ar por uma linha nova (item 247)
    return this.prisma.review.upsert({
      where: { barbershopId_clientAccountId: { barbershopId, clientAccountId } },
      create: { barbershopId, clientAccountId, rating, comment: text },
      update: { ...reviewEditData(existing, { rating, comment: text }), withdrawnAt: null },
    });
  }

  /**
   * O cliente apaga a própria avaliação. A que a moderação ocultou não sai
   * do banco: some para ele (withdrawnAt) e continua oculta, senão apagar e
   * escrever de novo devolvia o texto ao ar (item 247).
   */
  async deleteReview(clientAccountId: number, barbershopId: number) {
    await this.prisma.review.updateMany({
      where: { barbershopId, clientAccountId, hiddenAt: { not: null } },
      data: { withdrawnAt: new Date() },
    });
    await this.prisma.review.deleteMany({
      where: { barbershopId, clientAccountId, hiddenAt: null },
    });
  }

  async getMyReview(clientAccountId: number, barbershopId: number) {
    const review = await this.prisma.review.findUnique({
      where: { barbershopId_clientAccountId: { barbershopId, clientAccountId } },
    });
    return review?.withdrawnAt ? null : review;
  }

  async canReviewBarbershop(clientAccountId: number, barbershopId: number): Promise<boolean> {
    const visit = await this.prisma.appointment.findFirst({
      where: { barbershopId, status: 'COMPLETED', customer: { clientAccountId } },
    });
    return Boolean(visit);
  }

  async getBarbershopReviews(barbershopId: number) {
    const reviews = await this.prisma.review.findMany({
      // Oculta pela moderação (denúncia aceita) não aparece
      where: { barbershopId, hiddenAt: null },
      include: {
        clientAccount: { select: { name: true } },
        customer: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt.toISOString(),
      // Logado: nome da conta; pelo link do e-mail: nome da ficha
      reviewerName: this.privacyName(r.clientAccount?.name ?? r.customer?.name ?? 'Cliente'),
      // Resposta ocultada pela moderação não aparece (a avaliação continua)
      reply: r.replyHiddenAt ? null : r.reply,
      replyStale: r.replyStale,
      repliedAt: r.replyHiddenAt ? null : r.repliedAt?.toISOString() ?? null,
    }));
  }

  /**
   * Categorias e menor preço dos serviços ativos de cada unidade, agregados
   * no banco: uma linha por unidade em vez de uma por serviço (na busca sem
   * filtro são todas as unidades)
   */
  private async getServiceOffers(
    barbershopIds: number[],
  ): Promise<Map<number, { categories: TreatmentCategory[]; minPrice: number | null }>> {
    if (barbershopIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<
      { barbershopId: number; categories: TreatmentCategory[]; minPrice: Prisma.Decimal | null }[]
    >`
      SELECT "barbershopId",
             array_agg(DISTINCT category::text) AS categories,
             MIN(price) FILTER (WHERE price > 0) AS "minPrice"
      FROM "BarbershopService"
      WHERE "isActive" AND "barbershopId" = ANY(${barbershopIds})
      GROUP BY "barbershopId"`;
    return new Map(
      rows.map((r) => [
        r.barbershopId,
        {
          categories: r.categories,
          minPrice: r.minPrice != null ? Number(r.minPrice) : null,
        },
      ]),
    );
  }

  private async getReviewSummaries(
    barbershopIds: number[],
  ): Promise<Map<number, { averageRating: number | null; reviewCount: number }>> {
    const map = new Map<number, { averageRating: number | null; reviewCount: number }>();
    if (barbershopIds.length === 0) return map;
    const groups = await this.prisma.review.groupBy({
      by: ['barbershopId'],
      where: { barbershopId: { in: barbershopIds }, hiddenAt: null },
      _avg: { rating: true },
      _count: true,
    });
    for (const g of groups) {
      map.set(g.barbershopId, { averageRating: g._avg.rating, reviewCount: g._count });
    }
    return map;
  }

  async getReviewSummary(
    barbershopId: number,
  ): Promise<{ averageRating: number | null; reviewCount: number }> {
    const map = await this.getReviewSummaries([barbershopId]);
    return map.get(barbershopId) ?? { averageRating: null, reviewCount: 0 };
  }

  // ============ CARTÃO-PRESENTE ============
  // Emitido e resgatado manualmente pela equipe — sem cobrança online própria
  // (decisão explícita: não integrar Stripe pra pagamentos de cliente do
  // marketplace agora). O código evita caracteres ambíguos (0/O, 1/I) porque
  // é lido em voz alta / digitado por telefone com frequência.

  private generateGiftCardCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    // Vale dinheiro: gerador criptográfico, não Math.random (previsível)
    for (let i = 0; i < 8; i++) code += chars[randomInt(chars.length)];
    return `GIFT-${code}`;
  }

  async createGiftCard(
    userId: number,
    networkId: number,
    data: {
      initialValue: number;
      purchaserName?: string;
      purchaserPhone?: string;
      purchaserEmail?: string;
      recipientName?: string;
      message?: string;
      expiresAt?: Date;
      barbershopId?: number | null;
      paymentMethod?: string | null;
    },
  ) {
    // Dono da rede vende por qualquer unidade (ou sem unidade); da recepção
    // para cima, só pela unidade onde trabalha (o valor entra no caixa dela)
    const network = await this.prisma.network.findUnique({ where: { id: networkId } });
    if (!network) throw new ForbiddenException('Sem acesso a esta rede');
    if (network.ownerUserId !== userId) {
      if (data.barbershopId == null) {
        throw new ForbiddenException('Escolha a unidade que está vendendo o cartão-presente');
      }
      const shop = await this.ensureBarbershopAccess(userId, data.barbershopId, 'reception');
      if (shop.networkId !== networkId) throw new ForbiddenException('Sem acesso a esta rede');
    }
    if (data.initialValue <= 0) {
      throw new BadRequestException('O valor do cartão-presente deve ser maior que zero');
    }
    if (data.expiresAt && new Date(data.expiresAt).getTime() <= Date.now()) {
      throw new BadRequestException('A validade do cartão-presente não pode ser no passado');
    }
    // A unidade que vendeu: o valor entra no faturamento e no caixa dela
    // (antes o cartão só criava o saldo e o dinheiro não aparecia em lugar nenhum)
    const { barbershopId, paymentMethod, ...card } = data;
    // O vale fica na moeda de quem vendeu (sem unidade, a da rede)
    let currency = network.currency;
    if (barbershopId != null) {
      const shop = await this.prisma.barbershop.findFirst({
        where: { id: barbershopId, networkId },
        select: { id: true, currency: true },
      });
      if (!shop) throw new NotFoundException('Unidade não encontrada nesta rede');
      currency = shop.currency;
    }
    checkMoney('Valor do cartão-presente', data.initialValue, currency);

    let code = this.generateGiftCardCode();
    while (await this.prisma.giftCard.findUnique({ where: { code } })) {
      code = this.generateGiftCardCode();
    }

    return this.prisma.$transaction(async (tx) => {
      let saleId: number | undefined;
      if (barbershopId != null) {
        const sale = await this.recordStandaloneSale(tx, barbershopId, {
          itemType: 'GIFT_CARD',
          amount: card.initialValue,
          notes: `Cartão-presente ${code}`,
          paymentMethod,
        });
        saleId = sale.id;
      }
      return tx.giftCard.create({
        data: {
          networkId,
          code,
          initialValue: new Decimal(card.initialValue),
          remainingValue: new Decimal(card.initialValue),
          purchaserName: card.purchaserName,
          purchaserPhone: card.purchaserPhone,
          purchaserEmail: card.purchaserEmail,
          recipientName: card.recipientName,
          message: card.message,
          expiresAt: card.expiresAt,
          currency,
          saleId,
        },
      });
    });
  }

  /**
   * Dono da rede, ou alguém com o cargo pedido (ou acima) em alguma unidade
   * dela. Cartão-presente vale na rede inteira (item 248).
   */
  private async ensureNetworkRole(userId: number, networkId: number, min: AccessLevel) {
    const network = await this.prisma.network.findUnique({
      where: { id: networkId },
      select: { ownerUserId: true },
    });
    if (!network) throw new ForbiddenException('Sem acesso a esta rede');
    if (network.ownerUserId === userId) return;
    const shops = await this.prisma.barbershop.findMany({
      where: { networkId, closedAt: null, barbers: { some: { userId, ...currentEngagement() } } },
      select: {
        id: true,
        ownerUserId: true,
        closedAt: true,
        network: { select: { ownerUserId: true } },
      },
    });
    for (const shop of shops) {
      const level = await this.accessLevelOf(userId, shop);
      if (level && ACCESS_RANK[level] >= ACCESS_RANK[min]) return;
    }
    throw new ForbiddenException('Sem acesso a esta rede');
  }

  async getGiftCards(userId: number, networkId: number) {
    await this.ensureNetworkRole(userId, networkId, 'manager');
    return this.prisma.giftCard.findMany({ where: { networkId }, orderBy: { createdAt: 'desc' } });
  }

  async setGiftCardActive(
    userId: number,
    networkId: number,
    giftCardId: number,
    isActive: boolean,
  ) {
    await this.ensureNetworkRole(userId, networkId, 'manager');
    const giftCard = await this.prisma.giftCard.findFirst({ where: { id: giftCardId, networkId } });
    if (!giftCard) throw new NotFoundException('Cartão-presente não encontrado');
    return this.prisma.giftCard.update({ where: { id: giftCardId }, data: { isActive } });
  }

  // Confere se um código é válido/utilizável sem gastar saldo — usado tanto
  // pela pré-visualização no checkout quanto pela validação real dentro de
  // createSale (evita duplicar as regras em dois lugares).
  private async validateGiftCard(barbershopId: number, code: string) {
    const barbershop = await this.prisma.barbershop.findUnique({
      where: { id: barbershopId },
      include: { network: { select: { currency: true } } },
    });
    if (!barbershop) throw new NotFoundException('Unidade não encontrada');
    const giftCard = await this.prisma.giftCard.findUnique({
      where: { code: code.trim().toUpperCase() },
    });
    if (!giftCard || giftCard.networkId !== barbershop.networkId) {
      throw new NotFoundException('Cartão-presente não encontrado');
    }
    if (!giftCard.isActive) throw new BadRequestException('Este cartão-presente está inativo');
    // Vendido em outra moeda: 100 reais não viram 100 euros
    if (!sameCurrency(giftCard.currency ?? barbershop.network.currency, barbershop.currency)) {
      throw new BadRequestException(GIFT_CARD_OTHER_CURRENCY_MESSAGE);
    }
    if (giftCard.expiresAt && giftCard.expiresAt < new Date()) {
      throw new BadRequestException('Este cartão-presente expirou');
    }
    if (Number(giftCard.remainingValue) <= 0) {
      throw new BadRequestException('Este cartão-presente não tem saldo restante');
    }
    return giftCard;
  }

  /**
   * Consulta pelo código na hora de cobrar. Quem compra e quem ganha (nome,
   * telefone, e-mail, mensagem) só para gerente e dono: o caixa precisa só do
   * saldo e da validade (item 248).
   */
  async lookupGiftCard(userId: number, barbershopId: number, code: string) {
    const shop = await this.ensureBarbershopAccess(userId, barbershopId);
    const card = await this.validateGiftCard(barbershopId, code);
    if (ACCESS_RANK[shop.accessLevel] >= ACCESS_RANK.manager) return card;
    return {
      ...card,
      purchaserName: null,
      purchaserPhone: null,
      purchaserEmail: null,
      recipientName: null,
      message: null,
    };
  }

  // ============ FIDELIDADE ============

  async getCustomerLoyalty(userId: number, barbershopId: number, customerId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const barbershop = await this.prisma.barbershop.findUnique({
      where: { id: barbershopId },
      include: { network: true },
    });
    if (!barbershop) throw new NotFoundException('Unidade não encontrada');
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, networkId: barbershop.networkId },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado');
    const network = networkMoneyRules(barbershop, barbershop.network);
    const pointValue = network.loyaltyPointValue ?? 0;
    return {
      enabled: network.loyaltyEnabled,
      points: customer.loyaltyPoints,
      pointValue,
      redeemableValue: customer.loyaltyPoints * pointValue,
    };
  }

  // ============ INDICAÇÃO ENTRE CLIENTES ============

  /**
   * Código de indicação da ficha: aleatório, criado na primeira vez que é
   * pedido. Antes era o id do cliente em base 36 ("1", "2", "A"...), fácil
   * de adivinhar e que revelava quantos clientes a rede tinha.
   */
  private async referralCodeOf(customer: { id: number; referralCode: string | null }) {
    if (customer.referralCode) return customer.referralCode;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = Array.from(
        { length: 8 },
        () => REFERRAL_CODE_CHARS[randomInt(REFERRAL_CODE_CHARS.length)],
      ).join('');
      const saved = await this.prisma.customer
        .updateMany({
          where: { id: customer.id, referralCode: null },
          data: { referralCode: code },
        })
        .catch((err: { code?: string }) => {
          if (err?.code === 'P2002') return { count: -1 };
          throw err;
        });
      if (saved.count === 1) return code;
      if (saved.count === 0) {
        const current = await this.prisma.customer.findUnique({
          where: { id: customer.id },
          select: { referralCode: true },
        });
        if (current?.referralCode) return current.referralCode;
      }
    }
    throw new BadRequestException('Não foi possível gerar o código de indicação. Tente de novo.');
  }

  async getCustomerReferralInfo(userId: number, barbershopId: number, customerId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const barbershop = await this.prisma.barbershop.findUnique({
      where: { id: barbershopId },
      include: { network: true },
    });
    if (!barbershop) throw new NotFoundException('Unidade não encontrada');
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, networkId: barbershop.networkId },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado');

    const referralsMade = await this.prisma.customerReferral.findMany({
      where: { referrerId: customerId },
      select: { pointsAwarded: true },
    });

    return {
      referralCode: await this.referralCodeOf(customer),
      referralBonusPoints: barbershop.network.referralBonusPoints,
      referralsCount: referralsMade.length,
      pointsEarnedFromReferrals: referralsMade.reduce((sum, r) => sum + (r.pointsAwarded ?? 0), 0),
    };
  }

  async getBarbershopNoShowFees(userId: number, barbershopId: number) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId);
    // Recepção para cima vê todas; o barbeiro, só as dos atendimentos dele
    const ownBarberId = await this.ownBarberIdIfBarber(userId, barbershop);
    const fees = await this.prisma.noShowFee.findMany({
      where: {
        barbershopId,
        ...(ownBarberId !== null ? { appointment: { barberId: ownBarberId } } : {}),
      },
      include: { customer: true },
      orderBy: { createdAt: 'desc' },
    });
    return fees.map((f) => ({
      id: f.id,
      customerId: f.customerId,
      customerName: f.customer.name,
      amount: Number(f.amount),
      currency: f.currency,
      reason: f.reason,
      status: f.status,
      collectedAt: f.collectedAt?.toISOString(),
      createdAt: f.createdAt.toISOString(),
    }));
  }

  /**
   * Taxa recebida: entra como venda paga no caixa aberto (antes só mudava a
   * situação e o dinheiro sumia do faturamento). Da recepção pra cima.
   */
  async markNoShowFeeCollected(
    userId: number,
    barbershopId: number,
    id: number,
    paymentMethod?: string | null,
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'reception');
    if (!paymentMethod) throw new BadRequestException('Informe a forma de pagamento');
    checkSaleKinds({ paymentMethod });
    const fee = await this.prisma.noShowFee.findFirst({ where: { id, barbershopId } });
    if (!fee) throw new NotFoundException('Taxa não encontrada');
    const openSession = await this.prisma.cashSession.findFirst({
      where: { barbershopId, status: 'OPEN' },
      select: { id: true },
    });
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // Só a pendente (dois cliques não lançam duas vendas)
      const claimed = await tx.noShowFee.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'COLLECTED', collectedAt: now },
      });
      if (claimed.count === 0) throw new BadRequestException('Esta taxa não está pendente');
      const sale = await tx.sale.create({
        data: {
          barbershopId,
          customerId: fee.customerId,
          cashSessionId: openSession?.id,
          saleType: 'NO_SHOW_FEE',
          subtotal: fee.amount,
          total: fee.amount,
          paymentStatus: 'PAID',
          paymentMethod,
          paidAt: now,
        },
      });
      await tx.noShowFee.update({ where: { id }, data: { saleId: sale.id } });
    });
    return true;
  }

  async waiveNoShowFee(userId: number, barbershopId: number, id: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const fee = await this.prisma.noShowFee.findFirst({ where: { id, barbershopId } });
    if (!fee) throw new NotFoundException('Taxa não encontrada');
    // Só a pendente: a já cobrada tem a venda no caixa (apague a venda antes)
    const waived = await this.prisma.noShowFee.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'WAIVED' },
    });
    if (waived.count === 0) throw new BadRequestException(NO_SHOW_FEE_NOT_PENDING_MESSAGE);
    return true;
  }

  async getBarbershopReferrals(userId: number, barbershopId: number) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const referrals = await this.prisma.customerReferral.findMany({
      where: { networkId: barbershop.networkId },
      include: { referrer: true, referred: true },
      orderBy: { createdAt: 'desc' },
    });
    return referrals.map((r) => ({
      id: r.id,
      referrerId: r.referrerId,
      referrerName: r.referrer.name,
      referredId: r.referredId,
      referredName: r.referred.name,
      pointsAwarded: r.pointsAwarded,
      completedAt: r.completedAt?.toISOString(),
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // ============ ASSINATURA RECORRENTE DO CLIENTE ============
  //
  // Ver comentário no schema (model ClientSubscriptionPlan) — cobrança
  // automática mensal via Stripe Subscriptions na conta da própria
  // plataforma (sem Stripe Connect). Métodos "staff" (dono/funcionário,
  // gate por ensureBarbershopAccess/ensureModuleAccess) cuidam da oferta e
  // do relatório de repasse; métodos "client" (clientAccountId, sem
  // ensureBarbershopAccess pois o cliente não é da equipe) cuidam de
  // assinar/cancelar.

  async getSubscriptionPlans(userId: number, barbershopId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const plans = await this.prisma.clientSubscriptionPlan.findMany({
      where: { barbershopId },
      include: { service: true },
      orderBy: { name: 'asc' },
    });
    return plans.map((p) => ({ ...p, serviceName: p.service?.name ?? null }));
  }

  async createSubscriptionPlan(
    userId: number,
    barbershopId: number,
    data: { serviceId: number; name: string; price: number; sessionsPerCycle?: number },
  ) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    checkMoney('Preço', data.price, barbershop.currency);
    checkSessionCount('Sessões por ciclo', data.sessionsPerCycle);
    await this.ensureModuleAccess(barbershopId, 'subscriptions');
    const service = await this.prisma.barbershopService.findFirst({
      where: { id: data.serviceId, barbershopId },
    });
    if (!service) throw new NotFoundException('Serviço não encontrado');

    const product = await this.stripeService.createProduct(
      `${barbershop.name} — ${data.name}`,
      `Assinatura recorrente (${service.name})`,
    );
    const price = await this.stripeService.createPrice(
      product.id,
      toMinorUnits(data.price, barbershop.currency),
      barbershop.currency.toLowerCase(),
      { interval: 'month' },
    );

    const plan = await this.prisma.clientSubscriptionPlan.create({
      data: {
        barbershopId,
        serviceId: data.serviceId,
        name: data.name,
        price: new Decimal(data.price),
        sessionsPerCycle: data.sessionsPerCycle ?? null,
        stripeProductId: product.id,
        stripePriceId: price.id,
      },
      include: { service: true },
    });
    return { ...plan, serviceName: plan.service?.name ?? null };
  }

  async updateSubscriptionPlan(
    userId: number,
    barbershopId: number,
    id: number,
    data: Partial<{
      name: string;
      price: number;
      sessionsPerCycle: number | null;
      isActive: boolean;
    }>,
  ) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const plan = await this.prisma.clientSubscriptionPlan.findFirst({
      where: { id, barbershopId },
    });
    if (!plan) throw new NotFoundException('Plano não encontrado');
    checkMoney('Preço', data.price, barbershop.currency);
    checkSessionCount('Sessões por ciclo', data.sessionsPerCycle);

    let stripePriceId = plan.stripePriceId;
    // Stripe Price é imutável — se o valor mudou, cria um Price novo e
    // aponta o plano pra ele (assinaturas já ativas continuam no Price
    // antigo, o que é o comportamento correto: não muda o valor de quem já
    // assinou). O limite de sessões também fica na assinatura; mudar aqui
    // vale só para quem assinar depois. Vazio (null) é ilimitado.

    if (data.price != null && Number(plan.price) !== data.price && plan.stripeProductId) {
      const newPrice = await this.stripeService.createPrice(
        plan.stripeProductId,
        toMinorUnits(data.price, barbershop.currency),
        barbershop.currency.toLowerCase(),
        { interval: 'month' },
      );
      stripePriceId = newPrice.id;
    }

    const { price, ...rest } = data;
    const updated = await this.prisma.clientSubscriptionPlan.update({
      where: { id },
      data: {
        ...rest,
        price: price != null ? new Decimal(price) : undefined,
        stripePriceId,
      },
      include: { service: true },
    });
    return { ...updated, serviceName: updated.service?.name ?? null };
  }

  async deleteSubscriptionPlan(userId: number, barbershopId: number, id: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const plan = await this.prisma.clientSubscriptionPlan.findFirst({
      where: { id, barbershopId },
    });
    if (!plan) throw new NotFoundException('Plano não encontrado');
    await this.prisma.clientSubscriptionPlan.update({ where: { id }, data: { isActive: false } });
    return true;
  }

  /**
   * Assinaturas ativas do cliente nesta unidade. A ficha da unidade liga pela
   * conta; se ainda não ligou, o e-mail igual encontra a conta do clube.
   */
  async getCustomerSubscriptions(userId: number, barbershopId: number, customerId: number) {
    const shop = await this.ensureBarbershopAccess(userId, barbershopId);
    const accountId = await this.clientAccountIdForCustomer(shop.networkId, customerId);
    if (accountId == null) return [];
    const subs = await this.prisma.clientSubscription.findMany({
      where: { barbershopId, clientAccountId: accountId, status: 'ACTIVE' },
      include: {
        clientAccount: true,
        plan: { include: { service: true } },
        // As sessões usadas (as últimas), com quem deu a baixa
        uses: { where: { undoneAt: null }, orderBy: { createdAt: 'desc' }, take: 8 },
      },
      orderBy: { createdAt: 'desc' },
    });
    const names = await this.userNames(subs.flatMap((s) => s.uses.map((u) => u.usedByUserId)));
    return subs.map((s) => ({
      ...this.toClientSubscriptionResult(s),
      uses: s.uses.map((u) => ({
        id: u.id,
        createdAt: u.createdAt.toISOString(),
        saleId: u.saleId,
        usedByName: names.get(u.usedByUserId) ?? null,
        undoneAt: null,
      })),
    }));
  }

  /** Conta do clube desta ficha, ou null se o cliente não tem conta. */
  private async clientAccountIdForCustomer(networkId: number, customerId: number) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, networkId },
      select: { clientAccountId: true, email: true },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado');
    if (customer.clientAccountId) return customer.clientAccountId;
    const email = customer.email?.trim();
    if (!email) return null;
    const account = await this.prisma.clientAccount.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });
    return account?.id ?? null;
  }

  /**
   * Confere se esta venda pode usar uma sessão do clube. O serviço do plano
   * tem de estar na venda, e uma unidade dele a R$ 0 (a sessão que o clube cobre).
   */
  private async prepareClubSession(
    networkId: number,
    barbershopId: number,
    data: {
      customerId?: number;
      clientSubscriptionId?: number;
      items: Array<{ serviceId?: number; quantity: number; unitPrice: number; totalPrice: number }>;
    },
  ) {
    if (!data.customerId) {
      throw new BadRequestException('Selecione um cliente para usar a sessão do clube.');
    }
    const accountId = await this.clientAccountIdForCustomer(networkId, data.customerId);
    const sub = await this.prisma.clientSubscription.findFirst({
      where: { id: data.clientSubscriptionId, barbershopId },
      include: { plan: true },
    });
    if (!sub || accountId == null || sub.clientAccountId !== accountId) {
      throw new BadRequestException('Esta assinatura não é deste cliente.');
    }
    if (sub.status !== 'ACTIVE') {
      throw new BadRequestException('Assinatura não está ativa');
    }
    const limit = sub.sessionsPerCycle;
    if (limit != null && sub.usedThisCycle >= limit) {
      throw new BadRequestException('Assinatura não tem sessões restantes neste ciclo');
    }
    const cents = (v: number) => Math.round(v * 100);
    // Uma sessão cobre um atendimento: uma linha só, quantidade 1 (quantidade 3
    // a R$ 0 dava três atendimentos por uma sessão)
    const free = data.items.filter(
      (item) =>
        item.serviceId === sub.plan.serviceId &&
        cents(item.unitPrice) === 0 &&
        cents(item.totalPrice) === 0,
    );
    if (free.length > 1 || free.some((item) => item.quantity !== 1)) {
      throw new BadRequestException(COVERED_SESSION_QUANTITY_MESSAGE);
    }
    const covered = free.length === 1;
    if (!covered) {
      const hasService = data.items.some((item) => item.serviceId === sub.plan.serviceId);
      throw new BadRequestException(
        hasService
          ? 'O serviço do clube entra na venda sem cobrar uma sessão.'
          : 'A venda não tem o serviço coberto por esta assinatura.',
      );
    }
    return { id: sub.id, limit, serviceId: sub.plan.serviceId };
  }

  /**
   * Confere se esta venda pode usar uma sessão de pacote. O serviço do pacote
   * tem de estar na venda, e uma unidade dele a R$ 0.
   */
  private async preparePackageSession(
    barbershopId: number,
    data: {
      customerId?: number;
      clientPackageId?: number;
      items: Array<{ serviceId?: number; quantity: number; unitPrice: number; totalPrice: number }>;
    },
  ) {
    if (!data.customerId) {
      throw new BadRequestException('Selecione um cliente para usar a sessão do pacote.');
    }
    const pkg = await this.prisma.clientPackage.findFirst({
      where: { id: data.clientPackageId, barbershopId },
      include: { servicePackage: true },
    });
    if (!pkg || pkg.customerId !== data.customerId) {
      throw new BadRequestException('Este pacote não é deste cliente.');
    }
    if (pkg.status !== 'ACTIVE') throw new BadRequestException('Pacote não está ativo');
    if (pkg.expiresAt && pkg.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Este pacote venceu.');
    }
    if (pkg.usedSessions >= pkg.totalSessions) {
      throw new BadRequestException('Pacote não tem sessões restantes');
    }
    const cents = (v: number) => Math.round(v * 100);
    const serviceId = pkg.servicePackage.serviceId;
    // Uma sessão cobre um atendimento: uma linha só, quantidade 1 (quantidade 3
    // a R$ 0 dava três atendimentos por uma sessão)
    const free = data.items.filter(
      (item) =>
        item.serviceId === serviceId && cents(item.unitPrice) === 0 && cents(item.totalPrice) === 0,
    );
    if (free.length > 1 || free.some((item) => item.quantity !== 1)) {
      throw new BadRequestException(COVERED_SESSION_QUANTITY_MESSAGE);
    }
    const covered = free.length === 1;
    if (!covered) {
      const hasService = data.items.some((item) => item.serviceId === serviceId);
      throw new BadRequestException(
        hasService
          ? 'O serviço do pacote entra na venda sem cobrar uma sessão.'
          : 'A venda não tem o serviço coberto por este pacote.',
      );
    }
    return { id: pkg.id, serviceId };
  }

  async getBarbershopSubscribers(userId: number, barbershopId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const subs = await this.prisma.clientSubscription.findMany({
      where: { barbershopId },
      include: { clientAccount: true, plan: { include: { service: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return subs.map((s) => this.toClientSubscriptionResult(s));
  }

  /**
   * Relatório de repasse do clube: o que foi cobrado dos clientes no período,
   * o que voltou para eles, a taxa da plataforma e o saldo a repassar até o
   * fim do período (ver payoutReport). Não transfere nada — só calcula.
   */
  async getSubscriptionRevenueReport(
    userId: number,
    barbershopId: number,
    startDate?: string,
    endDate?: string,
  ) {
    const shop = await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const period = reportPeriod(safeTimeZone(shop.timezone), startDate, endDate);
    const untilEnd = { lte: period.lte };
    const charges = (createdAt: { gte?: Date; lte?: Date }) =>
      this.prisma.clientSubscriptionPayment
        .findMany({
          where: { status: 'SUCCEEDED', subscription: { barbershopId }, createdAt },
          select: {
            amount: true,
            refundedAmount: true,
            platformFeePercent: true,
            settledViaConnect: true,
          },
        })
        .then((rows) =>
          rows.map(
            (p): PayoutCharge => ({
              amount: Number(p.amount),
              refunded: Number(p.refundedAmount ?? 0),
              feePercent: p.platformFeePercent == null ? null : Number(p.platformFeePercent),
              viaConnect: p.settledViaConnect,
            }),
          ),
        );
    const payouts = (paidAt: { gte?: Date; lte?: Date }) =>
      this.prisma.subscriptionPayout
        .findMany({ where: { barbershopId, paidAt }, select: { amount: true } })
        .then((rows) => rows.map((r) => Number(r.amount)));
    const [inPeriod, untilPeriodEnd, payoutsInPeriod, payoutsUntilPeriodEnd] = await Promise.all([
      charges(period),
      charges(untilEnd),
      payouts(period),
      payouts(untilEnd),
    ]);
    return payoutReport({
      inPeriod,
      untilPeriodEnd,
      payoutsInPeriod,
      payoutsUntilPeriodEnd,
      currentFee: currentPricing().platformFeePercent,
      currency: shop.currency,
    });
  }

  /**
   * Conta Connect que já recebe de verdade. Fornecedor falso (sem Stripe)
   * deixa a assinatura na plataforma, pro repasse manual.
   */
  private async subscriptionDestination(barbershopId: number) {
    const acc = await this.prisma.paymentAccount.findUnique({
      where: { ownerType_ownerId: { ownerType: 'barbershop', ownerId: barbershopId } },
    });
    if (!acc?.chargesEnabled || acc.provider !== 'stripe') return null;
    return acc.stripeAccountId;
  }

  private toClientSubscriptionResult(s: any) {
    return {
      id: s.id,
      barbershopId: s.barbershopId,
      clientAccountId: s.clientAccountId,
      clientName: s.clientAccount?.name ?? null,
      clientEmail: s.clientAccount?.email ?? null,
      planId: s.planId,
      planName: s.plan?.name ?? null,
      serviceId: s.plan?.serviceId ?? null,
      serviceName: s.plan?.service?.name ?? null,
      price: s.plan ? Number(s.plan.price) : null,
      sessionsPerCycle: s.sessionsPerCycle ?? null,
      status: s.status,
      currentPeriodStart: s.currentPeriodStart?.toISOString(),
      currentPeriodEnd: s.currentPeriodEnd?.toISOString(),
      usedThisCycle: s.usedThisCycle,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      createdAt: s.createdAt.toISOString(),
    };
  }

  /** Aciona o SetupIntent do cliente na conta da plataforma (não Connect) pra ele salvar o cartão via Stripe Elements antes de assinar. */
  async createClientSubscriptionSetupIntent(clientAccountId: number) {
    const clientAccount = await this.prisma.clientAccount.findUnique({
      where: { id: clientAccountId },
    });
    if (!clientAccount) throw new NotFoundException('Conta não encontrada');

    let stripeCustomerId = clientAccount.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await this.stripeService.createCustomer(
        clientAccount.email,
        clientAccount.name,
        {
          clientAccountId: String(clientAccountId),
        },
      );
      stripeCustomerId = customer.id;
      await this.prisma.clientAccount.update({
        where: { id: clientAccountId },
        data: { stripeCustomerId },
      });
    }

    const setupIntent = await this.stripeService.createSetupIntent(stripeCustomerId);
    return { clientSecret: setupIntent.client_secret };
  }

  async subscribeToPlan(
    clientAccountId: number,
    barbershopId: number,
    planId: number,
    paymentMethodId: string,
  ) {
    const clientAccount = await this.prisma.clientAccount.findUnique({
      where: { id: clientAccountId },
    });
    const stripeCustomerId = clientAccount?.stripeCustomerId;
    if (!stripeCustomerId) {
      throw new BadRequestException('Salve um cartão antes de assinar');
    }
    const plan = await this.prisma.clientSubscriptionPlan.findFirst({
      where: { id: planId, barbershopId, isActive: true },
      include: { service: { select: { isActive: true } } },
    });
    const stripePriceId = plan?.stripePriceId;
    if (!plan || !stripePriceId) throw new NotFoundException('Plano não encontrado');
    if (!plan.service.isActive) {
      throw new BadRequestException(
        'Este plano não aceita assinatura nova porque o serviço foi desativado.',
      );
    }
    const shopOpen = await this.prisma.barbershop.findFirst({
      where: { id: barbershopId, isActive: true, ...ownerAcceptsPublic },
      select: { id: true, networkId: true },
    });
    if (!shopOpen) throw new NotFoundException('Unidade não encontrada');
    const linked = await this.prisma.customer.findMany({
      where: { networkId: shopOpen.networkId, clientAccountId, deletedAt: null },
      select: { phone: true, email: true },
    });
    await this.ensureNotBlocked(shopOpen.networkId, {
      customerPhone: clientAccount?.phone,
      customerPhones: linked.map((row) => row.phone),
      customerEmail: clientAccount?.email,
      customerEmails: linked.map((row) => row.email),
      clientAccountId,
    });
    if (clientAccount?.suspendedAt) {
      throw new ForbiddenException(PLATFORM_SUSPENDED_BOOKING_MESSAGE);
    }

    // Dois cliques (ou duas abas) juntos passavam os dois pela checagem e
    // criavam DUAS assinaturas no Stripe — cobrança em dobro todo mês. Agora
    // a checagem, a criação no Stripe e o registro ficam sob uma trava por
    // cliente+plano, e o Stripe recebe uma chave de idempotência (que muda a
    // cada assinatura nova, pra poder assinar de novo depois de cancelar).
    const { stripeSubscription, subscription } = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`client-sub:${clientAccountId}:${planId}`}))`;
        const existing = await tx.clientSubscription.findFirst({
          where: {
            clientAccountId,
            planId,
            status: { in: ['INCOMPLETE', 'ACTIVE', 'PAST_DUE'] },
          },
        });
        if (existing) {
          throw new BadRequestException('Você já tem uma assinatura ativa neste plano');
        }
        const previous = await tx.clientSubscription.count({ where: { clientAccountId, planId } });

        await this.stripeService.attachPaymentMethod(paymentMethodId, stripeCustomerId);
        await this.stripeService.setDefaultPaymentMethod(stripeCustomerId, paymentMethodId);
        // Com conta conectada, o Stripe manda o líquido pra unidade e fica
        // com a taxa. Sem conta, o dinheiro fica na plataforma.
        const destination = await this.subscriptionDestination(barbershopId);
        const feePercent = currentPricing().platformFeePercent;
        const stripeSubscription = await this.stripeService.createSubscription(
          stripeCustomerId,
          stripePriceId,
          {
            clientAccountId: String(clientAccountId),
            barbershopId: String(barbershopId),
            planId: String(planId),
          },
          `client-sub:${clientAccountId}:${planId}:${previous + 1}`,
          destination
            ? { transfer_data: { destination }, application_fee_percent: feePercent }
            : undefined,
        );

        const subscription = await tx.clientSubscription.create({
          data: {
            barbershopId,
            clientAccountId,
            planId,
            stripeSubscriptionId: stripeSubscription.id,
            status: stripeSubscription.status === 'active' ? 'ACTIVE' : 'INCOMPLETE',
            currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
            currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
            connectAccountId: destination,
            applicationFeePercent: destination != null ? new Decimal(feePercent) : null,
            sessionsPerCycle: plan.sessionsPerCycle,
          },
        });
        return { stripeSubscription, subscription };
      },
      // A chamada ao Stripe fica dentro da trava
      { timeout: 30_000, maxWait: 30_000 },
    );

    const latestInvoice = stripeSubscription.latest_invoice as any;
    const paymentIntent = latestInvoice?.payment_intent as any;
    return {
      id: subscription.id,
      status: subscription.status,
      clientSecret: paymentIntent?.client_secret ?? null,
    };
  }

  async getMySubscriptions(clientAccountId: number) {
    const subs = await this.prisma.clientSubscription.findMany({
      where: { clientAccountId },
      include: { clientAccount: true, plan: { include: { service: true } }, barbershop: true },
      orderBy: { createdAt: 'desc' },
    });
    return subs.map((s) => ({
      ...this.toClientSubscriptionResult(s),
      barbershopName: s.barbershop.name,
      // Moeda da unidade (a conta mostrava sempre em reais)
      currency: s.barbershop.currency,
    }));
  }

  async cancelMySubscription(clientAccountId: number, subscriptionId: number) {
    const subscription = await this.prisma.clientSubscription.findFirst({
      where: { id: subscriptionId, clientAccountId },
    });
    if (!subscription) throw new NotFoundException('Assinatura não encontrada');
    // Já encerrada ou já marcada pra acabar no fim do ciclo: chamar a Stripe
    // de novo só devolve um erro genérico
    if (subscription.status === 'CANCELED' || subscription.cancelAtPeriodEnd) return true;
    await this.stripeService.updateSubscription(subscription.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
    await this.prisma.clientSubscription.update({
      where: { id: subscriptionId },
      data: { cancelAtPeriodEnd: true },
    });
    return true;
  }

  /** Staff registra que o cliente usou uma sessão da assinatura neste ciclo (mesmo padrão manual de debitClientPackageSession — não é acionado automaticamente pelo agendamento). */
  /** Registro da sessão do clube usada (quem, quando, venda e ciclo) */
  private async recordClubUse(
    tx: Prisma.TransactionClient,
    subscriptionId: number,
    userId: number,
    saleId: number | null,
  ) {
    const sub = await tx.clientSubscription.findUniqueOrThrow({
      where: { id: subscriptionId },
      select: { currentPeriodStart: true },
    });
    await tx.clientSubscriptionUse.create({
      data: {
        clientSubscriptionId: subscriptionId,
        saleId,
        usedByUserId: userId,
        periodStart: sub.currentPeriodStart,
      },
    });
  }

  async redeemClientSubscriptionSession(
    userId: number,
    barbershopId: number,
    subscriptionId: number,
  ) {
    // Como a baixa do pacote: recepção para cima (barbeiro dava baixa de qualquer cliente)
    await this.ensureBarbershopAccess(userId, barbershopId, 'reception');
    const subscription = await this.prisma.clientSubscription.findFirst({
      where: { id: subscriptionId, barbershopId },
      include: { plan: true },
    });
    if (!subscription) throw new NotFoundException('Assinatura não encontrada');
    if (subscription.status !== 'ACTIVE') {
      throw new BadRequestException('Assinatura não está ativa');
    }
    const limit = subscription.sessionsPerCycle;
    await this.prisma.$transaction(async (tx) => {
      // Baixa condicional: dois cliques juntos (ou dois barbeiros) não passam
      // do limite — antes os dois liam o mesmo saldo e gravavam +1 cada
      const { count } = await tx.clientSubscription.updateMany({
        where: {
          id: subscriptionId,
          status: 'ACTIVE',
          ...(limit != null ? { usedThisCycle: { lt: limit } } : {}),
        },
        data: { usedThisCycle: { increment: 1 } },
      });
      if (count === 0) {
        throw new BadRequestException('Assinatura não tem sessões restantes neste ciclo');
      }
      await this.recordClubUse(tx, subscriptionId, userId, null);
    });
    const updated = await this.prisma.clientSubscription.findUniqueOrThrow({
      where: { id: subscriptionId },
      include: { clientAccount: true, plan: { include: { service: true } } },
    });
    return this.toClientSubscriptionResult(updated);
  }

  /**
   * Desfaz a baixa direta (fora de venda) de uma sessão do clube: a sessão
   * volta se ainda é o mesmo ciclo. A da venda se desfaz apagando a venda.
   */
  async undoClientSubscriptionUse(userId: number, barbershopId: number, useId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'reception');
    const use = await this.prisma.clientSubscriptionUse.findFirst({
      where: { id: useId, clientSubscription: { barbershopId } },
      include: { clientSubscription: { select: { currentPeriodStart: true } } },
    });
    if (!use) throw new NotFoundException('Baixa não encontrada');
    if (use.undoneAt) throw new BadRequestException('Esta baixa já foi desfeita.');
    if (use.saleId) {
      throw new BadRequestException(CLUB_USE_IN_SALE_MESSAGE);
    }
    const sameCycle =
      (use.periodStart?.getTime() ?? null) ===
      (use.clientSubscription.currentPeriodStart?.getTime() ?? null);
    if (!sameCycle) throw new BadRequestException(CLUB_UNDO_OLD_CYCLE_MESSAGE);
    await this.prisma.$transaction(async (tx) => {
      const undone = await tx.clientSubscriptionUse.updateMany({
        where: { id: use.id, undoneAt: null },
        data: { undoneAt: new Date(), undoneByUserId: userId },
      });
      if (undone.count !== 1) throw new BadRequestException('Esta baixa já foi desfeita.');
      await tx.clientSubscription.updateMany({
        where: { id: use.clientSubscriptionId, usedThisCycle: { gt: 0 } },
        data: { usedThisCycle: { decrement: 1 } },
      });
    });
    return true;
  }

  // ============ WALK-INS (Queue) ============

  async createWalkIn(
    userId: number,
    barbershopId: number,
    data: {
      customerId?: number;
      barberId?: number;
      customerName: string;
      customerPhone?: string;
      services: Array<{ serviceId: number; quantity?: number; notes?: string }>;
    },
  ) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId);
    // Cliente, profissional e serviços têm de ser desta unidade/rede (a
    // resposta traz a ficha do cliente: sem isso vazava a de outra empresa)
    if (data.customerId) await this.ensureCustomerOfNetwork(barbershop.networkId, data.customerId);
    if (data.barberId) await this.ensureBarberOfBarbershop(barbershopId, data.barberId);
    // Como no agendamento: barbeiro só põe na própria fila (ou sem profissional)
    const ownBarberId = await this.ownBarberIdIfBarber(userId, barbershop);
    if (ownBarberId !== null && data.barberId && data.barberId !== ownBarberId) {
      throw new ForbiddenException(WALK_IN_OWN_QUEUE_MESSAGE);
    }
    await this.ensureItemsOfBarbershop(
      barbershopId,
      data.services.map((s) => s.serviceId),
    );
    await assertSoloBookingAllowed(this.prisma, barbershopId, new Date());

    const created = await this.prisma.$transaction(async (tx) => {
      // A posição sai dentro da trava: duas entradas juntas não ficam com o mesmo número
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`walk-in:${barbershopId}`}))`;
      const queuePosition = await this.nextQueuePosition(tx, barbershopId, barbershop.timezone);
      const walkIn = await tx.walkIn.create({
        data: {
          barbershopId,
          customerId: data.customerId,
          barberId: data.barberId,
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          queuePosition,
        },
      });
      await tx.walkInService.createMany({
        data: data.services.map((s) => ({
          walkInId: walkIn.id,
          serviceId: s.serviceId,
          quantity: s.quantity ?? 1,
          notes: s.notes,
        })),
      });
      return tx.walkIn.findUniqueOrThrow({
        where: { id: walkIn.id },
        include: { services: { include: { service: true } }, customer: true, barber: true },
      });
    });
    return this.hideWalkInContact(await this.contactVisibility(userId, barbershop), created);
  }

  async getWalkIns(
    userId: number,
    barbershopId: number,
    filters?: { status?: string; limit?: number; offset?: number },
  ) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId);
    // A fila é do dia (no fuso da unidade): a de ontem não fica na frente
    const where: any = { barbershopId, createdAt: { gte: queueDayStart(barbershop.timezone) } };
    if (filters?.status) where.status = filters.status;
    const walkIns = await this.prisma.walkIn.findMany({
      where,
      include: { services: { include: { service: true } }, customer: true, barber: true },
      orderBy: [{ status: 'asc' }, { queuePosition: 'asc' }],
      take: filters?.limit ?? 50,
      skip: filters?.offset ?? 0,
    });
    const canSee = await this.contactVisibility(userId, barbershop);
    return walkIns.map((w) => this.hideWalkInContact(canSee, w));
  }

  /** Próxima posição da fila de hoje (recomeça a cada dia); chamar dentro da trava */
  private async nextQueuePosition(
    tx: Prisma.TransactionClient,
    barbershopId: number,
    timezone: string | null | undefined,
  ) {
    const maxPos = await tx.walkIn.aggregate({
      where: { barbershopId, status: 'WAITING', createdAt: { gte: queueDayStart(timezone) } },
      _max: { queuePosition: true },
    });
    return (maxPos._max.queuePosition ?? 0) + 1;
  }

  async updateWalkInStatus(
    userId: number,
    barbershopId: number,
    walkInId: number,
    status: string,
    barberId?: number | null,
  ) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId);
    if (!WALK_IN_STATUSES.includes(status)) throw new BadRequestException('Status inválido');
    // Só a fila desta unidade (o id sozinho mexia na fila de qualquer uma)
    const walkIn = await this.prisma.walkIn.findFirst({
      where: { id: walkInId, barbershopId },
      select: { id: true, barberId: true, status: true },
    });
    if (!walkIn) throw new NotFoundException('Cliente da fila não encontrado');
    // Recepção para cima mexe em qualquer um. Barbeiro e básico, na própria
    // fila e no cliente sem profissional (que ele pega ao começar)
    const ownBarberId = await this.ownBarberIdIfBarber(userId, barbershop);
    if (ownBarberId !== null && walkIn.barberId !== null && walkIn.barberId !== ownBarberId) {
      throw new NotFoundException('Cliente da fila não encontrado');
    }
    if (ownBarberId !== null && barberId != null && barberId !== ownBarberId) {
      throw new ForbiddenException(WALK_IN_OWN_QUEUE_MESSAGE);
    }
    if (status !== walkIn.status && !(WALK_IN_NEXT[walkIn.status] ?? []).includes(status)) {
      throw new BadRequestException(WALK_IN_TRANSITION_MESSAGE);
    }
    const data: Prisma.WalkInUncheckedUpdateInput = { status };
    if (status === 'IN_PROGRESS' && walkIn.status !== 'IN_PROGRESS') {
      data.servedAt = new Date();
      // Grava quem atendeu: o escolhido pela recepção, o barbeiro que pegou
      // ou o que já estava na entrada
      const serving = barberId ?? walkIn.barberId ?? ownBarberId;
      if (serving != null && serving !== walkIn.barberId) {
        await this.ensureBarberOfBarbershop(barbershopId, serving, { active: true });
      }
      data.barberId = serving;
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      if (status === 'WAITING' && walkIn.status !== 'WAITING') {
        // Volta para a fila no fim (não com a posição antiga)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`walk-in:${barbershopId}`}))`;
        data.queuePosition = await this.nextQueuePosition(tx, barbershopId, barbershop.timezone);
        data.servedAt = null;
      }
      return tx.walkIn.update({ where: { id: walkInId }, data });
    });
    // O telefone que a lista esconde não volta pela resposta
    return this.hideWalkInContact(await this.contactVisibility(userId, barbershop), updated);
  }

  /**
   * Fila do dia que acabou (no fuso de cada unidade): quem ficou esperando ou
   * em atendimento sem ninguém marcar vira "não atendido", fora das faltas
   */
  async closeStaleWalkIns() {
    const closed = await this.prisma.$executeRaw`
      UPDATE "WalkIn" w
         SET status = 'NOT_SERVED'
        FROM "Barbershop" b
        LEFT JOIN pg_timezone_names t ON t.name = b.timezone
       WHERE b.id = w."barbershopId"
         AND w.status IN ('WAITING', 'IN_PROGRESS')
         AND (w."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE COALESCE(t.name, 'UTC'))::date
             < (now() AT TIME ZONE COALESCE(t.name, 'UTC'))::date`;
    if (closed) this.logger.log(`Fila: ${closed} entrada(s) de dias anteriores fechada(s)`);
    return { closed };
  }

  // ============ SERVICE HISTORY ============

  async getCustomerServiceHistory(
    userId: number,
    barbershopId: number,
    customerId: number,
    limit?: number,
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    return this.prisma.serviceHistory.findMany({
      where: { barbershopId, customerId },
      include: { service: true, barber: true },
      orderBy: { performedAt: 'desc' },
      take: limit ?? 50,
    });
  }

  // ============ SALES ============

  /**
   * Bônus de quem indicou: só na primeira vez que a venda do indicado passa
   * a paga, e só se houve gasto em dinheiro (sinal, pago pelo app ou o que
   * sobrou no caixa). Sessão de graça, cartão-presente e pontos não contam.
   */
  private async completeReferralIfPaid(
    tx: Prisma.TransactionClient,
    network: { loyaltyEnabled: boolean; referralBonusPoints: number },
    customerId: number | null | undefined,
    moneyPaid: number,
    saleId: number,
  ) {
    if (!customerId || !network.loyaltyEnabled || moneyPaid <= 0) return;
    const referral = await tx.customerReferral.findUnique({ where: { referredId: customerId } });
    if (!referral || referral.completedAt) return;
    const bonusPoints = network.referralBonusPoints;
    const claimed = await tx.customerReferral.updateMany({
      where: { id: referral.id, completedAt: null },
      data: { completedAt: new Date(), pointsAwarded: bonusPoints, saleId },
    });
    if (claimed.count === 1 && bonusPoints > 0) {
      await tx.customer.update({
        where: { id: referral.referrerId },
        data: { loyaltyPoints: { increment: bonusPoints } },
      });
    }
  }

  /**
   * A venda que completou a indicação foi apagada (ou voltou a pendente, ou
   * mudou de cliente): o bônus sai de quem indicou, sem deixar o saldo
   * negativo, e a indicação reabre pra próxima venda paga completar.
   */
  private async revertReferralOfSale(tx: Prisma.TransactionClient, saleId: number) {
    const referral = await tx.customerReferral.findFirst({ where: { saleId } });
    if (!referral) return;
    const reopened = await tx.customerReferral.updateMany({
      where: { id: referral.id, saleId },
      data: { completedAt: null, pointsAwarded: null, saleId: null },
    });
    const points = referral.pointsAwarded ?? 0;
    if (reopened.count === 1 && points > 0) {
      await tx.$executeRaw`
        UPDATE "Customer" SET "loyaltyPoints" = GREATEST(0, "loyaltyPoints" - ${points})
        WHERE id = ${referral.referrerId}`;
    }
  }

  async createSale(
    userId: number,
    barbershopId: number,
    data: {
      customerId?: number;
      barberId?: number;
      appointmentId?: number;
      saleType: string;
      items: Array<{
        itemType: string;
        serviceId?: number;
        productId?: number;
        serviceHistoryId?: number;
        quantity: number;
        unitPrice: number;
        totalPrice: number;
        notes?: string;
      }>;
      subtotal: number;
      discountAmount?: number;
      taxAmount?: number;
      total: number;
      paymentStatus?: string;
      paymentMethod?: string;
      giftCardCode?: string;
      loyaltyPointsRedeemed?: number;
      clientSubscriptionId?: number;
      clientPackageId?: number;
    },
  ) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId);
    checkSaleAmounts(data, barbershop.currency);
    checkSaleKinds({ ...data, paymentStatus: data.paymentStatus ?? 'PENDING' });
    // Barbeiro: a venda é dele (como na listagem, que só mostra as dele).
    // Antes dava pra lançar em nome de um colega (e a comissão ia junto) ou
    // cobrar o atendimento de outro
    const ownBarberId = await this.ownBarberIdIfBarber(userId, barbershop);
    if (ownBarberId !== null) {
      if (data.barberId && data.barberId !== ownBarberId) {
        throw new ForbiddenException('Você só registra vendas suas.');
      }
      data = { ...data, barberId: ownBarberId };
    }
    if (data.customerId) await this.ensureCustomerOfNetwork(barbershop.networkId, data.customerId);
    if (data.barberId) await this.ensureBarberOfBarbershop(barbershopId, data.barberId);
    // Conta do horário: uma venda só por horário, e o sinal já pago (online
    // ou na mão) é descontado do que se cobra agora
    let depositPaidOnAppointment = 0;
    // Atendimento pago antes pelo app: também é descontado
    let prepaidOnAppointment = 0;
    if (data.appointmentId) {
      const appt = await this.prisma.appointment.findFirst({
        where: { id: data.appointmentId, barbershopId },
        select: {
          id: true,
          barberId: true,
          customerId: true,
          status: true,
          depositPaid: true,
          depositAmount: true,
          prepaidAt: true,
          prepaidAmount: true,
          prepaidRefundedAt: true,
          prepaidRefundedAmount: true,
          sale: { select: { id: true } },
        },
      });
      if (!appt) throw new NotFoundException('Agendamento não encontrado');
      this.ensureOwnAppointment(ownBarberId, appt);
      if (appt.sale) {
        throw new BadRequestException(`Este atendimento já foi cobrado (venda #${appt.sale.id})`);
      }
      if (['CANCELLED', 'NO_SHOW', 'PENDING_PAYMENT'].includes(appt.status)) {
        throw new BadRequestException('Este horário não pode ser cobrado');
      }
      // A conta do horário é do cliente do horário: o sinal e o pago pelo
      // app dele não abatem a conta de outra pessoa (nem dão pontos a ela)
      if (data.customerId && data.customerId !== appt.customerId) {
        throw new BadRequestException(SALE_APPOINTMENT_CUSTOMER_MESSAGE);
      }
      data = { ...data, customerId: appt.customerId };
      if (appt.depositPaid) depositPaidOnAppointment = Number(appt.depositAmount ?? 0);
      if (appt.prepaidAt && !appt.prepaidRefundedAt) {
        // Menos o que já foi devolvido em estorno parcial
        prepaidOnAppointment =
          Number(appt.prepaidAmount ?? 0) - Number(appt.prepaidRefundedAmount ?? 0);
      }
    }
    await this.ensureItemsOfBarbershop(
      barbershopId,
      data.items.filter((i) => i.serviceId).map((i) => i.serviceId as number),
      data.items.filter((i) => i.productId).map((i) => i.productId as number),
    );
    await this.ensureServiceHistoriesOfBarbershop(
      barbershopId,
      data.items.filter((i) => i.serviceHistoryId).map((i) => i.serviceHistoryId as number),
    );
    await assertSoloProductSaleAllowed(
      this.prisma,
      barbershopId,
      new Date(),
      productUnits(data.items),
    );
    checkSaleConsistency(data);
    // Sessão do clube: a venda já traz o serviço do plano a R$ 0 (uma sessão).
    // A baixa entra na mesma transação da venda.
    const clubRedeem = data.clientSubscriptionId
      ? await this.prepareClubSession(barbershop.networkId, barbershopId, data)
      : null;
    const packageRedeem = data.clientPackageId
      ? await this.preparePackageSession(barbershopId, data)
      : null;
    if (clubRedeem && packageRedeem && clubRedeem.serviceId === packageRedeem.serviceId) {
      throw new BadRequestException('Use o clube ou o pacote neste serviço, não os dois.');
    }
    const discount = data.discountAmount ?? 0;
    const tax = data.taxAmount ?? 0;

    // O cartão-presente e o resgate de pontos são calculados e validados no
    // servidor (nunca confiamos no valor que o front manda) e descontados
    // em cima do total já calculado pelo front (subtotal - desconto + imposto)
    // — dois mecanismos de desconto independentes, não substituem um ao outro.
    let giftCard: { id: number; remainingValue: any } | null = null;
    let giftCardAmountApplied = 0;
    if (data.giftCardCode) {
      giftCard = await this.validateGiftCard(barbershopId, data.giftCardCode);
    }

    let loyaltyDiscountAmount = 0;
    if (data.loyaltyPointsRedeemed && data.loyaltyPointsRedeemed > 0) {
      if (!barbershop.network.loyaltyEnabled) {
        throw new BadRequestException('O programa de fidelidade está desligado.');
      }
      if (!data.customerId) {
        throw new BadRequestException('Selecione um cliente para resgatar pontos de fidelidade');
      }
      const customerForRedemption = await this.prisma.customer.findUnique({
        where: { id: data.customerId },
      });
      if (!customerForRedemption) throw new NotFoundException('Cliente não encontrado');
      if (customerForRedemption.loyaltyPoints < data.loyaltyPointsRedeemed) {
        throw new BadRequestException('Cliente não tem pontos de fidelidade suficientes');
      }
    }

    // Ordem: o que o cliente já pagou (sinal, pago pelo app) sai primeiro;
    // cartão-presente e pontos cobrem só o que ainda falta. Antes o cartão
    // era debitado de um atendimento já pago e os pontos saíam todos mesmo
    // sem ter o que descontar
    const total = Math.max(0, data.total);
    // Conta menor que o já pago: a diferença sumia (como na edição, recusa)
    if (round2(depositPaidOnAppointment + prepaidOnAppointment) > total + 0.005) {
      throw new BadRequestException(SALE_BELOW_APPLIED_MESSAGE);
    }
    const depositApplied = Math.min(depositPaidOnAppointment, total);
    const prepaidApplied = Math.min(prepaidOnAppointment, total - depositApplied);
    let remaining = round2(total - depositApplied - prepaidApplied);
    if (giftCard) {
      giftCardAmountApplied = round2(Math.min(Number(giftCard.remainingValue), remaining));
      remaining = round2(remaining - giftCardAmountApplied);
    }
    let loyaltyPointsRedeemed = 0;
    if (data.loyaltyPointsRedeemed && data.loyaltyPointsRedeemed > 0) {
      const pointValue = barbershop?.network.loyaltyPointValue ?? 0;
      // Só os pontos que cabem no que falta (arredondado pra cima: o último
      // ponto pode cobrir menos que o valor dele)
      loyaltyPointsRedeemed =
        pointValue > 0
          ? Math.min(data.loyaltyPointsRedeemed, Math.ceil(remaining / pointValue))
          : 0;
      loyaltyDiscountAmount = round2(Math.min(loyaltyPointsRedeemed * pointValue, remaining));
      remaining = round2(remaining - loyaltyDiscountAmount);
    }
    const finalTotal = remaining;

    // Vincula a venda ao caixa aberto no momento, se houver um — é o que
    // permite reconciliar o fechamento de caixa depois (ver
    // closeCashSession). Uma venda feita sem caixa aberto simplesmente não
    // entra na conferência de dinheiro físico, mas continua contando no
    // dashboard financeiro (que não depende de sessão de caixa).
    // Só a venda que já entra paga vai pro caixa aberto agora; a pendente
    // entra no caixa em que for paga (updateSale). Antes ficava no caixa da
    // criação e, paga em dinheiro depois, não entrava na conta de nenhum
    const openSession =
      data.paymentStatus === 'PAID'
        ? await this.prisma.cashSession.findFirst({
            where: { barbershopId, status: 'OPEN' },
          })
        : null;
    const created = this.prisma.$transaction(async (tx) => {
      const sale = await tx.sale.create({
        data: {
          barbershopId,
          customerId: data.customerId,
          barberId: data.barberId,
          appointmentId: data.appointmentId,
          cashSessionId: openSession?.id,
          saleType: data.saleType,
          subtotal: new Decimal(data.subtotal),
          discountAmount: new Decimal(discount),
          taxAmount: new Decimal(tax),
          total: new Decimal(finalTotal),
          paymentStatus: data.paymentStatus ?? 'PENDING',
          paymentMethod: data.paymentMethod,
          paidAt: data.paymentStatus === 'PAID' ? new Date() : null,
          giftCardId: giftCard?.id,
          giftCardAmountApplied: giftCard ? new Decimal(giftCardAmountApplied) : null,
          loyaltyPointsRedeemed: loyaltyPointsRedeemed || null,
          loyaltyDiscountAmount:
            loyaltyDiscountAmount > 0 ? new Decimal(loyaltyDiscountAmount) : null,
          depositApplied: depositApplied > 0 ? new Decimal(depositApplied) : null,
          prepaidApplied: prepaidApplied > 0 ? new Decimal(prepaidApplied) : null,
          clientSubscriptionId: clubRedeem?.id ?? null,
        },
      });
      // Cobrou o atendimento: ele está concluído
      if (data.appointmentId) {
        await tx.appointment.updateMany({
          // Cobrado antes do horário (pago na chegada) continua marcado
          where: {
            id: data.appointmentId,
            status: { in: ['CONFIRMED', 'IN_PROGRESS'] },
            startAt: { lte: new Date() },
          },
          data: { status: 'COMPLETED' },
        });
      }

      // Baixa condicional ("só se ainda tiver saldo"), dentro da transação:
      // a checagem lá em cima é de antes — duas vendas simultâneas passavam
      // as duas por ela e os pontos/saldo eram gastos duas vezes (o cliente
      // ficava com pontos negativos).
      if (giftCard) {
        const debited = await tx.giftCard.updateMany({
          where: { id: giftCard.id, remainingValue: { gte: giftCardAmountApplied } },
          data: { remainingValue: { decrement: giftCardAmountApplied } },
        });
        if (debited.count === 0) {
          throw new BadRequestException(
            'O saldo do cartão-presente mudou enquanto a venda era registrada. Tente de novo.',
          );
        }
      }
      if (clubRedeem) {
        const { count } = await tx.clientSubscription.updateMany({
          where: {
            id: clubRedeem.id,
            status: 'ACTIVE',
            ...(clubRedeem.limit != null ? { usedThisCycle: { lt: clubRedeem.limit } } : {}),
          },
          data: { usedThisCycle: { increment: 1 } },
        });
        if (count === 0) {
          throw new BadRequestException('Assinatura não tem sessões restantes neste ciclo');
        }
        await this.recordClubUse(tx, clubRedeem.id, userId, sale.id);
      }
      if (packageRedeem) {
        const debited = await tx.$executeRaw`
          UPDATE "ClientPackage"
          SET "usedSessions" = "usedSessions" + 1,
              status = CASE WHEN "usedSessions" + 1 >= "totalSessions" THEN 'COMPLETED' ELSE 'ACTIVE' END,
              "updatedAt" = NOW()
          WHERE id = ${packageRedeem.id} AND status = 'ACTIVE' AND "usedSessions" < "totalSessions"
            AND ("expiresAt" IS NULL OR "expiresAt" > NOW())`;
        if (debited === 0) throw new BadRequestException('Pacote não tem sessões restantes');
        await tx.clientPackageUse.create({
          data: {
            clientPackageId: packageRedeem.id,
            appointmentId: data.appointmentId ?? null,
            saleId: sale.id,
            usedByUserId: userId,
          },
        });
      }
      if (loyaltyPointsRedeemed && data.customerId) {
        const debited = await tx.customer.updateMany({
          where: { id: data.customerId, loyaltyPoints: { gte: loyaltyPointsRedeemed } },
          data: { loyaltyPoints: { decrement: loyaltyPointsRedeemed } },
        });
        if (debited.count === 0) {
          throw new BadRequestException('Cliente não tem pontos de fidelidade suficientes');
        }
      }

      // Concede pontos de fidelidade só quando a venda já está paga — evita
      // dar crédito por algo que ainda pode não se concretizar (PENDING).
      if (
        data.paymentStatus === 'PAID' &&
        data.customerId &&
        barbershop?.network.loyaltyEnabled &&
        barbershop.network.loyaltyPointsPerCurrencyUnit
      ) {
        const pointsEarned = Math.floor(
          loyaltyMoneyBase(finalTotal, depositApplied, prepaidApplied) *
            barbershop.network.loyaltyPointsPerCurrencyUnit,
        );
        if (pointsEarned > 0) {
          await tx.customer.update({
            where: { id: data.customerId },
            data: { loyaltyPoints: { increment: pointsEarned } },
          });
          await tx.sale.update({
            where: { id: sale.id },
            data: { loyaltyPointsEarned: pointsEarned },
          });
        }
      }

      if (data.paymentStatus === 'PAID') {
        await this.completeReferralIfPaid(
          tx,
          barbershop.network,
          data.customerId,
          loyaltyMoneyBase(finalTotal, depositApplied, prepaidApplied),
          sale.id,
        );
      }
      await tx.saleItem.createMany({
        data: data.items.map((item) => ({
          saleId: sale.id,
          itemType: item.itemType,
          serviceId: item.serviceId,
          productId: item.productId,
          serviceHistoryId: item.serviceHistoryId,
          quantity: item.quantity,
          unitPrice: new Decimal(item.unitPrice),
          totalPrice: new Decimal(item.totalPrice),
          notes: item.notes,
        })),
      });

      // Baixa automática de estoque para itens de produto. Diferente do
      // ajuste manual (adjustInventory), aqui NÃO bloqueamos saldo negativo:
      // a venda já aconteceu e o caixa não pode travar por causa de estoque
      // desatualizado — o item simplesmente fica negativo, sinalizando que
      // a contagem física precisa ser conferida.
      for (const item of data.items) {
        if (item.itemType !== 'PRODUCT' || !item.productId) continue;
        const product = await tx.barbershopProduct.findUnique({ where: { id: item.productId } });
        if (!product) continue;
        const quantityChange = -item.quantity;
        const { inventoryItem, quantityBefore, quantityAfter } = await moveStock(
          tx,
          barbershopId,
          item.productId,
          product.unit,
          quantityChange,
        );
        await tx.inventoryMovement.create({
          data: {
            inventoryItemId: inventoryItem.id,
            movementType: 'SALE',
            quantityChange,
            quantityBefore,
            quantityAfter,
            referenceType: 'SALE',
            referenceId: String(sale.id),
          },
        });
      }

      return tx.sale.findUniqueOrThrow({
        where: { id: sale.id },
        include: { items: true, customer: true, barber: true },
      });
    });
    // Duas pessoas cobrando o mesmo horário ao mesmo tempo: a venda é única
    return created.catch((err) => {
      if ((err as { code?: string })?.code === 'P2002' && data.appointmentId) {
        throw new BadRequestException('Este atendimento já foi cobrado');
      }
      throw err;
    });
  }

  async getSales(
    userId: number,
    barbershopId: number,
    filters?: {
      customerId?: number;
      barberId?: number;
      paymentStatus?: string;
      from?: Date;
      to?: Date;
      limit?: number;
      offset?: number;
    },
  ) {
    const shop = await this.ensureBarbershopAccess(userId, barbershopId);
    const where: any = { barbershopId };
    if (filters?.customerId) where.customerId = filters.customerId;
    if (filters?.barberId) where.barberId = filters.barberId;
    // Barbeiro vê só as próprias vendas (o faturamento da unidade é do dono
    // e do gerente)
    const ownBarberId = await this.ownBarberIdIfBarber(userId, shop);
    if (ownBarberId !== null) where.barberId = ownBarberId;
    if (filters?.paymentStatus) where.paymentStatus = filters.paymentStatus;
    if (filters?.from || filters?.to) {
      where.createdAt = {};
      if (filters.from) where.createdAt.gte = filters.from;
      if (filters.to) where.createdAt.lte = filters.to;
    }
    const sales = await this.prisma.sale.findMany({
      where,
      include: {
        items: { include: { service: true, product: true } },
        customer: true,
        barber: true,
      },
      orderBy: { createdAt: 'desc' },
      take: filters?.limit ?? 50,
      skip: filters?.offset ?? 0,
    });
    return sales.map((s) => ({
      ...s,
      customerName: (s.customer as any)?.name ?? null,
      barberName: (s.barber as any)?.name ?? null,
      items: s.items.map((item) => ({
        ...item,
        productName: (item.product as any)?.name ?? null,
        serviceName: (item.service as any)?.name ?? null,
      })),
    }));
  }

  /**
   * Diferença de produtos entre a venda antiga e a nova. Vender mais baixa
   * o estoque; tirar item devolve. O movimento fica ligado à mesma venda.
   */
  private async applySaleStockDelta(
    tx: Prisma.TransactionClient,
    barbershopId: number,
    saleId: number,
    before: Array<{ itemType: string; productId: number | null; quantity: number }>,
    after: Array<{ itemType: string; productId?: number; quantity: number }>,
  ) {
    const oldQty = productQuantities(before);
    const newQty = productQuantities(after);
    for (const productId of new Set([...oldQty.keys(), ...newQty.keys()])) {
      const deltaSold = (newQty.get(productId) ?? 0) - (oldQty.get(productId) ?? 0);
      if (deltaSold === 0) continue;
      const product = await tx.barbershopProduct.findUnique({ where: { id: productId } });
      if (!product) continue;
      const quantityChange = -deltaSold;
      const { inventoryItem, quantityBefore, quantityAfter } = await moveStock(
        tx,
        barbershopId,
        productId,
        product.unit,
        quantityChange,
      );
      await tx.inventoryMovement.create({
        data: {
          inventoryItemId: inventoryItem.id,
          movementType: 'SALE',
          quantityChange,
          quantityBefore,
          quantityAfter,
          referenceType: 'SALE',
          referenceId: String(saleId),
          notes: 'Venda editada',
        },
      });
    }
  }

  async updateSale(
    userId: number,
    barbershopId: number,
    saleId: number,
    data: {
      customerId?: number;
      barberId?: number;
      saleType?: string;
      items?: Array<{
        itemType: string;
        serviceId?: number;
        productId?: number;
        serviceHistoryId?: number;
        quantity: number;
        unitPrice: number;
        totalPrice: number;
        notes?: string;
      }>;
      subtotal?: number;
      discountAmount?: number;
      taxAmount?: number;
      total?: number;
      paymentStatus?: string;
      paymentMethod?: string;
    },
  ) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    checkSaleAmounts(data, barbershop.currency);
    // Como na criação: cliente, profissional e itens têm de ser desta
    // unidade/rede (senão a venda aponta pra dado de outra empresa)
    if (data.customerId) await this.ensureCustomerOfNetwork(barbershop.networkId, data.customerId);
    if (data.barberId) await this.ensureBarberOfBarbershop(barbershopId, data.barberId);
    if (data.items) {
      await this.ensureItemsOfBarbershop(
        barbershopId,
        data.items.filter((i) => i.serviceId).map((i) => i.serviceId as number),
        data.items.filter((i) => i.productId).map((i) => i.productId as number),
      );
      await this.ensureServiceHistoriesOfBarbershop(
        barbershopId,
        data.items.filter((i) => i.serviceHistoryId).map((i) => i.serviceHistoryId as number),
      );
      const existingItems = await this.prisma.saleItem.findMany({
        where: { saleId, sale: { barbershopId } },
        select: { itemType: true, productId: true, quantity: true },
      });
      const sale = await this.prisma.sale.findFirst({
        where: { id: saleId, barbershopId },
        select: { createdAt: true },
      });
      if (sale) {
        const adding = productUnits(data.items) - productUnits(existingItems);
        await assertSoloProductSaleAllowed(this.prisma, barbershopId, sale.createdAt, adding);
      }
    }
    // Comissão já paga do profissional desta venda: a diferença vai pro período em aberto
    const before = await this.prisma.sale.findFirst({
      where: { id: saleId, barbershopId },
      select: { barberId: true, paymentStatus: true, paidAt: true, createdAt: true },
    });
    const lockedBarberId =
      before?.barberId != null && (await this.paidCommissionPayout(before))
        ? before.barberId
        : null;
    const commissionBefore =
      lockedBarberId != null ? await this.saleCommission(barbershopId, saleId, lockedBarberId) : 0;
    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.sale.findFirst({
        where: { id: saleId, barbershopId },
        include: {
          items: { select: { totalPrice: true } },
          cashSession: { select: { status: true } },
        },
      });
      if (!existing) throw new BadRequestException('Venda não encontrada');
      if (existing.saleType === REFUND_SALE_TYPE) {
        throw new BadRequestException(REFUND_SALE_LOCKED_MESSAGE);
      }
      checkSaleKinds(data, existing);
      // Pacote e cartão guardam o valor vendido. Receber a pendente (situação
      // e forma) continua permitido; mudar o total deixaria o saldo diferente
      // do que a venda diz.
      if (
        (existing.saleType === 'PACKAGE' || existing.saleType === 'GIFT_CARD') &&
        issuedSaleValueChanged(existing, data)
      ) {
        throw new BadRequestException(ISSUED_SALE_VALUE_LOCKED_MESSAGE);
      }
      // Caixa já fechado: o fechamento gravado (esperado e diferença) conta
      // com esta venda; mudar valor, forma ou situação desfazia a conferência
      if (existing.cashSession?.status === 'CLOSED' && saleMoneyChanged(existing, data)) {
        throw new BadRequestException(CLOSED_CASH_SALE_MESSAGE);
      }
      // A venda editada com novo total também tem de fechar (o total gravado
      // já desconta sinal, cartão-presente e pontos; por isso só confere
      // quando o total vem na edição). O que não veio fica como estava.
      if (data.total !== undefined) {
        const items =
          data.items ??
          (
            await tx.saleItem.findMany({
              where: { saleId },
              select: { quantity: true, unitPrice: true, totalPrice: true },
            })
          ).map((i) => ({
            quantity: i.quantity,
            unitPrice: Number(i.unitPrice),
            totalPrice: Number(i.totalPrice),
          }));
        checkSaleConsistency({
          items,
          subtotal: data.subtotal ?? Number(existing.subtotal),
          discountAmount: data.discountAmount ?? Number(existing.discountAmount ?? 0),
          taxAmount: data.taxAmount ?? Number(existing.taxAmount ?? 0),
          total: data.total ?? Number(existing.total),
        });
      }

      // A tela manda o total cheio (subtotal − desconto + acréscimo). O
      // gravado desconta o que o cliente já pagou antes (sinal, pelo app,
      // cartão-presente, pontos); antes a edição gravava o cheio e o cliente
      // aparecia pagando duas vezes
      let netTotal: number | undefined;
      if (data.total !== undefined) {
        const applied = round2(
          Number(existing.depositApplied ?? 0) +
            Number(existing.prepaidApplied ?? 0) +
            Number(existing.giftCardAmountApplied ?? 0) +
            Number(existing.loyaltyDiscountAmount ?? 0),
        );
        if (data.total + MONEY_TOLERANCE < applied) {
          throw new BadRequestException(SALE_BELOW_APPLIED_MESSAGE);
        }
        netTotal = round2(Math.max(0, data.total - applied));
      }

      const updateData: any = {};
      if (data.customerId !== undefined) updateData.customerId = data.customerId;
      if (data.barberId !== undefined) updateData.barberId = data.barberId;
      if (data.saleType !== undefined) updateData.saleType = data.saleType;
      if (data.subtotal !== undefined) updateData.subtotal = new Decimal(data.subtotal);
      if (data.discountAmount !== undefined)
        updateData.discountAmount = new Decimal(data.discountAmount);
      if (data.taxAmount !== undefined) updateData.taxAmount = new Decimal(data.taxAmount);
      if (netTotal !== undefined) updateData.total = new Decimal(netTotal);
      if (data.paymentStatus !== undefined) {
        updateData.paymentStatus = data.paymentStatus;
        if (data.paymentStatus === 'PAID' && existing.paymentStatus !== 'PAID') {
          updateData.paidAt = new Date();
          // Paga agora: entra no caixa aberto agora (onde o dinheiro entrou)
          const open = await tx.cashSession.findFirst({
            where: { barbershopId, status: 'OPEN' },
            select: { id: true },
          });
          updateData.cashSessionId = open?.id ?? null;
        }
      }
      if (data.paymentMethod !== undefined) updateData.paymentMethod = data.paymentMethod;

      const nextStatus = data.paymentStatus ?? existing.paymentStatus;
      const nextTotal = netTotal !== undefined ? netTotal : Number(existing.total);
      const nextCustomerId = data.customerId !== undefined ? data.customerId : existing.customerId;
      const nextEarned = loyaltyEarnedFor(
        barbershop.network,
        nextStatus,
        loyaltyMoneyBase(
          nextTotal,
          Number(existing.depositApplied ?? 0),
          Number(existing.prepaidApplied ?? 0),
        ),
        nextCustomerId,
      );
      const prevEarned = existing.loyaltyPointsEarned ?? 0;
      updateData.loyaltyPointsEarned = nextEarned || null;

      // Pontos resgatados e cartão-presente ficam com o cliente da venda: trocar
      // o cliente deixava o desconto de um na venda do outro, e apagar a venda
      // devolvia os pontos a quem não os tinha gasto (item 285)
      if (
        (existing.customerId ?? null) !== (nextCustomerId ?? null) &&
        ((existing.loyaltyPointsRedeemed ?? 0) > 0 ||
          Number(existing.giftCardAmountApplied ?? 0) > 0)
      ) {
        throw new BadRequestException(SALE_CUSTOMER_LOCKED_MESSAGE);
      }

      await tx.sale.update({ where: { id: saleId }, data: updateData });

      if (existing.customerId && existing.customerId !== nextCustomerId && prevEarned) {
        await addLoyaltyPoints(tx, existing.customerId, -prevEarned);
      }
      if (nextCustomerId) {
        const delta = nextCustomerId === existing.customerId ? nextEarned - prevEarned : nextEarned;
        if (delta !== 0) await addLoyaltyPoints(tx, nextCustomerId, delta);
      }

      // Deixou de ser paga ou mudou de cliente: a indicação que ela completou reabre
      const customerChanged = (nextCustomerId ?? null) !== (existing.customerId ?? null);
      if (existing.paymentStatus === 'PAID' && (nextStatus !== 'PAID' || customerChanged)) {
        await this.revertReferralOfSale(tx, saleId);
      }
      if (nextStatus === 'PAID' && (existing.paymentStatus !== 'PAID' || customerChanged)) {
        await this.completeReferralIfPaid(
          tx,
          barbershop.network,
          nextCustomerId,
          loyaltyMoneyBase(
            nextTotal,
            Number(existing.depositApplied ?? 0),
            Number(existing.prepaidApplied ?? 0),
          ),
          saleId,
        );
      }

      if (data.items) {
        const previous = await tx.saleItem.findMany({
          where: { saleId },
          select: { itemType: true, productId: true, quantity: true },
        });
        await tx.saleItem.deleteMany({ where: { saleId } });
        await tx.saleItem.createMany({
          data: data.items.map((item) => ({
            saleId,
            itemType: item.itemType,
            serviceId: item.serviceId,
            productId: item.productId,
            serviceHistoryId: item.serviceHistoryId,
            quantity: item.quantity,
            unitPrice: new Decimal(item.unitPrice),
            totalPrice: new Decimal(item.totalPrice),
            notes: item.notes,
          })),
        });
        await this.applySaleStockDelta(tx, barbershopId, saleId, previous, data.items);
      }

      return tx.sale.findUnique({
        where: { id: saleId },
        include: { items: true, customer: true, barber: true },
      });
    });
    if (updated) {
      const note = `Venda #${saleId} alterada depois do pagamento da comissão`;
      if (lockedBarberId != null) {
        const after = await this.saleCommission(barbershopId, saleId, lockedBarberId);
        await this.commissionAdjustment(
          this.prisma,
          barbershopId,
          lockedBarberId,
          after - commissionBefore,
          userId,
          note,
        );
      }
      // Passou para outro profissional num período que ele já recebeu
      if (updated.barberId != null && updated.barberId !== before?.barberId) {
        if (await this.paidCommissionPayout(updated)) {
          await this.commissionAdjustment(
            this.prisma,
            barbershopId,
            updated.barberId,
            await this.saleCommission(barbershopId, saleId, updated.barberId),
            userId,
            note,
          );
        }
      }
    }
    return updated;
  }

  async deleteSale(userId: number, barbershopId: number, saleId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const existing = await this.prisma.sale.findFirst({
      where: { id: saleId, barbershopId },
      include: { cashSession: { select: { status: true } } },
    });
    if (!existing) throw new BadRequestException('Venda não encontrada');
    if (existing.saleType === REFUND_SALE_TYPE) {
      throw new BadRequestException(REFUND_SALE_LOCKED_MESSAGE);
    }
    if (existing.cashSession?.status === 'CLOSED') {
      throw new BadRequestException(CLOSED_CASH_SALE_MESSAGE);
    }
    // Comissão desta venda já paga ao profissional: sai no próximo pagamento
    const paidCommission =
      existing.barberId != null && (await this.paidCommissionPayout(existing))
        ? await this.saleCommission(barbershopId, saleId, existing.barberId)
        : 0;
    // Apagar desfaz o que a venda mexeu fora dela: antes o cartão-presente
    // ficava sem o saldo, o cliente perdia os pontos resgatados (e mantinha
    // os ganhos) e o estoque continuava baixado
    await this.prisma.$transaction(async (tx) => {
      await this.cancelIssuedIfUnused(tx, saleId);
      await this.restorePackageUses(tx, saleId, userId);
      // Indicação completada por esta venda: o bônus de quem indicou sai
      await this.revertReferralOfSale(tx, saleId);
      // Taxa de falta lançada por esta venda: volta a ficar pendente
      await tx.noShowFee.updateMany({
        where: { saleId },
        data: { status: 'PENDING', collectedAt: null, saleId: null },
      });
      // Sessão do clube usada nesta venda volta, se ainda é o mesmo ciclo
      if (existing.clientSubscriptionId != null) {
        await tx.clientSubscription.updateMany({
          where: {
            id: existing.clientSubscriptionId,
            usedThisCycle: { gt: 0 },
            OR: [{ currentPeriodStart: null }, { currentPeriodStart: { lte: existing.createdAt } }],
          },
          data: { usedThisCycle: { decrement: 1 } },
        });
        await tx.clientSubscriptionUse.updateMany({
          where: { saleId, undoneAt: null },
          data: { undoneAt: new Date(), undoneByUserId: userId },
        });
      }
      if (existing.giftCardId && existing.giftCardAmountApplied) {
        await tx.giftCard.update({
          where: { id: existing.giftCardId },
          data: { remainingValue: { increment: existing.giftCardAmountApplied } },
        });
      }
      const points = (existing.loyaltyPointsRedeemed ?? 0) - (existing.loyaltyPointsEarned ?? 0);
      if (existing.customerId && points !== 0) {
        await addLoyaltyPoints(tx, existing.customerId, points);
      }
      const movements = await tx.inventoryMovement.findMany({
        where: { referenceType: 'SALE', referenceId: String(saleId), movementType: 'SALE' },
      });
      for (const m of movements) {
        const item = await tx.inventoryItem.update({
          where: { id: m.inventoryItemId },
          data: { quantity: { decrement: m.quantityChange } },
        });
        const after = Number(item.quantity);
        const change = -Number(m.quantityChange);
        await tx.inventoryMovement.create({
          data: {
            inventoryItemId: m.inventoryItemId,
            movementType: 'ADJUSTMENT',
            quantityChange: change,
            quantityBefore: after - change,
            quantityAfter: after,
            referenceType: 'SALE_DELETED',
            referenceId: String(saleId),
            notes: 'Venda apagada: estoque devolvido',
          },
        });
      }
      await tx.sale.delete({ where: { id: saleId } });
      if (paidCommission && existing.barberId != null) {
        await this.commissionAdjustment(
          tx,
          barbershopId,
          existing.barberId,
          -paidCommission,
          userId,
          `Venda #${saleId} apagada depois do pagamento da comissão`,
        );
      }
    });
    return true;
  }

  /**
   * A venda emitiu um pacote ou cartão. Sem uso, cancela os dois antes de
   * apagar a venda. Com uso, recusa: o que sobrou sai por refundIssuedRemainder.
   * O update é condicional pra um débito no meio do caminho não passar.
   */
  /** Apagar a venda da conta devolve a sessão do pacote que ela baixou. */
  private async restorePackageUses(tx: Prisma.TransactionClient, saleId: number, userId: number) {
    const uses = await tx.clientPackageUse.findMany({ where: { saleId, undoneAt: null } });
    for (const use of uses) {
      // Pacote cancelado ou com o restante devolvido não ganha sessão de volta
      // (a venda sai mesmo assim; a sessão continua usada)
      const restored = await tx.clientPackage.updateMany({
        where: { id: use.clientPackageId, usedSessions: { gt: 0 }, ...RESTORABLE_PACKAGE },
        data: { usedSessions: { decrement: 1 }, status: 'ACTIVE' },
      });
      if (restored.count === 1) {
        await tx.clientPackageUse.update({
          where: { id: use.id },
          data: { undoneAt: new Date(), undoneByUserId: userId },
        });
      }
    }
  }

  private async cancelIssuedIfUnused(tx: Prisma.TransactionClient, saleId: number) {
    const issuedPackage = await tx.clientPackage.findUnique({ where: { saleId } });
    if (issuedPackage) {
      if (issuedPackage.usedSessions > 0) {
        throw new BadRequestException(PACKAGE_SALE_USED_MESSAGE);
      }
      const cancelled = await tx.clientPackage.updateMany({
        where: { id: issuedPackage.id, saleId, usedSessions: 0, status: 'ACTIVE' },
        data: { status: 'CANCELLED' },
      });
      if (cancelled.count === 0) {
        const again = await tx.clientPackage.findUnique({ where: { id: issuedPackage.id } });
        const alreadyCancelled = again?.usedSessions === 0 && again.status === 'CANCELLED';
        if (!alreadyCancelled) throw new BadRequestException(PACKAGE_SALE_USED_MESSAGE);
      }
    }

    const issuedCard = await tx.giftCard.findUnique({ where: { saleId } });
    if (!issuedCard) return;
    const unused = Number(issuedCard.remainingValue) === Number(issuedCard.initialValue);
    if (!unused) throw new BadRequestException(GIFT_CARD_SALE_USED_MESSAGE);
    const deactivated = await tx.giftCard.updateMany({
      where: {
        id: issuedCard.id,
        saleId,
        isActive: true,
        remainingValue: issuedCard.initialValue,
      },
      data: { isActive: false, remainingValue: new Decimal(0) },
    });
    if (deactivated.count === 0) {
      const again = await tx.giftCard.findUnique({ where: { id: issuedCard.id } });
      const stillUnused =
        again != null && Number(again.remainingValue) === Number(again.initialValue);
      if (!stillUnused) throw new BadRequestException(GIFT_CARD_SALE_USED_MESSAGE);
    }
  }

  /**
   * O pacote ou o cartão já foi usado em parte. Abaixa a venda até o que foi
   * consumido e zera o que sobrou (sessões ou saldo).
   */
  async refundIssuedRemainder(userId: number, barbershopId: number, saleId: number) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.sale.findFirst({
        where: { id: saleId, barbershopId },
        include: { cashSession: { select: { status: true } } },
      });
      if (!existing) throw new BadRequestException('Venda não encontrada');
      // Venda paga: o estorno é um lançamento novo, de hoje, no caixa aberto
      // (a venda original fica como foi; antes ela era reescrita e o
      // faturamento do dia antigo mudava, ou o estorno era recusado com o
      // caixa dela já fechado). Pendente: nada foi pago, ajusta a própria venda
      const paid = existing.paymentStatus === 'PAID';
      if (!paid && existing.cashSession?.status === 'CLOSED') {
        throw new BadRequestException(CLOSED_CASH_SALE_MESSAGE);
      }
      const issued = await tx.clientPackage.findUnique({ where: { saleId } });
      const card = issued ? null : await tx.giftCard.findUnique({ where: { saleId } });
      if (!issued && !card) throw new BadRequestException(SALE_NOT_ISSUED_MESSAGE);

      let newTotal = 0;
      if (issued) {
        if (issued.usedSessions <= 0) throw new BadRequestException(PACKAGE_UNUSED_DELETE_MESSAGE);
        if (issued.status !== 'ACTIVE' || issued.usedSessions >= issued.totalSessions) {
          throw new BadRequestException(NOTHING_LEFT_TO_REFUND_MESSAGE);
        }
        newTotal = round2((Number(existing.total) * issued.usedSessions) / issued.totalSessions);
        const updated = await tx.clientPackage.updateMany({
          where: {
            id: issued.id,
            saleId,
            status: 'ACTIVE',
            usedSessions: issued.usedSessions,
            totalSessions: issued.totalSessions,
          },
          data: {
            totalSessions: issued.usedSessions,
            status: 'COMPLETED',
            remainderRefundedAt: new Date(),
          },
        });
        if (updated.count === 0) throw new BadRequestException(PACKAGE_CHANGED_MESSAGE);
      } else if (card) {
        const remaining = Number(card.remainingValue);
        const initial = Number(card.initialValue);
        if (remaining >= initial) throw new BadRequestException(GIFT_CARD_UNUSED_DELETE_MESSAGE);
        if (remaining <= 0) throw new BadRequestException(NOTHING_LEFT_TO_REFUND_MESSAGE);
        newTotal = round2(Math.max(0, Number(existing.total) - remaining));
        const updated = await tx.giftCard.updateMany({
          where: { id: card.id, saleId, remainingValue: card.remainingValue },
          data: { remainingValue: new Decimal(0), isActive: false },
        });
        if (updated.count === 0) throw new BadRequestException(GIFT_CARD_CHANGED_MESSAGE);
      }

      const amount = new Decimal(newTotal);
      const prevEarned = existing.loyaltyPointsEarned ?? 0;
      const nextEarned =
        prevEarned > 0
          ? loyaltyEarnedFor(
              barbershop.network,
              existing.paymentStatus,
              loyaltyMoneyBase(
                newTotal,
                Number(existing.depositApplied ?? 0),
                Number(existing.prepaidApplied ?? 0),
              ),
              existing.customerId,
            )
          : 0;
      if (paid) {
        const refund = round2(Number(existing.total) - newTotal);
        if (refund > 0) {
          const openSession = await tx.cashSession.findFirst({
            where: { barbershopId, status: 'OPEN' },
            select: { id: true },
          });
          const value = new Decimal(-refund);
          await tx.sale.create({
            data: {
              barbershopId,
              customerId: existing.customerId,
              // Do profissional da venda: a comissão do que voltou é descontada
              barberId: existing.barberId,
              cashSessionId: openSession?.id ?? null,
              saleType: REFUND_SALE_TYPE,
              subtotal: value,
              total: value,
              paymentStatus: 'PAID',
              paymentMethod: existing.paymentMethod,
              paidAt: new Date(),
              items: {
                create: [
                  {
                    itemType: issued ? 'PACKAGE' : 'GIFT_CARD',
                    quantity: 1,
                    unitPrice: value,
                    totalPrice: value,
                    notes: `Estorno do saldo da venda #${saleId}`,
                  },
                ],
              },
            },
          });
        }
        if (prevEarned > 0) {
          await tx.sale.update({
            where: { id: saleId },
            data: { loyaltyPointsEarned: nextEarned || null },
          });
        }
      } else {
        await tx.sale.update({
          where: { id: saleId },
          data: {
            subtotal: amount,
            discountAmount: new Decimal(0),
            taxAmount: new Decimal(0),
            total: amount,
            ...(prevEarned > 0 ? { loyaltyPointsEarned: nextEarned || null } : {}),
          },
        });
      }
      if (prevEarned > 0 && existing.customerId && nextEarned !== prevEarned) {
        await tx.customer.update({
          where: { id: existing.customerId },
          data: { loyaltyPoints: { increment: nextEarned - prevEarned } },
        });
      }
      if (!paid) {
        const items = await tx.saleItem.findMany({ where: { saleId }, orderBy: { id: 'asc' } });
        if (items[0]) {
          await tx.saleItem.update({
            where: { id: items[0].id },
            data: { unitPrice: amount, totalPrice: amount },
          });
        }
        for (const extra of items.slice(1)) {
          await tx.saleItem.update({
            where: { id: extra.id },
            data: { unitPrice: new Decimal(0), totalPrice: new Decimal(0) },
          });
        }
      }
    });
    return true;
  }

  // ============ CASH SESSION ============

  async getCurrentCashSession(userId: number, barbershopId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const session = await this.prisma.cashSession.findFirst({
      where: { barbershopId, status: 'OPEN' },
      include: { openedBy: true, closedBy: true },
    });
    return session ? this.toCashSessionResult(session) : null;
  }

  async getCashSessions(userId: number, barbershopId: number, limit = 30) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const sessions = await this.prisma.cashSession.findMany({
      where: { barbershopId },
      include: { openedBy: true, closedBy: true },
      orderBy: { openedAt: 'desc' },
      take: limit,
    });
    return sessions.map((s) => this.toCashSessionResult(s));
  }

  async openCashSession(userId: number, barbershopId: number, openingBalance: number) {
    const shop = await this.ensureBarbershopAccess(userId, barbershopId, 'reception');
    checkMoney('Troco inicial', openingBalance, shop.currency);
    // Um caixa aberto por unidade: dois cliques juntos abriam dois (a
    // checagem e a criação eram passos separados)
    const session = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cash:${barbershopId}`}))`;
      const existing = await tx.cashSession.findFirst({
        where: { barbershopId, status: 'OPEN' },
      });
      if (existing) {
        throw new BadRequestException('Já existe um caixa aberto para esta unidade');
      }
      return tx.cashSession.create({
        data: {
          barbershopId,
          openedByUserId: userId,
          openingBalance: new Decimal(openingBalance),
        },
        include: { openedBy: true, closedBy: true },
      });
    });
    return this.toCashSessionResult(session);
  }

  /**
   * expectedBalance considera só transações em dinheiro (CASH) — cartão e
   * Pix não afetam o dinheiro físico na gaveta, que é o que essa conferência
   * existe pra checar.
   */
  async closeCashSession(
    userId: number,
    barbershopId: number,
    data: { countedBalance: number; notes?: string },
  ) {
    const shop = await this.ensureBarbershopAccess(userId, barbershopId, 'reception');
    checkMoney('Valor contado', data.countedBalance, shop.currency);
    const session = await this.prisma.cashSession.findFirst({
      where: { barbershopId, status: 'OPEN' },
    });
    if (!session) {
      throw new NotFoundException('Nenhum caixa aberto para esta unidade');
    }
    const [cashSales, cashExpenses, cashRent, cashTips, cashDeposits] = await Promise.all([
      this.prisma.sale.aggregate({
        where: {
          cashSessionId: session.id,
          paymentMethod: 'CASH',
          paymentStatus: 'PAID',
        },
        _sum: { total: true },
      }),
      this.prisma.expense.aggregate({
        where: { cashSessionId: session.id, paymentMethod: 'CASH' },
        _sum: { amount: true },
      }),
      // Aluguel da cadeira recebido em dinheiro também está na gaveta
      this.prisma.chairRentPayment.aggregate({
        where: { cashSessionId: session.id, method: 'CASH', status: 'SUCCEEDED' },
        _sum: { amount: true },
      }),
      // Caixinha em dinheiro deixada no balcão (da unidade ou pro profissional)
      this.prisma.appointmentTip.aggregate({
        where: { cashSessionId: session.id, method: 'CASH' },
        _sum: { amount: true },
      }),
      // Sinal recebido em dinheiro pela equipe (a conta depois desconta ele)
      this.prisma.appointment.aggregate({
        where: { depositCashSessionId: session.id, depositPaid: true, depositManualMethod: 'CASH' },
        _sum: { depositAmount: true },
      }),
    ]);
    const openingBalance = Number(session.openingBalance);
    const cashIn =
      Number(cashSales._sum.total ?? 0) +
      Number(cashRent._sum.amount ?? 0) +
      Number(cashTips._sum.amount ?? 0) +
      Number(cashDeposits._sum.depositAmount ?? 0);
    const cashOut = Number(cashExpenses._sum.amount ?? 0);
    const expectedBalance = openingBalance + cashIn - cashOut;
    const difference = data.countedBalance - expectedBalance;
    // Fecha só se ainda está aberto (dois fechamentos juntos: vale o primeiro)
    const closed = await this.prisma.cashSession.updateMany({
      where: { id: session.id, status: 'OPEN' },
      data: {
        closedByUserId: userId,
        closedAt: new Date(),
        countedBalance: new Decimal(data.countedBalance),
        expectedBalance: new Decimal(expectedBalance),
        difference: new Decimal(difference),
        status: 'CLOSED',
        notes: data.notes,
      },
    });
    if (closed.count === 0) throw new BadRequestException('Este caixa já foi fechado');
    const updated = await this.prisma.cashSession.findUniqueOrThrow({
      where: { id: session.id },
      include: { openedBy: true, closedBy: true },
    });
    return this.toCashSessionResult(updated);
  }

  private toCashSessionResult(session: any) {
    return {
      ...session,
      openedByName: session.openedBy?.fullName ?? null,
      closedByName: session.closedBy?.fullName ?? null,
    };
  }

  // ============ EXPENSES ============

  async createExpense(
    userId: number,
    barbershopId: number,
    data: {
      category: string;
      description: string;
      amount: number;
      paymentMethod?: string;
      expenseDate?: string;
    },
  ) {
    const shop = await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    if (!(data.amount > 0)) throw new BadRequestException('Valor da despesa inválido');
    checkMoney('Valor da despesa', data.amount, shop.currency);
    // Texto livre deixava "cash" fora da conferência do caixa e partia a
    // mesma categoria em várias linhas do resumo
    if (!EXPENSE_CATEGORIES.includes(data.category)) {
      throw new BadRequestException(EXPENSE_CATEGORY_INVALID_MESSAGE);
    }
    const paymentMethod = data.paymentMethod?.trim() || null;
    if (paymentMethod && !SALE_PAYMENT_METHODS.includes(paymentMethod)) {
      throw new BadRequestException(PAYMENT_METHOD_INVALID_MESSAGE);
    }
    const description = data.description?.trim() ?? '';
    if (!description || description.length > EXPENSE_DESCRIPTION_MAX) {
      throw new BadRequestException(EXPENSE_DESCRIPTION_INVALID_MESSAGE);
    }
    // O dia é o do fuso da unidade (meio-dia, longe da virada): "AAAA-MM-DD"
    // como meia-noite UTC caía no dia anterior no Brasil
    const timeZone = safeTimeZone(shop.timezone);
    const today = toZonedParts(new Date(), timeZone).dateStr;
    let expenseDate = new Date();
    let day = today;
    if (data.expenseDate) {
      const value = data.expenseDate.trim();
      if (!isCalendarDay(value) || value > today) {
        throw new BadRequestException(EXPENSE_DATE_INVALID_MESSAGE);
      }
      day = value;
      if (value !== today) expenseDate = zonedTimeToUtc(value, 12 * 60, timeZone);
    }
    // Só a despesa de hoje sai do caixa aberto (a de outro dia não mexe na gaveta)
    const openSession =
      day === today
        ? await this.prisma.cashSession.findFirst({
            where: { barbershopId, status: 'OPEN' },
          })
        : null;
    const expense = await this.prisma.expense.create({
      data: {
        barbershopId,
        cashSessionId: openSession?.id,
        category: data.category,
        description,
        amount: new Decimal(data.amount),
        paymentMethod,
        expenseDate,
        createdByUserId: userId,
      },
      include: { createdBy: true },
    });
    return { ...expense, createdByName: expense.createdBy?.fullName ?? null };
  }

  async getExpenses(
    userId: number,
    barbershopId: number,
    filters?: { from?: Date; to?: Date; category?: string },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const where: any = { barbershopId };
    if (filters?.category) where.category = filters.category;
    if (filters?.from || filters?.to) {
      where.expenseDate = {};
      if (filters.from) where.expenseDate.gte = filters.from;
      if (filters.to) where.expenseDate.lte = filters.to;
    }
    const expenses = await this.prisma.expense.findMany({
      where,
      include: { createdBy: true },
      orderBy: { expenseDate: 'desc' },
    });
    return expenses.map((e) => ({ ...e, createdByName: e.createdBy?.fullName ?? null }));
  }

  async deleteExpense(userId: number, barbershopId: number, expenseId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const existing = await this.prisma.expense.findFirst({
      where: { id: expenseId, barbershopId },
      include: { cashSession: { select: { status: true } } },
    });
    if (!existing) throw new NotFoundException('Despesa não encontrada');
    if (existing.cashSession?.status === 'CLOSED') {
      throw new BadRequestException(
        'Essa despesa é de um caixa já fechado. Lance a correção no caixa aberto.',
      );
    }
    // Despesa lançada por vale, pagamento da equipe ou aluguel da cadeira:
    // apagar só ela deixava o lançamento apontando pra nada
    const [payEntry, payout, rent] = await Promise.all([
      this.prisma.barberPayEntry.findFirst({ where: { expenseId }, select: { id: true } }),
      this.prisma.barberPayout.findFirst({ where: { expenseId }, select: { id: true } }),
      this.prisma.chairRentPayment.findFirst({
        where: { memberExpenseId: expenseId },
        select: { id: true },
      }),
    ]);
    if (payEntry || payout) {
      throw new BadRequestException(
        'Essa despesa veio do pagamento da equipe. Desfaça por lá (Pagamento da equipe).',
      );
    }
    if (rent) {
      throw new BadRequestException(
        'Essa despesa veio do aluguel da cadeira. Desfaça o pagamento do aluguel por lá.',
      );
    }
    await this.prisma.expense.delete({ where: { id: expenseId } });
    return true;
  }

  // ============ FINANCIAL DASHBOARD ============

  async getFinancialSummary(userId: number, barbershopId: number, from: Date, to: Date) {
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const timeZone = safeTimeZone(barbershop.timezone);
    const [sales, expenses] = await Promise.all([
      this.prisma.sale.findMany({
        where: {
          barbershopId,
          paymentStatus: 'PAID',
          ...paidInRange({ gte: from, lte: to }),
        },
        select: {
          total: true,
          depositApplied: true,
          prepaidApplied: true,
          paymentMethod: true,
          createdAt: true,
          paidAt: true,
        },
      }),
      this.prisma.expense.findMany({
        where: { barbershopId, expenseDate: { gte: from, lte: to } },
        select: { amount: true, category: true },
      }),
    ]);
    const kept = await this.retainedPrepayments(barbershopId, { gte: from, lte: to });

    const totalRevenue =
      sales.reduce((sum, s) => sum + saleRevenue(s), 0) +
      kept.reduce((sum, k) => sum + k.deposit + k.prepaid, 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
    // Aluguel da cadeira que o espaço recebeu direto (PIX, dinheiro...). O
    // que entra pelo cartão fica na plataforma até o repasse
    const rent = await this.prisma.chairRentPayment.aggregate({
      where: {
        link: { hostBarbershopId: barbershopId },
        status: 'SUCCEEDED',
        method: { not: 'CARD' },
        paidAt: { gte: from, lte: to },
      },
      _sum: { amount: true },
    });
    const chairRentIncome = Number(rent._sum.amount ?? 0);

    // Sinal e pago pelo app em linhas próprias: entraram antes, não pela
    // forma da venda
    const byMethod = new Map<string, number>();
    const addTo = (key: string, value: number) => {
      if (value) byMethod.set(key, round2((byMethod.get(key) ?? 0) + value));
    };
    sales.forEach((s) => {
      addTo(s.paymentMethod ?? 'UNKNOWN', Number(s.total));
      addTo('DEPOSIT', Number(s.depositApplied ?? 0));
      addTo('APP', Number(s.prepaidApplied ?? 0));
    });
    kept.forEach((k) => {
      addTo('DEPOSIT', k.deposit);
      addTo('APP', k.prepaid);
    });

    const byCategory = new Map<string, number>();
    expenses.forEach((e) => {
      byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + Number(e.amount));
    });

    const byDay = new Map<string, number>();
    sales.forEach((s) => {
      // Dia no fuso da unidade — em UTC, venda depois das 21h em Brasília
      // caía no dia seguinte do gráfico
      const key = toZonedParts(s.paidAt ?? s.createdAt, timeZone).dateStr;
      byDay.set(key, round2((byDay.get(key) ?? 0) + saleRevenue(s)));
    });
    kept.forEach((k) => {
      const key = toZonedParts(k.date, timeZone).dateStr;
      byDay.set(key, round2((byDay.get(key) ?? 0) + k.deposit + k.prepaid));
    });
    const sortedDays = Array.from(byDay.keys()).sort();

    return {
      totalRevenue,
      totalExpenses,
      chairRentIncome,
      netProfit: totalRevenue + chairRentIncome - totalExpenses,
      revenueByPaymentMethod: Array.from(byMethod.entries()).map(([category, total]) => ({
        category,
        total,
      })),
      expensesByCategory: Array.from(byCategory.entries()).map(([category, total]) => ({
        category,
        total,
      })),
      revenueByDay: {
        labels: sortedDays,
        data: sortedDays.map((d) => byDay.get(d) ?? 0),
      },
    };
  }

  /**
   * Sinal e atendimento pago pelo app que ficaram com a unidade sem virar
   * venda: o cliente faltou ou cancelou fora do prazo e não houve estorno
   * (ou só parte). Conta no dia do horário. Antes esse dinheiro não aparecia
   * no faturamento.
   */
  private async retainedPrepayments(barbershopId: number, range: Prisma.DateTimeFilter) {
    const appts = await this.prisma.appointment.findMany({
      where: {
        barbershopId,
        status: { in: ['NO_SHOW', 'CANCELLED'] },
        sale: null,
        startAt: range,
        OR: [
          { depositPaid: true, depositPaidAt: { not: null }, depositRefundedAt: null },
          { prepaidAt: { not: null }, prepaidRefundedAt: null },
        ],
      },
      select: {
        startAt: true,
        depositPaid: true,
        depositPaidAt: true,
        depositAmount: true,
        depositRefundedAt: true,
        prepaidAt: true,
        prepaidAmount: true,
        prepaidRefundedAt: true,
        prepaidRefundedAmount: true,
      },
    });
    return appts.map((a) => ({
      date: a.startAt,
      deposit:
        a.depositPaid && a.depositPaidAt && !a.depositRefundedAt ? Number(a.depositAmount ?? 0) : 0,
      prepaid:
        a.prepaidAt && !a.prepaidRefundedAt
          ? Math.max(0, Number(a.prepaidAmount ?? 0) - Number(a.prepaidRefundedAmount ?? 0))
          : 0,
    }));
  }

  // ============ RESOURCES ============

  async getResources(userId: number, barbershopId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'basic');
    return this.prisma.resource.findMany({
      where: { barbershopId },
      orderBy: { name: 'asc' },
    });
  }

  async createResource(
    userId: number,
    barbershopId: number,
    data: { name: string; type?: string },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    return this.prisma.resource.create({
      data: {
        barbershopId,
        name: resourceName(data.name),
        type: resourceType(data.type ?? 'ROOM'),
      },
    });
  }

  async updateResource(
    userId: number,
    barbershopId: number,
    resourceId: number,
    data: Partial<{ name: string; type: string; isActive: boolean }>,
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const resource = await this.prisma.resource.findFirst({
      where: { id: resourceId, barbershopId },
    });
    if (!resource) throw new NotFoundException('Recurso não encontrado');
    return this.prisma.resource.update({
      where: { id: resourceId },
      data: {
        ...(data.name !== undefined ? { name: resourceName(data.name) } : {}),
        ...(data.type !== undefined ? { type: resourceType(data.type) } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
    });
  }

  async deleteResource(userId: number, barbershopId: number, resourceId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const resource = await this.prisma.resource.findFirst({
      where: { id: resourceId, barbershopId },
    });
    if (!resource) throw new NotFoundException('Recurso não encontrado');
    // Apagar soltava a sala dos horários em silêncio (ON DELETE SET NULL)
    const upcoming = await this.prisma.appointment.count({
      where: {
        resourceId,
        status: { in: ['CONFIRMED', 'PENDING_PAYMENT', 'IN_PROGRESS'] },
        endAt: { gt: new Date() },
      },
    });
    if (upcoming > 0) throw new BadRequestException(RESOURCE_IN_USE_MESSAGE);
    // Com horário no passado: desativa, pro histórico continuar com a sala
    const used = await this.prisma.appointment.findFirst({
      where: { resourceId },
      select: { id: true },
    });
    if (used) {
      await this.prisma.resource.update({ where: { id: resourceId }, data: { isActive: false } });
    } else {
      await this.prisma.resource.delete({ where: { id: resourceId } });
    }
    return true;
  }

  // ============ PACOTES DE SESSÃO ============

  async getServicePackages(userId: number, barbershopId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const packages = await this.prisma.servicePackage.findMany({
      where: { barbershopId },
      include: { service: true },
      orderBy: { name: 'asc' },
    });
    return packages.map((p) => ({ ...p, serviceName: p.service?.name ?? null }));
  }

  async createServicePackage(
    userId: number,
    barbershopId: number,
    data: {
      serviceId: number;
      name: string;
      totalSessions: number;
      price: number;
      validityDays?: number | null;
    },
  ) {
    const shop = await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    checkMoney('Preço', data.price, shop.currency);
    checkSessionCount('Sessões', data.totalSessions);
    checkSessionCount('Validade', data.validityDays);
    await this.ensureModuleAccess(barbershopId, 'packages');
    const service = await this.prisma.barbershopService.findFirst({
      where: { id: data.serviceId, barbershopId },
    });
    if (!service) throw new NotFoundException('Serviço não encontrado');
    const pkg = await this.prisma.servicePackage.create({
      data: {
        barbershopId,
        serviceId: data.serviceId,
        name: data.name,
        totalSessions: data.totalSessions,
        price: new Decimal(data.price),
        validityDays: data.validityDays ?? null,
      },
      include: { service: true },
    });
    return { ...pkg, serviceName: pkg.service?.name ?? null };
  }

  async updateServicePackage(
    userId: number,
    barbershopId: number,
    id: number,
    data: Partial<{
      name: string;
      totalSessions: number;
      price: number;
      isActive: boolean;
      validityDays: number | null;
    }>,
  ) {
    const shop = await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const pkg = await this.prisma.servicePackage.findFirst({ where: { id, barbershopId } });
    if (!pkg) throw new NotFoundException('Pacote não encontrado');
    checkMoney('Preço', data.price, shop.currency);
    checkSessionCount('Sessões', data.totalSessions);
    if (data.validityDays != null) checkSessionCount('Validade', data.validityDays);
    const { price, ...rest } = data;
    const updated = await this.prisma.servicePackage.update({
      where: { id },
      data: { ...rest, price: price != null ? new Decimal(price) : undefined },
      include: { service: true },
    });
    return { ...updated, serviceName: updated.service?.name ?? null };
  }

  async deleteServicePackage(userId: number, barbershopId: number, id: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const pkg = await this.prisma.servicePackage.findFirst({ where: { id, barbershopId } });
    if (!pkg) throw new NotFoundException('Pacote não encontrado');
    await this.prisma.servicePackage.update({ where: { id }, data: { isActive: false } });
    return true;
  }

  // ============ PACOTES DO CLIENTE ============

  private toClientPackageResult(cp: any) {
    return {
      ...cp,
      servicePackageName: cp.servicePackage?.name ?? null,
      serviceId: cp.servicePackage?.serviceId ?? null,
      serviceName: cp.servicePackage?.service?.name ?? null,
      expiresAt: cp.expiresAt ? new Date(cp.expiresAt).toISOString() : null,
      uses: (cp.uses ?? []).map((use: any) => ({
        id: use.id,
        createdAt: new Date(use.createdAt).toISOString(),
        appointmentId: use.appointmentId ?? null,
        saleId: use.saleId ?? null,
        usedByName: use.usedByName ?? null,
        undoneAt: use.undoneAt ? new Date(use.undoneAt).toISOString() : null,
      })),
    };
  }

  async purchaseClientPackage(
    userId: number,
    barbershopId: number,
    data: { customerId: number; servicePackageId: number; paymentMethod?: string | null },
  ) {
    // Vender pacote é receber dinheiro: da recepção pra cima (antes qualquer
    // barbeiro dava um pacote de graça)
    const barbershop = await this.ensureBarbershopAccess(userId, barbershopId, 'reception');
    await this.ensureCustomerOfNetwork(barbershop.networkId, data.customerId);
    await this.ensureModuleAccess(barbershopId, 'packages');
    const pkg = await this.prisma.servicePackage.findFirst({
      where: { id: data.servicePackageId, barbershopId, isActive: true },
      include: { service: { select: { isActive: true } } },
    });
    if (!pkg) throw new NotFoundException('Pacote não encontrado');
    if (!pkg.service.isActive) {
      throw new BadRequestException(
        'Este pacote não está mais à venda porque o serviço foi desativado.',
      );
    }
    const clientPackage = await this.prisma.$transaction(async (tx) => {
      const sale = await this.recordStandaloneSale(tx, barbershopId, {
        customerId: data.customerId,
        itemType: 'PACKAGE',
        amount: Number(pkg.price),
        notes: `Pacote — ${pkg.name}`,
        paymentMethod: data.paymentMethod,
      });
      return tx.clientPackage.create({
        data: {
          barbershopId,
          customerId: data.customerId,
          servicePackageId: pkg.id,
          totalSessions: pkg.totalSessions,
          saleId: sale.id,
          expiresAt: pkg.validityDays ? new Date(Date.now() + pkg.validityDays * 86_400_000) : null,
        },
        include: { servicePackage: { include: { service: true } } },
      });
    });
    return this.toClientPackageResult(clientPackage);
  }

  /**
   * Venda avulsa de pacote ou cartão-presente: entra no faturamento como
   * qualquer venda. Com a forma de pagamento já sai paga (e no caixa aberto);
   * sem ela fica pendente, pra receber depois pela tela de vendas.
   */
  private async recordStandaloneSale(
    tx: Prisma.TransactionClient,
    barbershopId: number,
    data: {
      customerId?: number | null;
      itemType: 'PACKAGE' | 'GIFT_CARD';
      amount: number;
      notes: string;
      paymentMethod?: string | null;
    },
  ) {
    checkSaleKinds({ paymentMethod: data.paymentMethod });
    const paid = !!data.paymentMethod;
    const openSession = paid
      ? await tx.cashSession.findFirst({
          where: { barbershopId, status: 'OPEN' },
          select: { id: true },
        })
      : null;
    const amount = new Decimal(round2(data.amount));
    return tx.sale.create({
      data: {
        barbershopId,
        customerId: data.customerId ?? null,
        cashSessionId: openSession?.id ?? null,
        saleType: data.itemType,
        subtotal: amount,
        total: amount,
        paymentStatus: paid ? 'PAID' : 'PENDING',
        paymentMethod: data.paymentMethod ?? null,
        paidAt: paid ? new Date() : null,
        items: {
          create: [
            {
              itemType: data.itemType,
              quantity: 1,
              unitPrice: amount,
              totalPrice: amount,
              notes: data.notes,
            },
          ],
        },
      },
    });
  }

  async getClientPackages(userId: number, barbershopId: number, customerId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId);
    const packages = await this.prisma.clientPackage.findMany({
      where: { barbershopId, customerId },
      include: {
        servicePackage: { include: { service: true } },
        uses: { where: { undoneAt: null }, orderBy: { createdAt: 'desc' }, take: 8 },
      },
      orderBy: { createdAt: 'desc' },
    });
    const names = await this.userNames(packages.flatMap((p) => p.uses.map((u) => u.usedByUserId)));
    return packages.map((p) =>
      this.toClientPackageResult({
        ...p,
        uses: p.uses.map((u) => ({ ...u, usedByName: names.get(u.usedByUserId) ?? null })),
      }),
    );
  }

  private async userNames(ids: number[]) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map<number, string>();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, fullName: true },
    });
    return new Map(users.map((u) => [u.id, u.fullName]));
  }

  async debitClientPackageSession(userId: number, barbershopId: number, clientPackageId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'reception');
    const clientPackage = await this.prisma.clientPackage.findFirst({
      where: { id: clientPackageId, barbershopId },
    });
    if (!clientPackage) throw new NotFoundException('Pacote do cliente não encontrado');
    if (clientPackage.status !== 'ACTIVE') {
      throw new BadRequestException('Pacote não está ativo');
    }
    if (clientPackage.expiresAt && clientPackage.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Este pacote venceu.');
    }
    // Baixa condicional no banco (mesma ideia dos pontos de fidelidade):
    // débitos simultâneos não passam do total de sessões do pacote
    const debited = await this.prisma.$executeRaw`
      UPDATE "ClientPackage"
      SET "usedSessions" = "usedSessions" + 1,
          status = CASE WHEN "usedSessions" + 1 >= "totalSessions" THEN 'COMPLETED' ELSE 'ACTIVE' END,
          "updatedAt" = NOW()
      WHERE id = ${clientPackageId} AND status = 'ACTIVE' AND "usedSessions" < "totalSessions"
        AND ("expiresAt" IS NULL OR "expiresAt" > NOW())`;
    if (debited === 0) {
      throw new BadRequestException('Pacote não tem sessões restantes');
    }
    await this.prisma.clientPackageUse.create({
      data: { clientPackageId, usedByUserId: userId },
    });
    const updated = await this.prisma.clientPackage.findUniqueOrThrow({
      where: { id: clientPackageId },
      include: { servicePackage: { include: { service: true } } },
    });
    return this.toClientPackageResult(updated);
  }

  /** Desfaz uma baixa feita na ficha (sem venda). A da conta se desfaz ao apagar a venda. */
  async undoClientPackageUse(userId: number, barbershopId: number, useId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'reception');
    const use = await this.prisma.clientPackageUse.findFirst({
      where: { id: useId, clientPackage: { barbershopId } },
    });
    if (!use) throw new NotFoundException('Baixa não encontrada');
    if (use.undoneAt) throw new BadRequestException('Esta baixa já foi desfeita.');
    if (use.saleId) {
      throw new BadRequestException(
        'A baixa deste pacote está na venda. Apague a venda para desfazer.',
      );
    }
    const pkg = await this.prisma.clientPackage.findUnique({
      where: { id: use.clientPackageId },
      select: { status: true, remainderRefundedAt: true },
    });
    if (pkg?.status === 'CANCELLED' || pkg?.remainderRefundedAt) {
      throw new BadRequestException(PACKAGE_UNDO_CLOSED_MESSAGE);
    }
    const restored = await this.prisma.clientPackage.updateMany({
      where: { id: use.clientPackageId, usedSessions: { gt: 0 }, ...RESTORABLE_PACKAGE },
      data: { usedSessions: { decrement: 1 }, status: 'ACTIVE' },
    });
    if (restored.count === 0) throw new BadRequestException('Pacote não tem sessões restantes');
    await this.prisma.clientPackageUse.update({
      where: { id: use.id },
      data: { undoneAt: new Date(), undoneByUserId: userId },
    });
    return true;
  }

  // ============ FICHA DE ANAMNESE / CONSENTIMENTO ============

  /**
   * Quem vê as respostas de saúde: gerência e dono, e o profissional que tem
   * horário com o cliente (passado recente ou futuro). A recepção vê a ficha
   * e se está assinada, sem as respostas. Os outros não veem a ficha de saúde.
   */
  private async healthFormView(
    userId: number,
    barbershop: { id: number; accessLevel: AccessLevel },
    customerId: number,
  ): Promise<'full' | 'status' | 'none'> {
    if (ACCESS_RANK[barbershop.accessLevel] >= ACCESS_RANK.manager) return 'full';
    if (barbershop.accessLevel === 'reception') return 'status';
    const own = await this.ownBarberIdIfBarber(userId, barbershop);
    if (own == null || own < 0) return 'none';
    const since = new Date(Date.now() - HEALTH_FORM_LOOKBACK_DAYS * 86_400_000);
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        barbershopId: barbershop.id,
        customerId,
        barberId: own,
        status: { not: 'CANCELLED' },
        startAt: { gte: since },
      },
      select: { id: true },
    });
    return appointment ? 'full' : 'none';
  }

  async createConsentForm(
    userId: number,
    barbershopId: number,
    data: {
      customerId: number;
      formType: string;
      category?: string;
      answers?: string;
      expiresAt?: string;
      healthConsent?: boolean;
    },
  ) {
    const shop = await this.ensureBarbershopAccess(userId, barbershopId);
    await this.ensureModuleAccess(barbershopId, 'packages');
    if (HEALTH_FORM_TYPES.includes(data.formType)) {
      const view = await this.healthFormView(userId, shop, data.customerId);
      if (view === 'none' || (view === 'status' && !!data.answers?.trim())) {
        throw new ForbiddenException('Você não pode ver os dados de saúde deste cliente.');
      }
    }
    const customer = await this.prisma.customer.findFirst({
      where: { id: data.customerId, network: { barbershops: { some: { id: barbershopId } } } },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado');
    // Dado de saúde é sensível (LGPD, art. 11): só com o consentimento do
    // cliente, específico para esta ficha
    const health = HEALTH_FORM_TYPES.includes(data.formType) && !!data.answers?.trim();
    if (health && !data.healthConsent) {
      throw new BadRequestException(
        'Para registrar dados de saúde (alergias, condições), confirme que o cliente autorizou',
      );
    }
    return this.prisma.consentForm.create({
      data: {
        barbershopId,
        customerId: data.customerId,
        formType: data.formType,
        category: data.category,
        answers: data.answers,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
        ...(health ? { healthConsentAt: new Date(), healthConsentByUserId: userId } : {}),
      },
    });
  }

  /**
   * O cliente revogou o consentimento: as respostas de saúde são apagadas.
   * Fica só o registro de que houve consentimento e de quando foi revogado.
   */
  async revokeHealthConsent(userId: number, barbershopId: number, id: number) {
    const shop = await this.ensureBarbershopAccess(userId, barbershopId);
    const form = await this.prisma.consentForm.findFirst({ where: { id, barbershopId } });
    if (!form) throw new NotFoundException('Ficha não encontrada');
    if ((await this.healthFormView(userId, shop, form.customerId)) !== 'full') {
      throw new ForbiddenException('Você não pode ver os dados de saúde deste cliente.');
    }
    if (!form.healthConsentAt || form.healthConsentRevokedAt) return form;
    return this.prisma.consentForm.update({
      where: { id },
      data: { answers: null, healthConsentRevokedAt: new Date() },
    });
  }

  async getConsentForms(userId: number, barbershopId: number, customerId: number) {
    const shop = await this.ensureBarbershopAccess(userId, barbershopId);
    const view = await this.healthFormView(userId, shop, customerId);
    const forms = await this.prisma.consentForm.findMany({
      where: { barbershopId, customerId, status: { not: 'ARCHIVED' } },
      orderBy: { createdAt: 'desc' },
    });
    const now = new Date();
    return forms
      .filter((f) => view !== 'none' || !HEALTH_FORM_TYPES.includes(f.formType))
      .map((f) => ({
        ...f,
        answers: HEALTH_FORM_TYPES.includes(f.formType) && view !== 'full' ? null : f.answers,
        status: f.status === 'SIGNED' && f.expiresAt && f.expiresAt < now ? 'EXPIRED' : f.status,
      }));
  }

  async signConsentForm(userId: number, barbershopId: number, id: number, signatureName: string) {
    const shop = await this.ensureBarbershopAccess(userId, barbershopId);
    const form = await this.prisma.consentForm.findFirst({ where: { id, barbershopId } });
    if (!form) throw new NotFoundException('Ficha não encontrada');
    if (form.status !== 'PENDING' || form.signedAt || form.healthConsentRevokedAt) {
      throw new BadRequestException(
        'Só dá para assinar uma ficha que ainda está pendente e sem o consentimento revogado.',
      );
    }
    if (
      HEALTH_FORM_TYPES.includes(form.formType) &&
      (await this.healthFormView(userId, shop, form.customerId)) === 'none'
    ) {
      throw new ForbiddenException('Você não pode ver os dados de saúde deste cliente.');
    }
    return this.prisma.consentForm.update({
      where: { id },
      data: { signatureName, signedAt: new Date(), status: 'SIGNED' },
    });
  }

  async deleteConsentForm(userId: number, barbershopId: number, id: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const form = await this.prisma.consentForm.findFirst({ where: { id, barbershopId } });
    if (!form) throw new NotFoundException('Ficha não encontrada');
    if (form.status === 'ARCHIVED') return true;
    // Assinada (ou vencida depois de assinada): sai da lista e o registro fica
    if (form.status === 'SIGNED' || form.signedAt) {
      await this.prisma.consentForm.update({
        where: { id },
        data: { status: 'ARCHIVED' },
      });
      return true;
    }
    await this.prisma.consentForm.delete({ where: { id } });
    return true;
  }

  // ============ COMISSÃO ============

  async getCommissionRules(userId: number, barbershopId: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const rules = await this.prisma.commissionRule.findMany({
      where: { barbershopId },
      include: { barber: true },
      orderBy: [{ barberId: 'asc' }, { itemType: 'asc' }],
    });
    return rules.map((r) => ({ ...r, barberName: r.barber?.name ?? null }));
  }

  async setCommissionRule(
    userId: number,
    barbershopId: number,
    data: { barberId?: number; itemType?: string; percentage: number },
  ) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const itemType = data.itemType ?? 'ALL';
    // Outro texto ("service") criava uma regra que nunca se aplica
    if (!COMMISSION_ITEM_TYPES.includes(itemType)) {
      throw new BadRequestException(COMMISSION_ITEM_TYPE_INVALID_MESSAGE);
    }
    if (!Number.isFinite(data.percentage) || data.percentage < 0 || data.percentage > 100) {
      throw new BadRequestException('A comissão tem que ser de 0% a 100%');
    }
    if (data.barberId) {
      const barber = await this.prisma.barber.findFirst({
        where: { id: data.barberId, barbershopId },
      });
      if (!barber) throw new NotFoundException('Profissional não encontrado');
      await this.ensureNotOwnCommission(userId, barbershopId, barber.userId);
    }
    // Upsert manual: a chave única usa barberId nullable, que o Prisma não aceita
    // direto em upsert.where com null — findFirst + create/update, sob trava da
    // unidade (dois cliques criavam duas regras padrão: NULL não repete no índice)
    const rule = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`commission:${barbershopId}`}))`;
      const existing = await tx.commissionRule.findFirst({
        where: { barbershopId, barberId: data.barberId ?? null, itemType },
        orderBy: { id: 'desc' },
      });
      return existing
        ? tx.commissionRule.update({
            where: { id: existing.id },
            data: { percentage: new Decimal(data.percentage) },
            include: { barber: true },
          })
        : tx.commissionRule.create({
            data: {
              barbershopId,
              barberId: data.barberId,
              itemType,
              percentage: new Decimal(data.percentage),
            },
            include: { barber: true },
          });
    });
    return { ...rule, barberName: rule.barber?.name ?? null };
  }

  async deleteCommissionRule(userId: number, barbershopId: number, id: number) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    const rule = await this.prisma.commissionRule.findFirst({
      where: { id, barbershopId },
      include: { barber: { select: { userId: true } } },
    });
    if (!rule) throw new NotFoundException('Regra de comissão não encontrada');
    if (rule.barber) await this.ensureNotOwnCommission(userId, barbershopId, rule.barber.userId);
    await this.prisma.commissionRule.delete({ where: { id } });
    return true;
  }

  /**
   * Gerente que também atende não mexe na própria comissão (definia 500% pra
   * si e pagava no fechamento); quem decide é o dono
   */
  private async ensureNotOwnCommission(
    userId: number,
    barbershopId: number,
    barberUserId: number | null,
  ) {
    if (barberUserId !== userId) return;
    if ((await this.getMyAccessLevel(userId, barbershopId)) !== 'owner') {
      throw new ForbiddenException('A sua comissão é definida pelo dono');
    }
  }

  async getCommissionReport(userId: number, barbershopId: number, from: Date, to: Date) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    return this.computeCommissions(barbershopId, from, to);
  }

  /**
   * Comissão de cada profissional nas vendas pagas do período (regras da
   * unidade: do profissional por tipo > do profissional "tudo" > da unidade
   * por tipo > da unidade "tudo"). Sem checagem de acesso: quem chama checa.
   * Usado no relatório de comissões e no pagamento da equipe.
   */
  /**
   * Valor de uma sessão coberta (serviço com preço 0 na venda): no pacote, o
   * que o cliente pagou dividido pelas sessões; no clube, o preço do serviço.
   */
  private async coveredSessionValues(
    sales: Array<{ id: number; clientSubscriptionId: number | null }>,
  ) {
    const uses = await this.prisma.clientPackageUse.findMany({
      where: { saleId: { in: sales.map((s) => s.id) }, undoneAt: null },
      select: {
        saleId: true,
        clientPackage: {
          select: {
            totalSessions: true,
            sale: { select: { total: true } },
            servicePackage: { select: { serviceId: true, price: true, totalSessions: true } },
          },
        },
      },
    });
    const bySale = new Map<number, { serviceId: number; value: number }>();
    for (const u of uses) {
      const pkg = u.clientPackage;
      const paid = pkg.sale ? Number(pkg.sale.total) : Number(pkg.servicePackage.price);
      const sessions = pkg.sale ? pkg.totalSessions : pkg.servicePackage.totalSessions;
      if (u.saleId != null && sessions > 0) {
        bySale.set(u.saleId, { serviceId: pkg.servicePackage.serviceId, value: paid / sessions });
      }
    }
    const subIds = [
      ...new Set(sales.map((s) => s.clientSubscriptionId).filter((id): id is number => id != null)),
    ];
    const clubService = new Map(
      (
        await this.prisma.clientSubscription.findMany({
          where: { id: { in: subIds } },
          select: { id: true, plan: { select: { serviceId: true } } },
        })
      ).map((s) => [s.id, s.plan.serviceId]),
    );
    return (
      sale: { id: number; clientSubscriptionId: number | null },
      item: { serviceId: number | null; service: { price: Prisma.Decimal } | null },
    ) => {
      const pkg = bySale.get(sale.id);
      if (pkg && pkg.serviceId === item.serviceId) return pkg.value;
      if (
        sale.clientSubscriptionId != null &&
        clubService.get(sale.clientSubscriptionId) === item.serviceId &&
        item.service
      ) {
        return Number(item.service.price);
      }
      return 0;
    };
  }

  /** Pagamento de comissão do profissional da venda que já cobriu a data dela */
  private async paidCommissionPayout(sale: {
    barberId: number | null;
    paymentStatus: string;
    paidAt: Date | null;
    createdAt: Date;
  }) {
    if (sale.barberId == null || sale.paymentStatus !== 'PAID') return null;
    const date = sale.paidAt ?? sale.createdAt;
    return this.prisma.barberPayout.findFirst({
      where: { barberId: sale.barberId, periodStart: { lte: date }, periodEnd: { gte: date } },
      select: { id: true },
    });
  }

  /** Comissão desta venda para o profissional (0 se não é paga ou não é dele) */
  private async saleCommission(barbershopId: number, saleId: number, barberId: number) {
    const { rows } = await this.computeCommissions(barbershopId, new Date(0), new Date(0), [
      saleId,
    ]);
    return round2(rows.find((r) => r.barberId === barberId)?.totalCommission ?? 0);
  }

  /**
   * Venda de período com a comissão já paga mudou: a diferença vira bônus
   * ou desconto no período em aberto do profissional (o que foi pago fica).
   */
  private async commissionAdjustment(
    client: Prisma.TransactionClient,
    barbershopId: number,
    barberId: number,
    delta: number,
    userId: number,
    note: string,
  ) {
    const amount = round2(Math.abs(delta));
    if (amount < 0.01) return;
    await client.barberPayEntry.create({
      data: {
        barbershopId,
        barberId,
        type: delta > 0 ? 'BONUS' : 'DEDUCTION',
        amount: new Decimal(amount),
        date: new Date(),
        notes: note,
        createdByUserId: userId,
      },
    });
  }

  /** Comissão por profissional no período (ou só das vendas `saleIds`, sem olhar a data) */
  async computeCommissions(barbershopId: number, from: Date, to: Date, saleIds?: number[]) {
    const [rules, sales, barbers] = await Promise.all([
      this.prisma.commissionRule.findMany({ where: { barbershopId } }),
      this.prisma.sale.findMany({
        where: {
          barbershopId,
          paymentStatus: 'PAID',
          barberId: { not: null },
          ...(saleIds
            ? { id: { in: saleIds } }
            : {
                // Pela data em que foi paga: venda criada pendente e paga depois do
                // fechamento daquele mês não entrava em nenhum fechamento
                OR: [
                  { paidAt: { gte: from, lte: to } },
                  { paidAt: null, createdAt: { gte: from, lte: to } },
                ],
              }),
        },
        include: { items: { include: { service: { select: { price: true } } } } },
      }),
      this.prisma.barber.findMany({ where: { barbershopId } }),
    ]);
    const barberNameMap = new Map(barbers.map((b) => [b.id, b.name]));
    const sessionValue = await this.coveredSessionValues(sales);

    const resolvePercentage = (barberId: number, itemType: string): number => {
      const exact = rules.find((r) => r.barberId === barberId && r.itemType === itemType);
      if (exact) return Number(exact.percentage);
      const barberAll = rules.find((r) => r.barberId === barberId && r.itemType === 'ALL');
      if (barberAll) return Number(barberAll.percentage);
      const shopType = rules.find((r) => r.barberId == null && r.itemType === itemType);
      if (shopType) return Number(shopType.percentage);
      const shopAll = rules.find((r) => r.barberId == null && r.itemType === 'ALL');
      if (shopAll) return Number(shopAll.percentage);
      return 0;
    };

    const byBarber = new Map<
      number,
      {
        salesCount: number;
        totalServiceSales: number;
        totalProductSales: number;
        serviceCommission: number;
        productCommission: number;
      }
    >();

    for (const sale of sales) {
      const barberId = sale.barberId as number;
      let acc = byBarber.get(barberId);
      if (!acc) {
        acc = {
          salesCount: 0,
          totalServiceSales: 0,
          totalProductSales: 0,
          serviceCommission: 0,
          productCommission: 0,
        };
        byBarber.set(barberId, acc);
      }
      // Estorno (valor negativo) desconta a comissão, mas não é uma venda a mais
      if (sale.saleType !== REFUND_SALE_TYPE) acc.salesCount++;
      // O desconto dado na venda reduz a base da comissão na proporção de
      // cada item (antes contava o preço cheio dos itens)
      const itemsSum = sale.items.reduce((sum, i) => sum + Number(i.totalPrice), 0);
      const discount = Number(sale.discountAmount ?? 0);
      const factor =
        itemsSum > 0 ? Math.max(0, itemsSum - discount) / itemsSum : itemsSum < 0 ? 1 : 0;
      for (const item of sale.items) {
        // Serviço coberto pelo pacote ou pelo clube entra com preço 0: a
        // comissão sai sobre o valor da sessão (antes quem atendia não
        // recebia nada por esses atendimentos)
        const covered =
          item.itemType === 'SERVICE' && Number(item.totalPrice) === 0 && item.serviceId != null
            ? sessionValue(sale, item)
            : 0;
        if (covered > 0) {
          // Uma baixa por venda: a comissão é de uma sessão
          const pct = resolvePercentage(barberId, 'SERVICE');
          acc.serviceCommission += (covered * pct) / 100;
          continue;
        }
        const total = Number(item.totalPrice) * factor;
        const pct = resolvePercentage(barberId, item.itemType);
        if (item.itemType === 'PRODUCT') {
          acc.totalProductSales += total;
          acc.productCommission += (total * pct) / 100;
        } else {
          acc.totalServiceSales += total;
          acc.serviceCommission += (total * pct) / 100;
        }
      }
    }

    const rows = Array.from(byBarber.entries()).map(([barberId, acc]) => ({
      barberId,
      barberName: barberNameMap.get(barberId) ?? `#${barberId}`,
      salesCount: acc.salesCount,
      totalServiceSales: acc.totalServiceSales,
      totalProductSales: acc.totalProductSales,
      serviceCommission: acc.serviceCommission,
      productCommission: acc.productCommission,
      totalCommission: acc.serviceCommission + acc.productCommission,
    }));
    rows.sort((a, b) => b.totalCommission - a.totalCommission);

    return {
      rows,
      totalCommission: rows.reduce((sum, r) => sum + r.totalCommission, 0),
    };
  }

  // ============ RELATÓRIOS AVANÇADOS (plano Premium) ============

  async getAdvancedReports(userId: number, barbershopId: number, from: Date, to: Date) {
    await this.ensureBarbershopAccess(userId, barbershopId, 'manager');
    await this.ensureModuleAccess(barbershopId, 'reports');

    const [appointments, saleItems, customersInPeriod, paidSales, statusGroups, walkIns] =
      await Promise.all([
        // Taxa de não-comparecimento: só entre agendamentos que de fato
        // chegaram no horário marcado (COMPLETED ou NO_SHOW) — CANCELLED e
        // outros status não representam "cliente não apareceu".
        this.prisma.appointment.findMany({
          where: {
            barbershopId,
            startAt: { gte: from, lte: to },
            status: { in: ['COMPLETED', 'NO_SHOW'] },
          },
          include: {
            barber: { select: { id: true, name: true } },
            services: { include: { service: { select: { id: true, name: true } } } },
          },
        }),
        this.prisma.saleItem.findMany({
          where: {
            sale: { barbershopId, paymentStatus: 'PAID', ...paidInRange({ gte: from, lte: to }) },
          },
          include: {
            service: { select: { id: true, name: true } },
            product: { select: { id: true, name: true } },
          },
        }),
        this.prisma.sale.findMany({
          where: {
            barbershopId,
            paymentStatus: 'PAID',
            ...paidInRange({ gte: from, lte: to }),
            customerId: { not: null },
          },
          select: { customerId: true },
          distinct: ['customerId'],
        }),
        this.prisma.sale.findMany({
          where: { barbershopId, paymentStatus: 'PAID', ...paidInRange({ gte: from, lte: to }) },
          select: {
            total: true,
            barberId: true,
            barber: { select: { id: true, name: true } },
          },
        }),
        this.prisma.appointment.groupBy({
          by: ['status'],
          where: { barbershopId, startAt: { gte: from, lte: to } },
          _count: { _all: true },
        }),
        this.prisma.walkIn.count({
          where: {
            barbershopId,
            createdAt: { gte: from, lte: to },
            status: { not: 'CANCELLED' },
          },
        }),
      ]);

    // --- Taxa de não-comparecimento geral, por barbeiro e por serviço ---
    let totalNoShow = 0;
    const byBarber = new Map<number, { name: string; noShow: number; completed: number }>();
    const byService = new Map<number, { name: string; noShow: number; completed: number }>();

    for (const appt of appointments) {
      const isNoShow = appt.status === 'NO_SHOW';
      if (isNoShow) totalNoShow++;

      let barberAcc = byBarber.get(appt.barberId);
      if (!barberAcc) {
        barberAcc = { name: appt.barber.name, noShow: 0, completed: 0 };
        byBarber.set(appt.barberId, barberAcc);
      }
      if (isNoShow) barberAcc.noShow++;
      else barberAcc.completed++;

      for (const s of appt.services) {
        if (!s.service) continue;
        let serviceAcc = byService.get(s.service.id);
        if (!serviceAcc) {
          serviceAcc = { name: s.service.name, noShow: 0, completed: 0 };
          byService.set(s.service.id, serviceAcc);
        }
        if (isNoShow) serviceAcc.noShow++;
        else serviceAcc.completed++;
      }
    }

    const toRate = (noShow: number, completed: number) =>
      noShow + completed > 0 ? noShow / (noShow + completed) : 0;

    const noShowByBarber = Array.from(byBarber.entries())
      .map(([barberId, acc]) => ({
        barberId,
        barberName: acc.name,
        noShowCount: acc.noShow,
        completedCount: acc.completed,
        rate: toRate(acc.noShow, acc.completed),
      }))
      .sort((a, b) => b.rate - a.rate);

    const noShowByService = Array.from(byService.entries())
      .map(([serviceId, acc]) => ({
        serviceId,
        serviceName: acc.name,
        noShowCount: acc.noShow,
        completedCount: acc.completed,
        rate: toRate(acc.noShow, acc.completed),
      }))
      .sort((a, b) => b.rate - a.rate);

    // --- Serviços e produtos mais vendidos (por receita) ---
    const serviceSales = new Map<number, { name: string; quantity: number; revenue: number }>();
    const productSales = new Map<number, { name: string; quantity: number; revenue: number }>();

    for (const item of saleItems) {
      if (item.itemType === 'SERVICE' && item.service) {
        let acc = serviceSales.get(item.service.id);
        if (!acc) {
          acc = { name: item.service.name, quantity: 0, revenue: 0 };
          serviceSales.set(item.service.id, acc);
        }
        acc.quantity += item.quantity;
        acc.revenue += Number(item.totalPrice);
      } else if (item.itemType === 'PRODUCT' && item.product) {
        let acc = productSales.get(item.product.id);
        if (!acc) {
          acc = { name: item.product.name, quantity: 0, revenue: 0 };
          productSales.set(item.product.id, acc);
        }
        acc.quantity += item.quantity;
        acc.revenue += Number(item.totalPrice);
      }
    }

    const topServices = Array.from(serviceSales.entries())
      .map(([serviceId, acc]) => ({
        serviceId,
        serviceName: acc.name,
        quantity: acc.quantity,
        revenue: acc.revenue,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    const topProducts = Array.from(productSales.entries())
      .map(([productId, acc]) => ({
        productId,
        productName: acc.name,
        quantity: acc.quantity,
        revenue: acc.revenue,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // --- Retenção: dos clientes que compraram no período, quantos já
    // tinham comprado antes dele (retornando) vs. primeira compra (novos) ---
    const customerIds = customersInPeriod.map((s) => s.customerId as number);
    const priorSales =
      customerIds.length > 0
        ? await this.prisma.sale.findMany({
            where: {
              barbershopId,
              paymentStatus: 'PAID',
              customerId: { in: customerIds },
              createdAt: { lt: from },
            },
            select: { customerId: true },
            distinct: ['customerId'],
          })
        : [];
    const returningSet = new Set(priorSales.map((s) => s.customerId));
    const totalCustomers = customerIds.length;
    const returningCustomers = returningSet.size;
    const newCustomers = totalCustomers - returningCustomers;

    const serviceRevenue = Array.from(serviceSales.values()).reduce((sum, s) => sum + s.revenue, 0);
    const productRevenue = Array.from(productSales.values()).reduce((sum, p) => sum + p.revenue, 0);
    const salesCount = paidSales.length;
    const salesTotal = paidSales.reduce((sum, s) => sum + Number(s.total), 0);
    const byBarberRevenue = new Map<
      number,
      { name: string; revenue: number; salesCount: number }
    >();
    for (const sale of paidSales) {
      const barberId = sale.barberId ?? 0;
      let acc = byBarberRevenue.get(barberId);
      if (!acc) {
        acc = {
          name: sale.barber?.name ?? '',
          revenue: 0,
          salesCount: 0,
        };
        byBarberRevenue.set(barberId, acc);
      }
      acc.revenue += Number(sale.total);
      acc.salesCount += 1;
    }
    const revenueByBarber = Array.from(byBarberRevenue.entries())
      .map(([barberId, acc]) => ({
        barberId,
        barberName: acc.name,
        revenue: acc.revenue,
        salesCount: acc.salesCount,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const appointmentsByStatus = statusGroups
      .map((row) => ({ status: row.status, count: row._count._all }))
      .sort((a, b) => b.count - a.count);
    const statusCount = (status: string) =>
      appointmentsByStatus.find((row) => row.status === status)?.count ?? 0;
    const cancelledCount = statusCount('CANCELLED');
    const finished = statusCount('COMPLETED') + statusCount('NO_SHOW') + cancelledCount;

    return {
      totalNoShow,
      totalCompletedOrNoShow: appointments.length,
      noShowRate: toRate(totalNoShow, appointments.length - totalNoShow),
      noShowByBarber,
      noShowByService,
      topServices,
      topProducts,
      newCustomers,
      returningCustomers,
      retentionRate: totalCustomers > 0 ? returningCustomers / totalCustomers : 0,
      salesCount,
      averageTicket: salesCount > 0 ? salesTotal / salesCount : 0,
      serviceRevenue,
      productRevenue,
      walkIns,
      cancelledCount,
      cancellationRate: finished > 0 ? cancelledCount / finished : 0,
      revenueByBarber,
      appointmentsByStatus,
    };
  }
}
