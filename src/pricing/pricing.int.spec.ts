/**
 * Preços e taxas editáveis pelo admin, contra o Postgres de verdade: padrão
 * genérico, validação, gravação no banco e o cache que o código lê.
 */
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from './pricing.service';
import { DEFAULT_PRICING, currentPricing, platformFeeCents, setCurrentPricing } from './pricing';
import { proPriceLabel } from '../barbershop/pro';
import { featuredOffer } from '../barbershop/featured-payment.service';

describe('Preços e taxas (integração)', () => {
  const prisma = new PrismaService();
  const pricing = new PricingService(prisma);
  let before: unknown;

  beforeAll(async () => {
    before = (await prisma.platformSetting.findUnique({ where: { key: 'pricing' } }))?.value;
    await prisma.platformSetting.deleteMany({ where: { key: 'pricing' } });
  });

  afterAll(async () => {
    if (before !== undefined) {
      await prisma.platformSetting.upsert({
        where: { key: 'pricing' },
        create: { key: 'pricing', value: before as never },
        update: { value: before as never },
      });
    } else {
      await prisma.platformSetting.deleteMany({ where: { key: 'pricing' } });
    }
    setCurrentPricing({});
    await prisma.$disconnect();
  });

  it('sem nada salvo vale o padrão; o admin muda e o código passa a usar na hora', async () => {
    expect(await pricing.reload()).toEqual(DEFAULT_PRICING);
    expect(pricing.get().defaults).toEqual(DEFAULT_PRICING);
    expect(platformFeeCents(10_000)).toBe(1_500);

    const saved = await pricing.update(1, {
      platformFeePercent: 12.5,
      featuredProPriceCents: 990,
      proPriceCents: 3900,
    });
    expect(saved).toMatchObject({ platformFeePercent: 12.5, featuredProPriceCents: 990 });
    expect(platformFeeCents(10_000)).toBe(1_250);
    expect(proPriceLabel()).toBe('R$ 39,00');
    expect(featuredOffer('professional')).toEqual({ priceCents: 990, days: 30 });
    expect(featuredOffer('barbershop').priceCents).toBe(DEFAULT_PRICING.featuredShopPriceCents);

    // Outra réplica lê do banco
    setCurrentPricing({});
    expect(currentPricing().platformFeePercent).toBe(15);
    expect((await pricing.reload()).platformFeePercent).toBe(12.5);
  });

  it('valida cada valor: fora do limite, tipo errado ou campo desconhecido não salva', async () => {
    await expect(pricing.update(1, { platformFeePercent: 80 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(pricing.update(1, { featuredShopPriceCents: 10 })).rejects.toThrow('entre 100');
    await expect(pricing.update(1, { featuredDays: 0 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(pricing.update(1, { nada: 1 } as never)).rejects.toThrow('Campo desconhecido');
    // Taxa da vaga pode ser desligada (0)
    expect((await pricing.update(1, { jobFillFeeCents: 0 })).jobFillFeeCents).toBe(0);
    // Valor salvo à mão no banco fora do limite volta ao padrão ao carregar
    await prisma.platformSetting.update({
      where: { key: 'pricing' },
      data: { value: { platformFeePercent: 999, featuredDays: 15 } },
    });
    const loaded = await pricing.reload();
    expect(loaded.platformFeePercent).toBe(DEFAULT_PRICING.platformFeePercent);
    expect(loaded.featuredDays).toBe(15);
  });
});
