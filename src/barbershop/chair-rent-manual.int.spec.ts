/**
 * Aluguel da cadeira pago direto ao espaço (PIX, dinheiro, transferência),
 * contra o Postgres de verdade: mensalidades geradas todo mês, atraso
 * avisado uma vez, pagamento registrado com o método (dinheiro no caixa,
 * despesa no negócio do profissional), recibo, desfazer e a taxa da
 * plataforma só no que passa pelo Stripe.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';
import { ChairRentService } from './chair-rent.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const DAY = 86_400_000;

describe('Aluguel da cadeira pago direto ao espaço (integração)', () => {
  const prisma = new PrismaService();
  const stub = {} as never;
  const stripeCalls: string[] = [];
  // Qualquer chamada ao Stripe é registrada: no modo manual não pode haver nenhuma
  const stripe = new Proxy(
    {},
    {
      get: (_t, name) => async () => {
        stripeCalls.push(String(name));
        return { id: `x_${String(name)}` };
      },
    },
  );
  const events: string[] = [];
  const activity = {
    chairRentEvent: async (to: number, event: string) => void events.push(`${to}:${event}`),
  };
  const emails: Array<{ template: string; context: any }> = [];
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

  const shops: Record<'host' | 'member', { ownerId: number; shopId: number; networkId: number }> =
    {} as never;
  let linkId: number;
  const dues = () =>
    prisma.chairRentPayment.findMany({
      where: { sharedLocationMemberId: linkId },
      orderBy: { dueDate: 'asc' },
    });

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    for (const label of ['host', 'member'] as const) {
      const owner = await prisma.user.create({
        data: {
          email: `crm-${label}-${RUN}@test.local`,
          password: 'x',
          fullName: `Dono ${label}`,
          idDocNumber: `${RUN}m${label}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'male',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      });
      const network = await prisma.network.create({
        data: { ownerUserId: owner.id, name: `Rede CRM ${label} ${RUN}` },
      });
      const shop = await prisma.barbershop.create({
        data: {
          name: `CRM ${label}`,
          slug: `crm-${label}-${RUN}`,
          address: 'Rua 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `crm-${label}-${RUN}@test.local`,
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
          status: 'ACTIVE',
        },
      })
    ).id;
  });

  afterAll(async () => {
    const shopIds = [shops.host.shopId, shops.member.shopId];
    await prisma.expense.deleteMany({ where: { barbershopId: { in: shopIds } } });
    await prisma.chairRentPayment.deleteMany({ where: { sharedLocationMemberId: linkId } });
    await prisma.cashSession.deleteMany({ where: { barbershopId: { in: shopIds } } });
    await prisma.sharedLocationMember.deleteMany({ where: { id: linkId } });
    await prisma.barbershop.deleteMany({ where: { id: { in: shopIds } } });
    await prisma.network.deleteMany({
      where: { id: { in: [shops.host.networkId, shops.member.networkId] } },
    });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  it('definir aluguel manual não passa pelo Stripe e gera a mensalidade de hoje', async () => {
    const view = await rent.setRent(shops.host.ownerId, linkId, shops.host.shopId, 400, 'MANUAL');
    expect(stripeCalls).toEqual([]);
    expect(view).toMatchObject({
      billingMode: 'MANUAL',
      status: 'DUE',
      amount: 400,
      openAmount: 400,
    });
    expect(view.nextDueDate!.getTime()).toBeGreaterThan(Date.now());
    const [first] = await dues();
    expect(first).toMatchObject({ status: 'DUE' });
    expect(Math.abs(first.dueDate!.getTime() - Date.now())).toBeLessThan(DAY);
    expect(events).toEqual(
      expect.arrayContaining([`${shops.member.shopId}:manualSet`, `${shops.member.shopId}:due`]),
    );
    // Cartão não existe nesse modo
    await expect(
      rent.authorize(shops.member.ownerId, linkId, shops.member.shopId, 'pm_x'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('uma mensalidade por mês, sem duplicar; atraso avisado uma vez só', async () => {
    // Começou num dia 31, há uns 3 meses: vence todo dia 28
    let startedAt = new Date(0);
    for (let back = 2; back < 6; back++) {
      const ref = new Date(Date.now() - back * 30 * DAY);
      const candidate = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 31, 12));
      if (candidate.getUTCDate() === 31) {
        startedAt = candidate;
        break;
      }
    }
    await prisma.chairRentPayment.deleteMany({ where: { sharedLocationMemberId: linkId } });
    await prisma.sharedLocationMember.update({
      where: { id: linkId },
      data: { rentStartedAt: startedAt },
    });
    await Promise.all([rent.ensureDues(linkId), rent.ensureDues(linkId), rent.ensureDues(linkId)]);
    const list = await dues();
    const expected = [startedAt];
    let d = startedAt;
    for (;;) {
      d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 28, 12));
      if (d.getTime() > Date.now()) break;
      expected.push(d);
    }
    expect(list.map((x) => x.dueDate!.toISOString())).toEqual(expected.map((x) => x.toISOString()));

    const view = await rent.view(linkId, shops.member.shopId);
    expect(view.status).toBe('PAST_DUE');
    expect(view.openAmount).toBe(400 * list.length);

    events.length = 0;
    await rent.processManualDues();
    await rent.processManualDues();
    const overdueCount = list.filter((x) => x.dueDate!.getTime() + DAY < Date.now()).length;
    expect(events.filter((e) => e === `${shops.member.shopId}:overdue`)).toHaveLength(overdueCount);
    expect(events.filter((e) => e === `${shops.host.shopId}:overdue`)).toHaveLength(overdueCount);
  });

  it('o espaço registra o pagamento: dinheiro no caixa, despesa pro profissional, recibo', async () => {
    const { host, member } = shops;
    const [oldest] = await dues();
    await expect(
      rent.recordPayment(member.ownerId, oldest.id, host.shopId, 'PIX'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      rent.recordPayment(host.ownerId, oldest.id, host.shopId, 'CHEQUE'),
    ).rejects.toBeInstanceOf(BadRequestException);

    await barbershops.openCashSession(host.ownerId, host.shopId, 100);
    // Dois cliques: um registro só
    const results = await Promise.allSettled([
      rent.recordPayment(host.ownerId, oldest.id, host.shopId, 'CASH', 'pago na mão'),
      rent.recordPayment(host.ownerId, oldest.id, host.shopId, 'CASH', 'pago na mão'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const paid = await prisma.chairRentPayment.findUniqueOrThrow({ where: { id: oldest.id } });
    expect(paid).toMatchObject({ status: 'SUCCEEDED', method: 'CASH', notes: 'pago na mão' });
    expect(paid.cashSessionId).not.toBeNull();

    const expenses = await prisma.expense.findMany({ where: { barbershopId: member.shopId } });
    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toMatchObject({ category: 'RENT', paymentMethod: 'CASH' });
    expect(Number(expenses[0].amount)).toBe(400);

    const receipt = await rent.receipt(member.ownerId, oldest.id, member.shopId);
    expect(receipt).toMatchObject({
      receiptNumber: `ALG-${String(oldest.id).padStart(6, '0')}`,
      method: 'CASH',
      hostName: 'CRM host',
      memberName: 'CRM member',
      recordedByName: 'Dono host',
    });
    expect(events).toContain(`${member.shopId}:received`);
    expect(emails.some((e) => e.context.InvoiceURL?.includes(`/rent-receipt/${oldest.id}`))).toBe(
      true,
    );

    // Uma segunda por PIX: não entra no caixa
    const [, second] = await dues();
    await rent.recordPayment(host.ownerId, second.id, host.shopId, 'PIX');
    const closed = await barbershops.closeCashSession(host.ownerId, host.shopId, {
      countedBalance: 500,
    });
    expect(Number(closed.expectedBalance)).toBe(500); // 100 de abertura + 400 do aluguel
    expect(Number(closed.difference)).toBe(0);

    // Resumo financeiro do espaço: o aluguel recebido direto conta
    const summary = await barbershops.getFinancialSummary(
      host.ownerId,
      host.shopId,
      new Date(Date.now() - DAY),
      new Date(Date.now() + DAY),
    );
    expect(summary.chairRentIncome).toBe(800);
    expect(summary.netProfit).toBe(summary.totalRevenue + 800 - summary.totalExpenses);

    // Taxa da plataforma só no que passa pelo Stripe: nada a repassar aqui
    const view = await rent.view(linkId, host.shopId);
    expect(view).toMatchObject({ totalReceived: 800, payoutDue: 0 });
  });

  it('desfazer registro errado; em caixa já fechado não dá', async () => {
    const { host, member } = shops;
    const [cash, pix] = await dues();
    await expect(rent.undoPayment(host.ownerId, cash.id, host.shopId)).rejects.toThrow('caixa');
    await rent.undoPayment(host.ownerId, pix.id, host.shopId);
    const back = await prisma.chairRentPayment.findUniqueOrThrow({ where: { id: pix.id } });
    expect(back).toMatchObject({ status: 'DUE', paidAt: null, memberExpenseId: null });
    expect(await prisma.expense.count({ where: { barbershopId: member.shopId } })).toBe(1);
  });

  it('voltar pro cartão: novas mensalidades param; as em aberto continuam a receber', async () => {
    const { host, member } = shops;
    const before = (await dues()).length;
    const view = await rent.setRent(host.ownerId, linkId, host.shopId, 400, 'CARD');
    expect(view.billingMode).toBe('CARD');
    await rent.ensureDues(linkId);
    expect((await dues()).length).toBe(before);
    const open = (await dues()).find((x) => x.status === 'DUE')!;
    await rent.recordPayment(host.ownerId, open.id, host.shopId, 'TRANSFER');
    expect((await rent.payments(member.ownerId, linkId, member.shopId)).length).toBe(before);
  });
});
