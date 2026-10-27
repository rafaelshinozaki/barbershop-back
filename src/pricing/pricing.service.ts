import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_PRICING,
  PRICING_LIMITS,
  PERCENT_KEYS,
  isPricingValueAllowed,
  Pricing,
  currentPricing,
  setCurrentPricing,
  sanitizePricing,
} from './pricing';

const KEY = 'pricing';
const REFRESH_MS = 60_000;

/** Carrega e salva os preços e taxas (tabela PlatformSetting, chave "pricing") */
@Injectable()
export class PricingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PricingService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.reload();
    // Outras réplicas pegam a mudança do admin em até um minuto
    this.timer = setInterval(() => void this.reload(), REFRESH_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async reload() {
    try {
      const row = await this.prisma.platformSetting.findUnique({ where: { key: KEY } });
      return setCurrentPricing(row?.value ?? {});
    } catch (err) {
      this.logger.warn(`Preços não carregados (seguem os atuais): ${err}`);
      return currentPricing();
    }
  }

  get() {
    return { ...currentPricing(), defaults: DEFAULT_PRICING };
  }

  /**
   * Admin: salva só o que veio, validando cada valor. Parte da linha do banco
   * (com trava), não do cache: o cache é relido a cada minuto, e partir dele
   * desfazia o que outro admin salvou pelo backoffice-back há pouco (item 358)
   */
  async update(adminUserId: number, patch: Partial<Pricing>) {
    const changes: Partial<Pricing> = {};
    for (const [key, value] of Object.entries(patch) as [keyof Pricing, unknown][]) {
      if (value == null) continue;
      if (!(key in PRICING_LIMITS)) throw new BadRequestException(`Campo desconhecido: ${key}`);
      const { min, max } = PRICING_LIMITS[key];
      if (typeof value !== 'number' || !isPricingValueAllowed(key, value)) {
        throw new BadRequestException(
          key === 'jobFillFeeCents' && typeof value === 'number' && value > 0 && value < 100
            ? `${key}: use 0 (grátis) ou a partir de 100 centavos (o cartão não cobra menos que R$ 1,00)`
            : `${key} deve ficar entre ${min} e ${max}`,
        );
      }
      changes[key] = PERCENT_KEYS.has(key) ? Math.round(value * 100) / 100 : Math.round(value);
    }
    const next = await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ value: unknown }[]>`
        SELECT value FROM "PlatformSetting" WHERE key = ${KEY} FOR UPDATE`;
      const merged: Pricing = { ...sanitizePricing(row?.value ?? {}), ...changes };
      await tx.platformSetting.upsert({
        where: { key: KEY },
        create: { key: KEY, value: merged, updatedByUserId: adminUserId },
        update: { value: merged, updatedByUserId: adminUserId },
      });
      return merged;
    });
    setCurrentPricing(next);
    this.logger.log(`Preços atualizados pelo admin #${adminUserId}`);
    return this.get();
  }
}
