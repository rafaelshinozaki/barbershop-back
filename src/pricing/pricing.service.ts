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
  Pricing,
  currentPricing,
  setCurrentPricing,
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

  /** Admin: salva só o que veio, validando cada valor */
  async update(adminUserId: number, patch: Partial<Pricing>) {
    const next: Pricing = { ...currentPricing() };
    for (const [key, value] of Object.entries(patch) as [keyof Pricing, unknown][]) {
      if (value == null) continue;
      if (!(key in PRICING_LIMITS)) throw new BadRequestException(`Campo desconhecido: ${key}`);
      const { min, max } = PRICING_LIMITS[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
        throw new BadRequestException(`${key} deve ficar entre ${min} e ${max}`);
      }
      next[key] = key === 'platformFeePercent' ? Math.round(value * 100) / 100 : Math.round(value);
    }
    await this.prisma.platformSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: next, updatedByUserId: adminUserId },
      update: { value: next, updatedByUserId: adminUserId },
    });
    setCurrentPricing(next);
    this.logger.log(`Preços atualizados pelo admin #${adminUserId}`);
    return this.get();
  }
}
