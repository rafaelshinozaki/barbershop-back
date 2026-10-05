/**
 * Planos (tela Planos do backoffice) contra o banco, com a Stripe de mentira:
 * mudar o preço cria um preço novo no MESMO produto do plano; remover só
 * tira da lista (deleted_at) e não sai com assinatura ativa.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { StripeService } from '../stripe/stripe.service';
import { PLANO_STATUS } from '../common/contants';
import { PlanService } from './plan.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('planos (integração)', () => {
  const prisma = new PrismaService();
  const calls: { product: string; amount: number; interval?: string }[] = [];
  const stripe = {
    getPriceProductId: async (priceId: string) => `prod_de_${priceId}`,
    createProduct: async () => ({ id: 'prod_novo' }),
    createPrice: async (
      product: string,
      amount: number,
      _c: string,
      rec?: { interval: string },
    ) => {
      calls.push({ product, amount, interval: rec?.interval });
      return { id: `price_${calls.length}_${RUN}` };
    },
  } as unknown as StripeService;
  const service = new PlanService(prisma, stripe);
  const planIds: number[] = [];
  let userId: number;

  const createPlan = async (stripePriceId: string | null) => {
    const plan = await prisma.plan.create({
      data: { name: `Plano ${RUN}`, price: 10, billingCycle: 'MONTHLY', stripePriceId },
    });
    planIds.push(plan.id);
    return plan;
  };

  beforeAll(async () => {
    const role =
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }));
    userId = (
      await prisma.user.create({
        data: {
          email: `plano-${RUN}@test.local`,
          password: 'x',
          fullName: 'Dono Plano',
          idDocNumber: `${RUN}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'male',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId: role.id,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.subscription.deleteMany({ where: { planId: { in: planIds } } });
    await prisma.plan.deleteMany({ where: { id: { in: planIds } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('mudar o preço cria o preço novo no produto do plano; só o texto não mexe na Stripe', async () => {
    const plan = await createPlan('price_antigo');
    const updated = await service.updatePlan(plan.id, { price: 12.5 });
    expect(calls.at(-1)).toEqual({
      product: 'prod_de_price_antigo',
      amount: 1250,
      interval: 'month',
    });
    expect(updated.stripePriceId).toBe(`price_${calls.length}_${RUN}`);
    expect(Number(updated.price)).toBe(12.5);

    const before = calls.length;
    const renamed = await service.updatePlan(plan.id, { name: 'Novo nome', features: 'A, B' });
    expect(calls.length).toBe(before);
    expect(renamed).toMatchObject({ name: 'Novo nome', features: 'A, B' });
  });

  it('plano sem preço na Stripe: cria o produto ao mudar o ciclo', async () => {
    const plan = await createPlan(null);
    await service.updatePlan(plan.id, { billingCycle: 'YEARLY' });
    expect(calls.at(-1)).toMatchObject({ product: 'prod_novo', interval: 'year' });
  });

  it('remover tira da lista sem apagar; com assinatura ativa, não sai', async () => {
    const used = await createPlan('price_x');
    await prisma.subscription.create({
      data: { userId, planId: used.id, startSubDate: new Date(), status: PLANO_STATUS.ACTIVE },
    });
    await expect(service.removePlan(used.id)).rejects.toBeInstanceOf(BadRequestException);

    const free = await createPlan('price_y');
    await service.removePlan(free.id);
    // A linha continua no banco (o soft delete do PrismaService a esconde das buscas)
    const rows = await prisma.$queryRaw<{ deleted_at: Date | null }[]>`
      SELECT deleted_at FROM "Plan" WHERE id = ${free.id}`;
    expect(rows[0]?.deleted_at).toBeInstanceOf(Date);
    expect((await service.findAllPlans()).some((p) => p.id === free.id)).toBe(false);
    // Removido não se edita nem se remove de novo
    await expect(service.updatePlan(free.id, { name: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.removePlan(free.id)).rejects.toBeInstanceOf(NotFoundException);
  });
});
