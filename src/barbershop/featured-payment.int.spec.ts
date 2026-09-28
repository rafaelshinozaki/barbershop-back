/**
 * Comprar o Destaque com cartão (Stripe simulado), contra o Postgres de
 * verdade: quem pode comprar, retomar a compra aberta, a tela e o webhook
 * registram uma vez só, e cada compra soma 30 dias ao Destaque que já vale.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';
import { DEFAULT_PRICING, setCurrentPricing } from '../pricing/pricing';
import { featuredOffer, FeaturedPaymentService } from './featured-payment.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const DAY = 86_400_000;
const FEATURED_DAYS = DEFAULT_PRICING.featuredDays;
const SHOP_PRICE = DEFAULT_PRICING.featuredShopPriceCents;

type Intent = {
  id: string;
  amount: number;
  status: string;
  client_secret: string;
  metadata: Record<string, string>;
};

describe('Comprar o Destaque (integração, Stripe simulado)', () => {
  const prisma = new PrismaService();
  const intents = new Map<string, Intent>();
  let seq = 0;
  const stripe = {
    createPaymentIntent: async (amount: number, _currency: string, _c: unknown, opts: any) => {
      const pi: Intent = {
        id: `pi_feat_${RUN}_${++seq}`,
        amount,
        status: 'requires_payment_method',
        client_secret: `secret_${seq}`,
        metadata: { ...opts.metadata },
      };
      intents.set(pi.id, pi);
      return pi;
    },
    retrievePaymentIntent: async (id: string) => intents.get(id)!,
    cancelPaymentIntent: async (id: string) => {
      intents.get(id)!.status = 'canceled';
    },
  };
  const pay = (id: string) => (intents.get(id)!.status = 'succeeded');
  const stub = {} as never;
  const barbershops = new BarbershopService(
    prisma,
    stub,
    stub,
    { isConfigured: () => false } as never,
    stub,
    { email: async () => undefined, whatsapp: async () => undefined } as never,
    { notify: () => undefined } as never,
  );
  const pushed: number[][] = [];
  const featured = new FeaturedPaymentService(prisma, stripe as never, barbershops, {
    sendToUsers: async (ids: number[]) => void pushed.push(ids),
  } as never);
  const reminders = async (userId: number) =>
    (
      await prisma.userNotification.findMany({
        where: { userId, title: 'Destaque vence em breve' },
      })
    ).length;

  let roleId: number;
  let ownerId: number;
  let staffId: number;
  let proUserId: number;
  let networkId: number;
  let shopId: number;
  let professionalId: number;
  const keyBefore = process.env.STRIPE_SECRET_KEY;

  const createUser = async (label: string) =>
    (
      await prisma.user.create({
        data: {
          email: `feat-${label}-${RUN}@test.local`,
          password: 'x',
          fullName: `Destaque ${label}`,
          idDocNumber: `${RUN}${label}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'male',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      })
    ).id;

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_simulado';
    roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = await createUser('owner');
    staffId = await createUser('staff');
    proUserId = await createUser('pro');
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede Feat ${RUN}` } })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: `Destaque ${RUN}`,
          slug: `feat-${RUN}`,
          address: 'Rua 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `feat-${RUN}@test.local`,
          timezone: 'America/Sao_Paulo',
          networkId,
          ownerUserId: ownerId,
        },
      })
    ).id;
    await prisma.barber.create({
      data: { barbershopId: shopId, name: 'Da casa', phone: '11900000008', userId: staffId },
    });
    professionalId = (
      await prisma.professional.create({
        data: { userId: proUserId, slug: `feat-pro-${RUN}`, visibility: 'hidden' },
      })
    ).id;
  });

  afterAll(async () => {
    if (keyBefore === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = keyBefore;
    await prisma.featuredPurchase.deleteMany({ where: { userId: { in: [ownerId, proUserId] } } });
    await prisma.userNotification.deleteMany({
      where: { userId: { in: [ownerId, staffId, proUserId] } },
    });
    await prisma.barber.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.professional.deleteMany({ where: { id: professionalId } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  it('unidade: dono compra; retoma a compra aberta; tela e webhook registram uma vez; a segunda soma 30 dias', async () => {
    expect(await featured.status(ownerId, 'barbershop', shopId)).toMatchObject({
      available: true,
      priceCents: SHOP_PRICE,
      days: FEATURED_DAYS,
      isFeatured: false,
    });
    // Barbeiro da casa não compra pela unidade
    await expect(featured.start(staffId, 'barbershop', shopId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    const first = await featured.start(ownerId, 'barbershop', shopId);
    // Abrir de novo reaproveita o mesmo pagamento
    const again = await featured.start(ownerId, 'barbershop', shopId);
    expect(again.purchaseId).toBe(first.purchaseId);
    expect(again.clientSecret).toBe(first.clientSecret);

    // Sem pagar, nada muda
    expect(await featured.confirm(ownerId, first.purchaseId)).toBe(false);
    const purchase = await prisma.featuredPurchase.findUniqueOrThrow({
      where: { id: first.purchaseId },
    });
    pay(purchase.stripePaymentIntentId!);
    // Pagamento que não confere (outro valor ou de outro tipo) não registra
    const intent = intents.get(purchase.stripePaymentIntentId!)!;
    expect(await featured.finalize({ ...intent, amount: 100 } as never)).toBe(false);
    expect(
      await featured.finalize({
        ...intent,
        metadata: { ...intent.metadata, kind: 'outro' },
      } as never),
    ).toBe(false);
    expect(
      (await prisma.featuredPurchase.findUniqueOrThrow({ where: { id: first.purchaseId } })).status,
    ).toBe('pending');
    const before = Date.now();
    expect(await featured.confirm(ownerId, first.purchaseId)).toBe(true);
    // Webhook depois: não soma de novo
    expect(await featured.finalize(intents.get(purchase.stripePaymentIntentId!) as never)).toBe(
      true,
    );
    const shop1 = await prisma.barbershop.findUniqueOrThrow({ where: { id: shopId } });
    const until1 = shop1.featuredUntil!.getTime();
    expect(until1).toBeGreaterThanOrEqual(before + FEATURED_DAYS * DAY - 5_000);
    expect(until1).toBeLessThanOrEqual(Date.now() + FEATURED_DAYS * DAY + 5_000);
    expect((await featured.status(ownerId, 'barbershop', shopId)).isFeatured).toBe(true);

    // Segunda compra: soma 30 dias ao fim do Destaque que já vale
    const second = await featured.start(ownerId, 'barbershop', shopId);
    expect(second.purchaseId).not.toBe(first.purchaseId);
    const p2 = await prisma.featuredPurchase.findUniqueOrThrow({
      where: { id: second.purchaseId },
    });
    pay(p2.stripePaymentIntentId!);
    await featured.finalize(intents.get(p2.stripePaymentIntentId!) as never);
    const until2 = (
      await prisma.barbershop.findUniqueOrThrow({ where: { id: shopId } })
    ).featuredUntil!.getTime();
    expect(until2 - until1).toBe(FEATURED_DAYS * DAY);
    expect(
      (
        await prisma.featuredPurchase.findUniqueOrThrow({ where: { id: second.purchaseId } })
      ).featuredUntil!.getTime(),
    ).toBe(until2);
    // Backoffice: a compra aparece com a unidade e quem comprou
    const admin = await featured.adminPurchases();
    expect(admin.totalCount).toBeGreaterThanOrEqual(2);
    expect(admin.purchases.find((p) => p.id === second.purchaseId)).toMatchObject({
      ownerType: 'barbershop',
      ownerName: `Destaque ${RUN}`,
      buyerName: 'Destaque owner',
      amountCents: SHOP_PRICE,
    });

    // Aviso de vencimento: só perto do fim, uma vez por vencimento
    await featured.remindExpiring(new Date(until2 - 10 * DAY));
    expect(await reminders(ownerId)).toBe(0);
    await featured.remindExpiring(new Date(until2 - 2 * DAY));
    expect(await reminders(ownerId)).toBe(1);
    expect(pushed.some((ids) => ids.includes(ownerId))).toBe(true);
    await featured.remindExpiring(new Date(until2 - 1 * DAY));
    expect(await reminders(ownerId)).toBe(1);
    // Comprou mais: o novo vencimento terá o seu aviso
    const third = await featured.start(ownerId, 'barbershop', shopId);
    const p3 = await prisma.featuredPurchase.findUniqueOrThrow({ where: { id: third.purchaseId } });
    pay(p3.stripePaymentIntentId!);
    await featured.finalize(intents.get(p3.stripePaymentIntentId!) as never);
    await featured.remindExpiring(new Date(until2 + FEATURED_DAYS * DAY - 2 * DAY));
    expect(await reminders(ownerId)).toBe(2);

    // Compra de outra pessoa não se confirma por aqui
    await expect(featured.confirm(proUserId, second.purchaseId)).rejects.toThrow(
      'Compra não encontrada',
    );
  });

  it('profissional: só o próprio e com a página pública; sem Stripe fica indisponível', async () => {
    expect(await featured.status(proUserId, 'professional')).toMatchObject({
      available: false,
      needsPublicProfile: true,
    });
    await expect(featured.start(proUserId, 'professional')).rejects.toThrow('página pública');
    await expect(
      featured.status(proUserId, 'professional', professionalId + 999_999),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await prisma.professional.update({
      where: { id: professionalId },
      data: { visibility: 'public', isPublic: true },
    });
    // Profissional paga o preço dele (diferente do da unidade)
    const first = await featured.start(proUserId, 'professional');
    expect(first.priceCents).toBe(featuredOffer('professional').priceCents);
    expect(first.priceCents).toBe(DEFAULT_PRICING.featuredProPriceCents);
    // O admin mudou o preço com a compra aberta: não retoma a antiga
    setCurrentPricing({ featuredProPriceCents: 2500 });
    const checkout = await featured.start(proUserId, 'professional');
    expect(checkout.purchaseId).not.toBe(first.purchaseId);
    expect(checkout.priceCents).toBe(2500);
    expect(
      (await prisma.featuredPurchase.findUniqueOrThrow({ where: { id: first.purchaseId } })).status,
    ).toBe('canceled');
    setCurrentPricing({});
    const p = await prisma.featuredPurchase.findUniqueOrThrow({
      where: { id: checkout.purchaseId },
    });
    expect(p).toMatchObject({
      ownerType: 'professional',
      ownerId: professionalId,
      amountCents: 2500,
    });
    pay(p.stripePaymentIntentId!);
    await featured.confirm(proUserId, checkout.purchaseId);
    expect((await featured.status(proUserId, 'professional')).isFeatured).toBe(true);

    delete process.env.STRIPE_SECRET_KEY;
    expect((await featured.status(proUserId, 'professional')).available).toBe(false);
    await expect(featured.start(proUserId, 'professional')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    process.env.STRIPE_SECRET_KEY = 'sk_test_simulado';
    await expect(featured.status(proUserId, 'loja')).rejects.toThrow('Tipo inválido');
  });
});
