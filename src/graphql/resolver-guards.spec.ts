import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

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

/**
 * O mesmo para as rotas REST (controllers): as de pagamentos recorrentes, os
 * e-mails de teste e a consulta de cliente do Stripe ficaram abertas porque
 * o teste acima só olhava o GraphQL.
 */
const PUBLIC_ROUTES: Record<string, string> = {
  'auth/auth.controller.ts#verifyLogin': 'login em duas etapas',
  'auth/users/users.controller.ts#createUser': 'cadastro',
  'barbershop/employee-invite.controller.ts#validateInvite': 'convite (token)',
  'barbershop/employee-invite.controller.ts#acceptInvite': 'convite (token)',
  'calendar/calendar.controller.ts#appointment': 'arquivo .ics do agendamento (token)',
  'calendar/calendar.controller.ts#feed': 'agenda assinável (token secreto no nome)',
  'health/health.controller.ts#getHealth': 'health check',
  'locations/locations.controller.ts#states': 'lista de estados',
  'locations/locations.controller.ts#cities': 'lista de cidades',
  'plan/plan.controller.ts#getAllPlans': 'página de planos',
  'plan/plan.controller.ts#getPlan': 'página de planos',
  'seo/sitemap.controller.ts#sitemapXml': 'SEO',
  'seo/sitemap.controller.ts#shop': 'SEO da página pública',
  'seo/sitemap.controller.ts#shopImage': 'SEO da página pública',
  'social/social.controller.ts#callback': 'retorno do OAuth (state assinado)',
  'stripe/stripe.controller.ts#handleWebhook': 'webhook (assinatura do Stripe)',
  'stripe/stripe.controller.ts#checkHealth': 'health check',
  'stripe/stripe.controller.ts#getStripePlans': 'preços públicos dos planos',
};

const SRC = join(__dirname, '..');
const ROUTE = /@(Get|Post|Put|Patch|Delete|All)\(/;

function controllerFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? controllerFiles(join(dir, e.name))
      : e.name.endsWith('.controller.ts')
      ? [join(dir, e.name)]
      : [],
  );
}

function unguardedRoutes(): string[] {
  const found: string[] = [];
  for (const path of controllerFiles(SRC)) {
    const file = relative(SRC, path);
    const src = readFileSync(path, 'utf8');
    const classHeaders = [
      ...src.matchAll(/((?:@[\w.]+\((?:[^()]|\([^()]*\))*\)\s*)+)export class \w+/g),
    ].map((m) => m[1]);
    const classGuarded = classHeaders.some(
      (h) => /@Controller\(/.test(h) && /@UseGuards\(/.test(h),
    );
    for (const [, decorators, method] of src.matchAll(DECORATED_METHOD)) {
      if (!ROUTE.test(decorators)) continue;
      if (!classGuarded && !/@UseGuards\(/.test(decorators)) found.push(`${file}#${method}`);
    }
  }
  return found.sort();
}

describe('guards das rotas REST', () => {
  it('toda rota sem guard é pública de propósito', () => {
    const unexpected = unguardedRoutes().filter((r) => !(r in PUBLIC_ROUTES));
    expect(unexpected).toEqual([]);
  });

  it('a lista de públicas não guarda rota que não existe mais', () => {
    const unguarded = new Set(unguardedRoutes());
    expect(Object.keys(PUBLIC_ROUTES).filter((r) => !unguarded.has(r))).toEqual([]);
  });
});

/**
 * Toda operação que aceita a equipe do sistema (SystemManager, no método ou
 * na classe) diz a área do backoffice (@RequireArea). Sem ela o guard recusa
 * a equipe, então operação nova esquecida quebraria a tela de quem tem a área.
 */
function operationsWithoutArea(): string[] {
  const found: string[] = [];
  const files = [
    ...readdirSync(DIR)
      .filter((f) => f.endsWith('.resolver.ts'))
      .map((f) => join(DIR, f)),
    ...controllerFiles(SRC),
  ];
  for (const path of files) {
    const src = readFileSync(path, 'utf8');
    const classHeader = src.match(
      /((?:@[\w.]+\((?:[^()]|\([^()]*\))*\)\s*)+)export class \w+/,
    )?.[1];
    const classRoles = classHeader?.match(/@Roles\(([^)]*)\)/)?.[1];
    const classArea = /@RequireArea\(/.test(classHeader ?? '');
    for (const [, decorators, method] of src.matchAll(DECORATED_METHOD)) {
      if (!/@(Query|Mutation)\(/.test(decorators) && !ROUTE.test(decorators)) continue;
      const roles = decorators.match(/@Roles\(([^)]*)\)/)?.[1] ?? classRoles ?? '';
      if (!roles.includes('SYSTEM_MANAGER')) continue;
      if (!classArea && !/@RequireArea\(/.test(decorators)) {
        found.push(`${relative(SRC, path)}#${method}`);
      }
    }
  }
  return found.sort();
}

describe('áreas do backoffice', () => {
  it('toda operação da equipe do sistema tem área', () => {
    expect(operationsWithoutArea()).toEqual([]);
  });
});
