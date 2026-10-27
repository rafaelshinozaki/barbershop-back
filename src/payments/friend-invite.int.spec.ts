/**
 * Convidar amigos (item 218), contra o Postgres de verdade (Stripe e e-mail
 * simulados): o token não volta para quem convida, o aceite exige o e-mail
 * confirmado e quem convidou só ganha o mês grátis quando o amigo paga.
 */
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CouponsService } from './coupons.service';
import { FRIEND_EMAIL_NOT_CONFIRMED, FriendInviteService } from './friend-invite.service';
import { CHECKOUT_HAS_PAID_PLAN, PaymentsService } from './payments.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('Convidar amigos (integração)', () => {
  const prisma = new PrismaService();
  const coupons = new CouponsService(prisma);
  const emails: string[] = [];
  const mailer = { sendTemplateEmail: async (...a: unknown[]) => void emails.push(a[1] as string) };
  const invites = new FriendInviteService(prisma, mailer as never, coupons, {
    get: () => 'https://app.test',
  } as never);
  const intents = new Map<string, { metadata: Record<string, string> }>();
  let seq = 0;
  const stripe = {
    getCustomer: async () => ({ id: 'cus_test' }),
    createCustomer: async () => ({ id: 'cus_test' }),
    createPaymentIntent: async () => {
      const id = `pi_fi_${RUN}_${++seq}`;
      intents.set(id, { metadata: {} });
      return { id, client_secret: `${id}_secret` };
    },
    updatePaymentIntent: async (id: string, data: { metadata: Record<string, string> }) => {
      intents.get(id)!.metadata = data.metadata;
    },
    retrievePaymentIntent: async (id: string) => ({
      id,
      status: 'succeeded',
      metadata: intents.get(id)!.metadata,
    }),
    cancelPaymentIntent: async () => undefined,
  };
  const payments = new PaymentsService(prisma, stripe as never, mailer as never, coupons);

  let roleId: number;
  let inviterId: number;
  let planId: number;
  const userIds: number[] = [];

  const user = async (label: string, verified: boolean) => {
    const u = await prisma.user.create({
      data: {
        email: `fi-${label}-${RUN}@test.local`,
        password: 'x',
        fullName: `Pessoa ${label}`,
        idDocNumber: `fi${label}${RUN}`.slice(-20),
        phone: `+5511${RUN}`.slice(0, 20),
        gender: 'female',
        birthdate: new Date('1990-01-01'),
        readTerms: true,
        isActive: true,
        stripeCustomerId: 'cus_test',
        emailVerifiedAt: verified ? new Date() : null,
        roleId,
      },
    });
    userIds.push(u.id);
    return u;
  };

  beforeAll(async () => {
    roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    inviterId = (await user('quem-convida', true)).id;
    planId = (
      await prisma.plan.create({
        data: { name: `Plano FI ${RUN}`, price: new Prisma.Decimal(100), billingCycle: 'MONTHLY' },
      })
    ).id;
  });

  afterAll(async () => {
    const invitesOf = await prisma.friendInvite.findMany({ where: { inviterId } });
    const couponIds = invitesOf.flatMap((i) => [i.inviterCouponId, i.friendCouponId]);
    await prisma.friendInvite.deleteMany({ where: { inviterId } });
    const subs = await prisma.subscription.findMany({ where: { userId: { in: userIds } } });
    await prisma.payment.deleteMany({ where: { subscriptionId: { in: subs.map((s) => s.id) } } });
    await prisma.subscription.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userCoupon.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.coupon.deleteMany({
      where: { id: { in: couponIds.filter((id): id is number => id != null) } },
    });
    await prisma.plan.deleteMany({ where: { id: planId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('token fora da resposta; aceite exige e-mail confirmado; quem convida ganha quando o amigo paga', async () => {
    const created = await invites.createInvite(inviterId, `fi-amiga-${RUN}@test.local`);
    expect(created).not.toHaveProperty('inviteToken');
    for (const sent of await invites.getSentInvites(inviterId)) {
      expect(sent).not.toHaveProperty('inviteToken');
    }
    const { inviteToken } = await prisma.friendInvite.findUniqueOrThrow({
      where: { id: created.id },
    });

    // Conta criada com o e-mail convidado, sem confirmar: não aceita
    const friend = await user('amiga', false);
    await expect(invites.acceptInvite(inviteToken, friend.id)).rejects.toThrow(
      FRIEND_EMAIL_NOT_CONFIRMED,
    );
    await prisma.user.update({ where: { id: friend.id }, data: { emailVerifiedAt: new Date() } });
    const accepted = await invites.acceptInvite(inviteToken, friend.id);
    expect(accepted.success).toBe(true);
    let row = await prisma.friendInvite.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.friendCouponId).not.toBeNull();
    expect(row.inviterCouponId).toBeNull();

    // O amigo assina um plano pago: agora quem convidou ganha o mês grátis
    const checkout = await payments.createPaymentIntentForCheckout(friend.id, planId);
    await payments.confirmPaymentIntent(friend.id, checkout.paymentIntentId!);
    row = await prisma.friendInvite.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.inviterCouponId).not.toBeNull();
    expect(
      await prisma.userCoupon.count({
        where: { userId: inviterId, couponId: row.inviterCouponId! },
      }),
    ).toBe(1);
    expect(emails).toContain('friend_invite_accepted_inviter');

    // Outro pagamento não dá outro mês: com o plano pago ativo, o checkout
    // nem abre (vai para a troca de plano, item 306)
    await expect(payments.createPaymentIntentForCheckout(friend.id, planId)).rejects.toThrow(
      CHECKOUT_HAS_PAID_PLAN,
    );
    expect(
      await prisma.coupon.count({
        where: { code: { startsWith: `FRIEND_INVITER_${created.id}_` } },
      }),
    ).toBe(1);
  });
});
