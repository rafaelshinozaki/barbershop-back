/**
 * Módulos da barbearia por plano.
 * O dono assina o plano; dono e funcionários acessam os mesmos módulos conforme o plano.
 */
export type BarbershopModule =
  | 'clients'
  | 'queue'
  | 'cuts'
  | 'appointments'
  | 'products'
  | 'barbers'
  | 'cashFlow'
  | 'reports'
  | 'settings'
  | 'inventory'
  | 'packages' // pacotes de sessão + ficha de anamnese/consentimento

/** Planos (por nome no BD). Basic/Standard = Basic e Standard do seed; Premium = Premium */
const PLAN_TIERS = {
  BASIC: ['Basic'],
  MEDIUM: ['Standard', 'Medium'],
  PREMIUM: ['Premium'],
} as const

/** Módulos incluídos em cada tier */
const MODULES_BY_TIER: Record<string, BarbershopModule[]> = {
  BASIC: ['clients', 'queue', 'cuts', 'barbers'],
  MEDIUM: ['clients', 'queue', 'cuts', 'barbers', 'appointments', 'products', 'inventory'],
  PREMIUM: [
    'clients',
    'queue',
    'cuts',
    'barbers',
    'appointments',
    'products',
    'cashFlow',
    'reports',
    'settings',
    'inventory',
    'packages',
  ],
}

/** Limites numéricos por tier — ver seção "Rede & assinatura" da spec do produto */
export interface PlanLimits {
  maxBarbershops: number
  maxBarbersPerShop: number
}

const LIMITS_BY_TIER: Record<string, PlanLimits> = {
  BASIC: { maxBarbershops: 1, maxBarbersPerShop: 3 },
  MEDIUM: { maxBarbershops: 3, maxBarbersPerShop: 10 },
  PREMIUM: { maxBarbershops: Infinity, maxBarbersPerShop: Infinity },
}

function resolveTier(planName: string): 'BASIC' | 'MEDIUM' | 'PREMIUM' {
  const name = planName?.trim() || ''
  if (PLAN_TIERS.PREMIUM.some((p) => p.toLowerCase() === name.toLowerCase())) return 'PREMIUM'
  if (PLAN_TIERS.MEDIUM.some((p) => p.toLowerCase() === name.toLowerCase())) return 'MEDIUM'
  return 'BASIC'
}

/** Retorna os limites numéricos (nº de unidades, nº de profissionais por unidade) para um plano. */
export function getPlanLimits(planName: string): PlanLimits {
  return LIMITS_BY_TIER[resolveTier(planName)]
}

/**
 * Retorna os módulos disponíveis para um nome de plano.
 * Planos não reconhecidos retornam módulos básicos (clients, queue, cuts, barbers).
 */
export function getModulesForPlanName(planName: string): BarbershopModule[] {
  return MODULES_BY_TIER[resolveTier(planName)]
}

/**
 * Verifica se um plano inclui o módulo.
 */
export function planIncludesModule(planName: string, module: BarbershopModule): boolean {
  const modules = getModulesForPlanName(planName)
  return modules.includes(module)
}
