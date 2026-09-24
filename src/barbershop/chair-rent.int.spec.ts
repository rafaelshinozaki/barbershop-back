/**
 * Aluguel da cadeira no espaço compartilhado, contra o Postgres de verdade e
 * um Stripe simulado: o espaço define o valor, o profissional autoriza o
 * cartão, as faturas viram recibos (sem duplicar com evento repetido),
 * recusa, troca de cartão, mudança de valor e encerramento.
 */
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';
import { ChairRentService } from './chair-rent.service';
import { SharedLocationService } from './shared-location.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('Aluguel da cadeira (integração)', () => {
  const prisma = new PrismaService();
  const stub = {} as never;

  // Stripe simulado
  const calls: string[] = [];
  const subs = new Map<string, { status: string; price: string; pm: string; metadata: any }>();
  const nextSubStatus = 'incomplete';
  const stripe = {
    createProduct: async () => ({ id: `prod_${calls.length}` }),
    createPrice: async (_p: string, cents: number) => {
      calls.push(`price:${cents}`);
      return { id: `price_${RUN}_${cents}_${calls.length}` };
    },
    retrievePaymentMethod: async (id: string) => ({
      id,
      customer: id.startsWith('pm_member') ? `cus_member_${RUN}` : 'cus_someone_else',
    }),
    createSubscription: async (
      _customer: string,
      price: string,
      metadata: any,
      idempotencyKey: string,
      extra: any,
    ) => {
      calls.push(`subscribe:${idempotencyKey}`);
      // Mesma chave de idempotência = a mesma assinatura (como no Stripe)
      const id = `sub_${idempotencyKey}`;
      if (!subs.has(id)) {
        subs.set(id, { status: nextSubStatus, price, pm: extra.default_payment_method, metadata });
      }
      const sub = subs.get(id)!;
      return {
        id,
        status: sub.status,
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
        latest_invoice: { id: `in_first_${id}`, payment_intent: { client_secret: 'pi_secret' } },
      };
    },
    getSubscription: async (id: string) => ({
      id,
      items: { data: [{ id: `si_${id}` }] },
      latest_invoice: `in_open_${id}`,
    }),
    updateSubscription: async (id: string, data: any) => {
      calls.push(`update:${id}:${JSON.stringify(data)}`);
      return { id };
    },
    payInvoice: async (id: string, pm: string) => {
      calls.push(`pay:${id}:${pm}`);
      return { id };
    },
    cancelSubscription: async (id: string) => {
      calls.push(`cancel:${id}`);
      return { id };
    },
  };
  const events: string[] = [];
  const activity = {
    chairRentEvent: async (to: number, event: string) => void events.push(`${to}:${event}`),
    sharedLocationEvent: async () => undefined,
  };
  const emails: Array<{ template: string; to: string }> = [];
  const queue = { email: async (job: any) => void emails.push(job) };

  const barbershops = new BarbershopService(
    prisma,
    stub,
    stub,
    { isConfigured: () => false } as never,
    stripe as never,
    queue as never,
    { notify: () => undefined } as never,
  );
  const rent = new ChairRentService(
    prisma,
    stripe as never,
    barbershops,
    activity as never,
    queue as never,
  );
  const shared = new SharedLocationService(prisma, barbershops, activity as never, rent);

  let roleId: number;
  const shops: Record<'host' | 'member', { ownerId: number; shopId: number; networkId: number }> =
    {} as never;
  let linkId: number;

  const invoice = (id: string, subId: string, paid: boolean, cents = 50000) =>
    ({
      id,
      number: `N-${id}`,
      subscription: subId,
      amount_paid: paid ? cents : 0,
      amount_due: cents,
      currency: 'brl',
      created: Math.floor(Date.now() / 1000),
      hosted_invoice_url: `https://stripe.test/${id}`,
      invoice_pdf: `https://stripe.test/${id}.pdf`,
      lines: {
        data: [
          {
            period: {
              start: Math.floor(Date.now() / 1000),
              end: Math.floor(Date.now() / 1000) + 30 * 86400,
            },
          },
        ],
      },
    } as never);
  const link = () => prisma.sharedLocationMember.findUniqueOrThrow({ where: { id: linkId } });

  beforeAll(async () => {
    roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    for (const label of ['host', 'member'] as const) {
      const owner = await prisma.user.create({
        data: {
          email: `cr-${label}-${RUN}@test.local`,
          password: 'x',
          fullName: `Dono ${label}`,
          idDocNumber: `${RUN}${label}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'male',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
          stripeCustomerId: label === 'member' ? `cus_member_${RUN}` : null,
        },
      });
      const network = await prisma.network.create({
        data: { ownerUserId: owner.id, name: `Rede CR ${label} ${RUN}` },
      });
      const shop = await prisma.barbershop.create({
        data: {
          name: `CR ${label}`,
          slug: `cr-${label}-${RUN}`,
          address: 'Rua 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `cr-${label}-${RUN}@test.local`,
          timezone: 'America/Sao_Paulo',
          networkId: network.id,
          ownerUserId: owner.id,
        },
      });
      shops[label] = { ownerId: owner.id, shopId: shop.id, networkId: network.id };
    }
    linkId = (
      await prisma.sharedLocationMember.create({
        data: {
          hostBarbershopId: shops.host.shopId,
          memberBarbershopId: shops.member.shopId,
          status: 'PENDING',
        },
      })
    ).id;
  });

  afterAll(async () => {
    const shopIds = [shops.host.shopId, shops.member.shopId];
    await prisma.sharedLocationMember.deleteMany({ where: { hostBarbershopId: { in: shopIds } } });
    await prisma.barbershop.deleteMany({ where: { id: { in: shopIds } } });
    await prisma.network.deleteMany({
      where: { id: { in: [shops.host.networkId, shops.member.networkId] } },
    });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  it('só o espaço define o aluguel, e só depois do convite aceito', async () => {
    const { host, member } = shops;
    await expect(rent.setRent(host.ownerId, linkId, host.shopId, 500)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await prisma.sharedLocationMember.update({ where: { id: linkId }, data: { status: 'ACTIVE' } });
    // O profissional não define o próprio aluguel
    await expect(rent.setRent(member.ownerId, linkId, host.shopId, 500)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(rent.setRent(member.ownerId, linkId, member.shopId, 500)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(rent.setRent(host.ownerId, linkId, host.shopId, 0.5)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    const view = await rent.setRent(host.ownerId, linkId, host.shopId, 500);
    expect(view).toMatchObject({ status: 'AWAITING_PAYMENT', amount: 500, currency: 'BRL' });
    expect(events).toContain(`${member.shopId}:set`);
    // Definir o valor não depende do Stripe (o preço sai quando o profissional autoriza)
    expect(calls.filter((c) => c.startsWith('price:'))).toHaveLength(0);
  });

  it('profissional autoriza com cartão dele; dois cliques criam uma cobrança só', async () => {
    const { host, member } = shops;
    // Cartão de outra conta, ou quem não é dono do negócio: não
    await expect(
      rent.authorize(member.ownerId, linkId, member.shopId, 'pm_alheio'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      rent.authorize(host.ownerId, linkId, member.shopId, 'pm_member_1'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const results = await Promise.allSettled([
      rent.authorize(member.ownerId, linkId, member.shopId, 'pm_member_1'),
      rent.authorize(member.ownerId, linkId, member.shopId, 'pm_member_1'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const ok = results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>;
    expect(ok.value.clientSecret).toBe('pi_secret'); // primeira cobrança pede confirmação
    expect(calls.filter((c) => c.startsWith('subscribe:'))).toHaveLength(1);
    expect(calls.filter((c) => c.startsWith('price:'))).toEqual(['price:50000']);

    const l = await link();
    expect(l.rentStatus).toBe('INCOMPLETE');
    const sub = subs.get(l.rentStripeSubscriptionId!)!;
    expect(sub.pm).toBe('pm_member_1'); // cartão só desta cobrança
    expect(sub.metadata).toMatchObject({
      kind: 'chair-rent',
      sharedLocationMemberId: String(linkId),
    });
    expect(events).toContain(`${host.shopId}:started`);
  });

  it('fatura paga vira recibo (uma vez só) e o espaço vê o repasse', async () => {
    const { host, member } = shops;
    const subId = (await link()).rentStripeSubscriptionId!;
    expect(await rent.handleInvoice(invoice(`in_1_${RUN}`, subId, true), true)).toBe(true);
    // Stripe reenviando o mesmo evento
    await rent.handleInvoice(invoice(`in_1_${RUN}`, subId, true), true);
    // Evento de recusa atrasado da mesma fatura não desfaz o pagamento
    await rent.handleInvoice(invoice(`in_1_${RUN}`, subId, false), false);

    const l = await link();
    expect(l.rentStatus).toBe('ACTIVE');
    expect(l.rentPaidUntil!.getTime()).toBeGreaterThan(Date.now());
    const receipts = await rent.payments(member.ownerId, linkId, member.shopId);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      amount: 500,
      status: 'SUCCEEDED',
      receiptUrl: `https://stripe.test/in_1_${RUN}`,
    });
    expect(emails.filter((e) => e.template === 'invoice_email')).toHaveLength(1);
    expect(events.filter((e) => e === `${host.shopId}:paid`)).toHaveLength(1);

    const hostView = await rent.view(linkId, host.shopId);
    expect(hostView).toMatchObject({ isHost: true, totalReceived: 500, payoutDue: 425 });
    const memberView = await rent.view(linkId, member.shopId);
    expect(memberView).toMatchObject({ isHost: false, totalReceived: 500, payoutDue: null });
    // Fatura de outra assinatura não é do aluguel
    expect(await rent.handleInvoice(invoice(`in_x_${RUN}`, 'sub_outra', true), true)).toBe(false);
  });

  it('cobrança recusada: os dois são avisados; trocar o cartão tenta a fatura na hora', async () => {
    const { host, member } = shops;
    const subId = (await link()).rentStripeSubscriptionId!;
    await rent.handleInvoice(invoice(`in_2_${RUN}`, subId, false), false);
    expect((await link()).rentStatus).toBe('PAST_DUE');
    expect(events).toEqual(
      expect.arrayContaining([`${member.shopId}:failed`, `${host.shopId}:failed`]),
    );

    await rent.authorize(member.ownerId, linkId, member.shopId, 'pm_member_2');
    expect(calls).toContain(
      `update:${subId}:${JSON.stringify({ default_payment_method: 'pm_member_2' })}`,
    );
    expect(calls).toContain(`pay:in_open_${subId}:pm_member_2`);
    // Nenhuma assinatura nova
    expect(calls.filter((c) => c.startsWith('subscribe:'))).toHaveLength(1);

    await rent.handleInvoice(invoice(`in_2_${RUN}`, subId, true), true);
    expect((await link()).rentStatus).toBe('ACTIVE');
    expect((await rent.view(linkId, host.shopId)).totalReceived).toBe(1000);
  });

  it('mudar o valor com a cobrança rodando vale na próxima fatura, sem proporcional', async () => {
    const { host, member } = shops;
    const subId = (await link()).rentStripeSubscriptionId!;
    const view = await rent.setRent(host.ownerId, linkId, host.shopId, 650);
    expect(view).toMatchObject({ status: 'ACTIVE', amount: 650 });
    const update = calls.filter((c) => c.startsWith(`update:${subId}:`)).pop()!;
    expect(update).toContain('"proration_behavior":"none"');
    expect(update).toContain(`"id":"si_${subId}"`);
    expect(events).toContain(`${member.shopId}:changed`);
  });

  it('assinatura cancelada pelo Stripe: volta a aguardar autorização, com o mesmo valor', async () => {
    const subId = (await link()).rentStripeSubscriptionId!;
    expect(await rent.handleSubscriptionDeleted(subId)).toBe(true);
    const l = await link();
    expect(l).toMatchObject({ rentStatus: 'AWAITING_PAYMENT', rentStripeSubscriptionId: null });
    expect(Number(l.rentAmount)).toBe(650);
    expect(await rent.handleSubscriptionDeleted('sub_outra')).toBe(false);
  });

  it('profissional sai do espaço: a cobrança mensal é cancelada no Stripe', async () => {
    const { member } = shops;
    await rent.authorize(member.ownerId, linkId, member.shopId, 'pm_member_3');
    const subId = (await link()).rentStripeSubscriptionId!;
    expect(subId).toBeTruthy();
    await shared.end(member.ownerId, linkId, member.shopId);
    expect(calls).toContain(`cancel:${subId}`);
    const l = await link();
    expect(l).toMatchObject({
      status: 'REMOVED',
      rentStatus: 'NONE',
      rentStripeSubscriptionId: null,
    });
    // Os recibos continuam lá
    expect(await prisma.chairRentPayment.count({ where: { sharedLocationMemberId: linkId } })).toBe(
      2,
    );
  });
});
