/**
 * Preços e taxas da plataforma. Os padrões abaixo são os decididos para o
 * piloto (ver "Decisões tomadas" no ROADMAP); o admin muda em "Preços e
 * taxas" no backoffice, sem deploy (fica na tabela PlatformSetting). O código lê daqui, de um cache em
 * memória que o PricingService carrega ao subir, atualiza a cada minuto e
 * troca na hora quando o admin salva.
 */
export type Pricing = {
  /** % da plataforma sobre o que passa pelo Stripe (sinal, pagamento pelo app, caixinha, repasses) */
  platformFeePercent: number;
  /** Plano Pro do profissional solo, por mês */
  proPriceCents: number;
  /** Destaque na busca: unidade e profissional, por período */
  featuredShopPriceCents: number;
  featuredProPriceCents: number;
  featuredDays: number;
  /** Taxa por vaga preenchida (a unidade paga ao aceitar o freelancer); 0 = grátis */
  jobFillFeeCents: number;
  /**
   * Cliente novo do marketplace: % do primeiro atendimento concluído de quem
   * chegou pela vitrine e nunca foi àquele negócio. 0 = desligado (o piloto
   * não cobra); o cálculo entra quando o piloto acabar.
   */
  newClientFeePercent: number;
  /** Teto da taxa do cliente novo, em centavos */
  newClientFeeCapCents: number;
};

export const DEFAULT_PRICING: Pricing = {
  platformFeePercent: 15,
  proPriceCents: 3990,
  featuredShopPriceCents: 4990,
  featuredProPriceCents: 2490,
  featuredDays: 30,
  jobFillFeeCents: 1490,
  newClientFeePercent: 0,
  newClientFeeCapCents: 1000,
};

/** Limites do que o admin pode salvar (evita erro de digitação virar cobrança absurda) */
export const PRICING_LIMITS: Record<keyof Pricing, { min: number; max: number }> = {
  platformFeePercent: { min: 0, max: 50 },
  // Cobrados no cartão: o Stripe não aceita valores muito baixos (mínimo R$ 1,00 aqui)
  proPriceCents: { min: 100, max: 100_000 },
  featuredShopPriceCents: { min: 100, max: 100_000 },
  featuredProPriceCents: { min: 100, max: 100_000 },
  featuredDays: { min: 1, max: 365 },
  // 0 desliga a taxa; acima de zero, no mínimo R$ 1,00 (cobrado no cartão)
  jobFillFeeCents: { min: 0, max: 100_000 },
  newClientFeePercent: { min: 0, max: 30 },
  newClientFeeCapCents: { min: 0, max: 100_000 },
};

/** Cobrado no cartão: 0 desliga; acima de zero, no mínimo R$ 1,00 (o Stripe recusa menos) */
const CHARGED_CENTS = new Set<keyof Pricing>(['jobFillFeeCents']);

/** O valor cabe nos limites (e, se é cobrança no cartão, é 0 ou pelo menos R$ 1,00)? */
export function isPricingValueAllowed(key: keyof Pricing, value: number): boolean {
  const { min, max } = PRICING_LIMITS[key];
  if (!Number.isFinite(value) || value < min || value > max) return false;
  if (CHARGED_CENTS.has(key) && value !== 0 && value < 100) return false;
  return true;
}

/** Campos em %, que aceitam casas decimais */
export const PERCENT_KEYS = new Set<keyof Pricing>(['platformFeePercent', 'newClientFeePercent']);

/** Moeda dos preços da plataforma */
export const PLATFORM_CURRENCY = 'BRL';

let current: Pricing = { ...DEFAULT_PRICING };

/** Preços e taxas em vigor (síncrono: vem do cache) */
export function currentPricing(): Pricing {
  return current;
}

/** Só valores conhecidos e dentro dos limites; o resto fica no padrão */
export function sanitizePricing(raw: unknown): Pricing {
  const out: Pricing = { ...DEFAULT_PRICING };
  if (raw && typeof raw === 'object') {
    for (const key of Object.keys(DEFAULT_PRICING) as (keyof Pricing)[]) {
      const value = (raw as Record<string, unknown>)[key];
      if (typeof value === 'number' && isPricingValueAllowed(key, value)) {
        out[key] = PERCENT_KEYS.has(key) ? value : Math.round(value);
      }
    }
  }
  return out;
}

export function setCurrentPricing(raw: unknown) {
  current = sanitizePricing(raw);
  return current;
}

/** Parte da plataforma sobre um valor em centavos */
export function platformFeeCents(amountCents: number) {
  return Math.round((amountCents * current.platformFeePercent) / 100);
}

export function formatBrl(cents: number) {
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
}
