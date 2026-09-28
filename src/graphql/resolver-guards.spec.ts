import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Toda query/mutation do GraphQL precisa de um guard (no método ou na
 * classe), a não ser as públicas de propósito listadas aqui. Operação nova
 * sem guard quebra este teste: ou ganha guard, ou entra na lista com o
 * motivo. (As de pagamentos recorrentes do backoffice ficaram abertas a
 * qualquer um até este teste existir.)
 */
const PUBLIC: Record<string, string> = {
  // Entrar, cadastrar e recuperar senha
  'auth.resolver.ts#login': 'login',
  'auth.resolver.ts#verify2FA': 'login em duas etapas',
  'auth.resolver.ts#createUser': 'cadastro',
  'auth.resolver.ts#forgotPassword': 'recuperar senha',
  'auth.resolver.ts#forgotPasswordCheck': 'recuperar senha',
  'auth.resolver.ts#resetPassword': 'recuperar senha (token)',
  'auth.resolver.ts#startSocialSignup': 'cadastro por login social',
  'auth.resolver.ts#completeSocialSignup': 'cadastro por login social (token)',
  'client-auth.resolver.ts#clientSignup': 'cadastro do cliente',
  'client-auth.resolver.ts#clientLogin': 'login do cliente',
  'client-auth.resolver.ts#clientVerifyEmail': 'confirmar e-mail (token)',
  'client-auth.resolver.ts#clientForgotPassword': 'recuperar senha do cliente',
  'client-auth.resolver.ts#clientResetPassword': 'recuperar senha do cliente (token)',
  // Chat do cliente: cookie da conta ou token do link do agendamento
  'chat.resolver.ts#clientAppointmentChats': 'cookie do cliente ou token do link',
  'chat.resolver.ts#clientSendChatMessage': 'cookie do cliente ou token do link',
  'chat.resolver.ts#clientReportChat': 'cookie do cliente ou token do link',
  // Página pública, busca e agendamento sem conta
  'public-booking.resolver.ts#publicBarbershop': 'página pública',
  'public-booking.resolver.ts#publicBarbershopBySubdomain': 'página pública',
  'public-booking.resolver.ts#publicServiceCategories': 'busca',
  'public-booking.resolver.ts#searchBarbershops': 'busca',
  'public-booking.resolver.ts#searchProfessionals': 'busca',
  'public-booking.resolver.ts#publicCities': 'busca',
  'public-booking.resolver.ts#publicAvailableSlots': 'agendamento público',
  'public-booking.resolver.ts#publicNextAvailableSlot': 'agendamento público',
  'public-booking.resolver.ts#createPublicAppointment': 'agendamento público',
  'public-booking.resolver.ts#joinPublicWaitlist': 'lista de espera online',
  'public-booking.resolver.ts#leaveWaitlist': 'sair da lista (token)',
  'public-booking.resolver.ts#unsubscribeFromMarketing': 'descadastro (token)',
  'public-booking.resolver.ts#managedAppointment': 'gerenciar agendamento (token)',
  'public-booking.resolver.ts#cancelManagedAppointment': 'gerenciar agendamento (token)',
  'public-booking.resolver.ts#rescheduleManagedAppointment': 'gerenciar agendamento (token)',
  'public-booking.resolver.ts#startDepositPayment': 'sinal pelo link (token)',
  'public-booking.resolver.ts#confirmDepositPayment': 'sinal pelo link (token)',
  'public-booking.resolver.ts#barbershopReviews': 'avaliações públicas',
  'public-booking.resolver.ts#reviewRequest': 'avaliar pelo link (token)',
  'public-booking.resolver.ts#submitReviewByLink': 'avaliar pelo link (token)',
  'prepayment.resolver.ts#appointmentPrepayment': 'pagar pelo link (token)',
  'prepayment.resolver.ts#startAppointmentPrepayment': 'pagar pelo link (token)',
  'prepayment.resolver.ts#confirmAppointmentPrepayment': 'pagar pelo link (token)',
  // Outros públicos
  'moderation.resolver.ts#reportContent': 'denúncia de conteúdo público',
  'plan.resolver.ts#getAllPlans': 'página de planos',
  'plan.resolver.ts#getPlanById': 'página de planos',
  'pricing.resolver.ts#platformPricing': 'preços públicos',
  'push.resolver.ts#pushPublicKey': 'chave pública do Web Push',
  'push.resolver.ts#removePushSubscription': 'o endpoint do aparelho é o segredo',
  'support.resolver.ts#contactSupport': 'suporte sem conta',
  'support.resolver.ts#supportTicket': 'pedido de suporte (token)',
  'support.resolver.ts#replySupportTicket': 'pedido de suporte (token)',
};

const DIR = join(__dirname, 'resolvers');
// Um ou mais decorators (com até dois níveis de parênteses) seguidos do método
const DECORATED_METHOD =
  /((?:\s*@[\w.]+\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)\s*)+)\s*(?:async\s+)?(\w+)\s*\(/g;

function unguardedOperations(): string[] {
  const found: string[] = [];
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.resolver.ts'))) {
    const src = readFileSync(join(DIR, file), 'utf8');
    // Guard na classe do resolver (a marcada com @Resolver) vale para todos os métodos
    const classHeaders = [
      ...src.matchAll(/((?:@[\w.]+\((?:[^()]|\([^()]*\))*\)\s*)+)export class \w+/g),
    ].map((m) => m[1]);
    const classGuarded = classHeaders.some((h) => /@Resolver\(/.test(h) && /@UseGuards\(/.test(h));
    for (const [, decorators, method] of src.matchAll(DECORATED_METHOD)) {
      if (!/@(Query|Mutation)\(/.test(decorators)) continue;
      if (!classGuarded && !/@UseGuards\(/.test(decorators)) found.push(`${file}#${method}`);
    }
  }
  return found.sort();
}

describe('guards das operações GraphQL', () => {
  it('toda query/mutation sem guard é pública de propósito', () => {
    const unexpected = unguardedOperations().filter((op) => !(op in PUBLIC));
    expect(unexpected).toEqual([]);
  });

  it('a lista de públicas não guarda nome que não existe mais', () => {
    const unguarded = new Set(unguardedOperations());
    expect(Object.keys(PUBLIC).filter((op) => !unguarded.has(op))).toEqual([]);
  });
});
