/**
 * Cupom no checkout do plano, contra o Postgres de verdade (Stripe
 * simulado): antes o cupom só mexia no registro do pagamento, nunca no valor
 * cobrado pelo Stripe — o "1 mês grátis" do convite de amigo não funcionava.
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CouponsService, COUPON_TYPE } from './coupons.service';
import { PaymentsService } from './payments.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('Cupom no checkout do plano (integração com o banco)', () => {
  const prisma = new PrismaService();
  const coupons = new CouponsService(prisma);
  const intents = new Map<string, { amount: number; metadata: Record<string, string> }>();
  let seq = 0;
  const stripe = {
    getCustomer: async () => ({ id: 'cus_test' }),
    createCustomer: async () => ({ id: 'cus_test' }),
    createPaymentIntent: async (amount: number) => {
      const id = `pi_${RUN}_${++seq}`;
      intents.set(id, { amount, metadata: {} });
      return { id, client_secret: `${id}_secret_x` };
    },
    updatePaymentIntent: async (id: string, data: { metadata: Record<string, string> }) => {
      intents.get(id)!.metadata = data.metadata;
    },
    retrievePaymentIntent: async (id: string) => ({
      id,
      status: 'succeeded',
      metadata: intents.get(id)!.metadata,
    }),
  };
  const payments = new PaymentsService(prisma, stripe as never, {} as never, coupons);

  let userId: number;
  let planId: number;
  const createdCoupons: number[] = [];

  const newCoupon = async (type: COUPON_TYPE, value: number) => {
    const c = await coupons.createCoupon({
      code: `C${createdCoupons.length}${type.slice(0, 3)}${RUN}`.slice(0, 30),
      name: 'Teste',
      type,
      value,
    });
    createdCoupons.push(c.id);
    return c;
  };

  beforeAll(async () => {
    const role =
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }));
    userId = (
      await prisma.user.create({
        data: {
          email: `cup-${RUN}@test.local`,
          password: 'x',
          fullName: 'Teste Cupom',
          idDocNumber: `cup${RUN}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'male',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          isActive: true,
          stripeCustomerId: 'cus_test',
          roleId: role.id,
        },
      })
    ).id;
    planId = (
      await prisma.plan.create({
        data: { name: `Plano ${RUN}`, price: new Prisma.Decimal(100), billingCycle: 'MONTHLY' },
      })
    ).id;
  });

  afterAll(async () => {
    const subs = await prisma.subscription.findMany({ where: { userId } });
    await prisma.payment.deleteMany({ where: { subscriptionId: { in: subs.map((s) => s.id) } } });
    await prisma.subscription.deleteMany({ where: { userId } });
    await prisma.userCoupon.deleteMany({ where: { userId } });
    await prisma.$executeRaw`DELETE FROM "Coupon" WHERE id = ANY(${createdCoupons})`;
    await prisma.$executeRaw`DELETE FROM "Plan" WHERE id = ${planId}`;
    await prisma.$executeRaw`DELETE FROM "User" WHERE id = ${userId}`;
    await prisma.$disconnect();
  });

  it('cupom de 10%: cobra 90 no Stripe e registra o cupom quando o pagamento confirma', async () => {
    const coupon = await newCoupon(COUPON_TYPE.PERCENTAGE, 10);
    const result = await payments.createPaymentIntentForCheckout(userId, planId, coupon.code);
    expect(result).toMatchObject({
      activated: false,
      originalAmount: 100,
      discountAmount: 10,
      finalAmount: 90,
    });
    expect(intents.get(result.paymentIntentId!)!.amount).toBe(9000);

    // Sem confirmar, o cupom ainda não foi usado
    expect((await prisma.coupon.findUnique({ where: { id: coupon.id } }))!.usedCount).toBe(0);

    await payments.confirmPaymentIntent(result.paymentIntentId!);
    const payment = await prisma.payment.findFirst({
      where: { transactionId: result.paymentIntentId },
    });
    expect(Number(payment!.amount)).toBe(90);
    expect(Number(payment!.discountAmount)).toBe(10);
    expect(payment!.appliedCouponId).toBe(coupon.id);
    expect((await prisma.coupon.findUnique({ where: { id: coupon.id } }))!.usedCount).toBe(1);

    // Confirmar de novo (duplo clique) não duplica assinatura nem uso do cupom
    await payments.confirmPaymentIntent(result.paymentIntentId!);
    expect(await prisma.payment.count({ where: { transactionId: result.paymentIntentId } })).toBe(
      1,
    );
    expect((await prisma.coupon.findUnique({ where: { id: coupon.id } }))!.usedCount).toBe(1);

    // E o mesmo usuário não usa o cupom duas vezes
    await expect(
      payments.createPaymentIntentForCheckout(userId, planId, coupon.code),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('1 mês grátis: ativa o plano sem cobrança no Stripe', async () => {
    const coupon = await newCoupon(COUPON_TYPE.FREE_MONTH, 0);
    const before = intents.size;
    const result = await payments.createPaymentIntentForCheckout(userId, planId, coupon.code);
    expect(result).toMatchObject({
      activated: true,
      clientSecret: null,
      finalAmount: 0,
      discountAmount: 100,
    });
    expect(intents.size).toBe(before); // nenhuma cobrança criada

    const active = await prisma.subscription.findFirst({
      where: { userId, status: 'ACTIVE' },
      include: { payments: true },
    });
    expect(active!.planId).toBe(planId);
    expect(Number(active!.payments[0].amount)).toBe(0);
    expect(active!.payments[0].paymentMethod).toBe('coupon');
    expect(active!.payments[0].appliedCouponId).toBe(coupon.id);
  });

  it('cupom de valor fixo maior que o preço não gera valor negativo', async () => {
    const coupon = await newCoupon(COUPON_TYPE.FIXED_AMOUNT, 150);
    const result = await payments.createPaymentIntentForCheckout(userId, planId, coupon.code);
    expect(result).toMatchObject({ activated: true, discountAmount: 100, finalAmount: 0 });
  });

  it('cupom inválido: erro com o motivo, nada cobrado', async () => {
    await expect(
      payments.createPaymentIntentForCheckout(userId, planId, 'NAO-EXISTE'),
    ).rejects.toThrow(BadRequestException);
  });

  describe('gestão no backoffice', () => {
    it('código repetido dá erro legível; edição grava planos e código maiúsculo', async () => {
      const coupon = await newCoupon(COUPON_TYPE.PERCENTAGE, 5);
      await expect(
        coupons.createCoupon({
          code: coupon.code.toLowerCase(),
          name: 'x',
          type: COUPON_TYPE.PERCENTAGE,
          value: 1,
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      const newCode = `ED${RUN}`.slice(0, 30);
      const updated = await coupons.updateCoupon(coupon.id, {
        code: newCode.toLowerCase(),
        applicablePlans: [planId],
        isActive: false,
      });
      expect(updated.code).toBe(newCode);
      expect(JSON.parse(updated.applicablePlans!)).toEqual([planId]);
      expect(updated.isActive).toBe(false);

      // Tirar todos os planos = volta a valer pra qualquer plano
      const cleared = await coupons.updateCoupon(coupon.id, { applicablePlans: [] });
      expect(cleared.applicablePlans).toBeNull();
    });

    it('cupom apagado não vale mais nem aparece em "meus cupons"', async () => {
      const coupon = await newCoupon(COUPON_TYPE.FIXED_AMOUNT, 7);
      await prisma.userCoupon.create({ data: { userId, couponId: coupon.id } });
      expect((await coupons.getCouponsForUser(userId)).map((c) => c.id)).toContain(coupon.id);

      await coupons.deleteCoupon(coupon.id);
      expect((await coupons.getCouponsForUser(userId)).map((c) => c.id)).not.toContain(coupon.id);
      expect((await coupons.validateCoupon(coupon.code, userId, planId, 100)).isValid).toBe(false);
    });

    it('"meus cupons" não lista o que já foi usado', async () => {
      const used = await prisma.userCoupon.findMany({ where: { userId, usedAt: { not: null } } });
      expect(used.length).toBeGreaterThan(0);
      const mine = (await coupons.getCouponsForUser(userId)).map((c) => c.id);
      for (const uc of used) expect(mine).not.toContain(uc.couponId);
    });
  });
});
