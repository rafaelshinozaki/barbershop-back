/**
 * Boas-vindas por cargo (sem Nest, pra testar sem subir nada): os passos de
 * cada cargo, quais o sistema confere sozinho e quais a pessoa marca ao abrir.
 */

export type OnboardingRole =
  | 'newOwner'
  | 'owner'
  | 'manager'
  | 'reception'
  | 'barber'
  | 'basic'
  // Agenda própria (practiceKind = solo): sem equipe nem caixa
  | 'solo'
  // Profissional sem unidade: o perfil público e as vagas
  | 'professional'
  // Cliente final (área do cliente)
  | 'client';

/** Passo que o sistema confere pelos dados (o resto marca ao abrir) */
export const AUTO_STEPS = new Set([
  'createShop',
  'services',
  'hours',
  'team',
  'payments',
  'firstAppointment',
  'cashier',
  'schedule',
  'calendarSync',
  'photo',
  'publicProfile',
  'openToWork',
  'verifyEmail',
  'phone',
  'favorite',
  'push',
]);

/** Passo que não conta para "tudo feito" (ex.: receber pelo app é opcional) */
export const OPTIONAL_STEPS = new Set(['payments', 'openToWork', 'push']);

export const ROLE_STEPS: Record<OnboardingRole, string[]> = {
  newOwner: ['createShop'],
  owner: ['services', 'hours', 'team', 'publicPage', 'payments', 'firstAppointment'],
  manager: ['agenda', 'teamSchedule', 'cashier', 'reports'],
  reception: ['agenda', 'newCustomer', 'cashier', 'waitlist'],
  barber: ['schedule', 'timeOff', 'calendarSync', 'photo', 'myPay'],
  basic: ['agenda', 'schedule', 'calendarSync'],
  solo: ['services', 'hours', 'photo', 'publicProfile', 'calendarSync', 'firstAppointment'],
  professional: ['photo', 'publicProfile', 'openToWork'],
  client: ['verifyEmail', 'phone', 'favorite', 'push'],
};

/** Por quanto tempo depois de entrar na unidade o card aparece */
export const ONBOARDING_DAYS = 30;

export type OnboardingStep = { id: string; done: boolean; optional: boolean; auto: boolean };

/** Passos do cargo com o que já está feito (pelos dados ou marcado) */
export function buildSteps(
  role: OnboardingRole,
  auto: Partial<Record<string, boolean>>,
  marked: readonly string[],
): OnboardingStep[] {
  return ROLE_STEPS[role].map((id) => ({
    id,
    done: AUTO_STEPS.has(id) ? Boolean(auto[id]) : marked.includes(id),
    optional: OPTIONAL_STEPS.has(id),
    auto: AUTO_STEPS.has(id),
  }));
}

/** Aparece? Dentro do prazo, não dispensado e com algo obrigatório por fazer */
export function shouldShow(
  steps: OnboardingStep[],
  since: Date,
  dismissedAt: Date | null | undefined,
  now = new Date(),
): boolean {
  if (dismissedAt) return false;
  if (now.getTime() - since.getTime() > ONBOARDING_DAYS * 86_400_000) return false;
  return steps.some((s) => !s.done && !s.optional);
}

/** Só passo manual do cargo pode ser marcado pela pessoa */
export function canMark(role: OnboardingRole, step: string): boolean {
  return ROLE_STEPS[role].includes(step) && !AUTO_STEPS.has(step);
}
