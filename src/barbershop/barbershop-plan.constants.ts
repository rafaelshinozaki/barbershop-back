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

/** Planos (por nome no BD). Basic/Standard = Basic e Standard do seed; Premium = Premium */
const PLAN_TIERS = {
  BASIC: ['Basic'],
  MEDIUM: ['Standard', 'Medium'],
  PREMIUM: ['Premium'],
} as const

/** Módulos incluídos em cada tier */
const MODULES_BY_TIER: Record<string, BarbershopModule[]> = {
  BASIC: ['clients', 'queue', 'cuts', 'barbers'],
  MEDIUM: ['clients', 'queue', 'cuts', 'barbers', 'appointments', 'products'],
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
  ],
}

/** Planos considerados para barbearia (nome exato no Plan) */
export const BARBERSHOP_PLAN_NAMES = ['Basic', 'Standard', 'Medium', 'Premium'] as const

/**
 * Retorna os módulos disponíveis para um nome de plano.
 * Planos não reconhecidos retornam módulos básicos (clients, queue, cuts, barbers).
 */
export function getModulesForPlanName(planName: string): BarbershopModule[] {
  const name = planName?.trim() || ''
  if (PLAN_TIERS.PREMIUM.some((p) => p.toLowerCase() === name.toLowerCase())) {
    return MODULES_BY_TIER.PREMIUM
  }
  if (PLAN_TIERS.MEDIUM.some((p) => p.toLowerCase() === name.toLowerCase())) {
    return MODULES_BY_TIER.MEDIUM
  }
  if (PLAN_TIERS.BASIC.some((p) => p.toLowerCase() === name.toLowerCase())) {
    return MODULES_BY_TIER.BASIC
  }
  return MODULES_BY_TIER.BASIC
}

/**
 * Verifica se um plano inclui o módulo.
 */
export function planIncludesModule(planName: string, module: BarbershopModule): boolean {
  const modules = getModulesForPlanName(planName)
  return modules.includes(module)
}
