/**
 * Pagamento da equipe, contra o Postgres de verdade: forma de pagamento
 * (comissão, fixo, fixo + comissão, o maior dos dois), gorjeta/vale/bônus/
 * desconto, fechamento pago (despesa "Salário", caixa, sem pagar duas
 * vezes), vale maior que o devido, desfazer, extrato do profissional e a
 * visão do dono.
 */
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';
import { PayrollService } from './payroll.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const MONTH_FROM = '2026-08-01';
const MONTH_TO = '2026-08-31';
const inAugust = (day: number) =>
  new Date(`2026-08-${String(day).padStart(2, '0')}T15:00:00-03:00`);

describe('Pagamento da equipe (integração)', () => {
  const prisma = new PrismaService();
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
  const payroll = new PayrollService(prisma, barbershops);

  let ownerId: number;
  let barberUserId: number;
  let networkId: number;
  let shopId: number;
  let ana: number; // barbeira com conta
  let beto: number;

  const createUser = (label: string, roleId: number) =>
    prisma.user.create({
      data: {
        email: `pay-${label}-${RUN}@test.local`,
        password: 'x',
        fullName: `Teste ${label}`,
        idDocNumber: `${RUN}${label}`.slice(-20),
        phone: `+5511${RUN}`.slice(0, 20),
        gender: 'male',
        birthdate: new Date('1990-01-01'),
        readTerms: true,
        roleId,
      },
    });
  const sale = (barberId: number, day: number, service: number, product = 0) =>
    prisma.sale.create({
      data: {
        barbershopId: shopId,
        barberId,
        saleType: product ? 'MIXED' : 'SERVICE',
        subtotal: new Decimal(service + product),
        total: new Decimal(service + product),
        paymentStatus: 'PAID',
        paymentMethod: 'PIX',
        createdAt: inAugust(day),
        items: {
          create: [
            { itemType: 'SERVICE', quantity: 1, unitPrice: service, totalPrice: service },
            ...(product
              ? [{ itemType: 'PRODUCT', quantity: 1, unitPrice: product, totalPrice: product }]
              : []),
          ],
        },
      },
    });

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = (await createUser('owner', roleId)).id;
    barberUserId = (await createUser('ana', roleId)).id;
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede Pay ${RUN}` } })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: 'Pay',
          slug: `pay-${RUN}`,
          address: 'Rua 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `pay-${RUN}@test.local`,
          timezone: 'America/Sao_Paulo',
          networkId,
          ownerUserId: ownerId,
        },
      })
    ).id;
    ana = (
      await prisma.barber.create({
        data: {
          barbershopId: shopId,
          userId: barberUserId,
          name: 'Ana',
          phone: '11911111111',
          staffType: 'barber',
        },
      })
    ).id;
    beto = (
      await prisma.barber.create({
        data: { barbershopId: shopId, name: 'Beto', phone: '11922222222' },
      })
    ).id;
    // 40% sobre tudo, pra unidade toda
    await prisma.commissionRule.create({
      data: { barbershopId: shopId, itemType: 'ALL', percentage: new Decimal(40) },
    });
    await sale(ana, 5, 100, 50); // comissão 60
    await sale(ana, 20, 100); // comissão 40
    await sale(ana, 2, 1000).then((s) =>
      // Fora do período (julho): não entra
      prisma.sale.update({
        where: { id: s.id },
        data: { createdAt: new Date('2026-07-20T12:00:00Z') },
      }),
    );
    await sale(beto, 10, 50); // comissão 20
  });

  afterAll(async () => {
    await prisma.barberPayEntry.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barberPayout.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barberPayConfig.deleteMany({ where: { barbershopId: shopId } });
    await prisma.expense.deleteMany({ where: { barbershopId: shopId } });
    await prisma.saleItem.deleteMany({ where: { sale: { barbershopId: shopId } } });
    await prisma.sale.deleteMany({ where: { barbershopId: shopId } });
    await prisma.cashSession.deleteMany({ where: { barbershopId: shopId } });
    await prisma.commissionRule.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barber.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  it('forma de pagamento: só dono/gerente define; fixo precisa de valor', async () => {
    await expect(
      payroll.setConfig(barberUserId, shopId, ana, { payType: 'COMMISSION' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      payroll.setConfig(ownerId, shopId, ana, { payType: 'FIXED' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      payroll.setConfig(ownerId, shopId, ana, { payType: 'SALARIO' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Sem configurar, é só comissão
    const commissionOnly = await payroll.preview(ownerId, shopId, ana, MONTH_FROM, MONTH_TO);
    expect(commissionOnly).toMatchObject({
      payType: 'COMMISSION',
      salesCount: 2,
      serviceSales: 200,
      productSales: 50,
      commission: 100,
      baseAmount: 100,
    });

    // Data que não existe e período de décadas: recusados
    await expect(payroll.preview(ownerId, shopId, ana, '2026-02-31', MONTH_TO)).rejects.toThrow(
      'Período inválido',
    );
    await expect(payroll.preview(ownerId, shopId, ana, '2000-01-01', MONTH_TO)).rejects.toThrow(
      'no máximo',
    );
    await payroll.setConfig(ownerId, shopId, ana, { payType: 'GREATER_OF', fixedAmount: 80 });
    expect((await payroll.preview(ownerId, shopId, ana, MONTH_FROM, MONTH_TO)).baseAmount).toBe(
      100,
    );
    await payroll.setConfig(ownerId, shopId, ana, { payType: 'GREATER_OF', fixedAmount: 1500 });
    expect((await payroll.preview(ownerId, shopId, ana, MONTH_FROM, MONTH_TO)).baseAmount).toBe(
      1500,
    );
    await payroll.setConfig(ownerId, shopId, ana, { payType: 'FIXED', fixedAmount: 1500 });
    expect((await payroll.preview(ownerId, shopId, ana, MONTH_FROM, MONTH_TO)).baseAmount).toBe(
      1500,
    );
    const both = await payroll.setConfig(ownerId, shopId, ana, {
      payType: 'FIXED_PLUS_COMMISSION',
      fixedAmount: 1000,
    });
    expect(both).toMatchObject({ payType: 'FIXED_PLUS_COMMISSION', fixedAmount: 1000 });
    expect((await payroll.preview(ownerId, shopId, ana, MONTH_FROM, MONTH_TO)).baseAmount).toBe(
      1100,
    );
  });

  it('gorjeta, bônus, desconto e vale entram no cálculo; vale em dinheiro sai do caixa', async () => {
    await barbershops.openCashSession(ownerId, shopId, 500);
    await payroll.addEntry(ownerId, shopId, {
      barberId: ana,
      type: 'TIP',
      amount: 20,
      date: '2026-08-10',
    });
    await payroll.addEntry(ownerId, shopId, {
      barberId: ana,
      type: 'BONUS',
      amount: 10,
      date: '2026-08-10',
    });
    await payroll.addEntry(ownerId, shopId, {
      barberId: ana,
      type: 'DEDUCTION',
      amount: 5,
      date: '2026-08-11',
      notes: 'pomada',
    });
    // Vale precisa dizer como foi pago
    await expect(
      payroll.addEntry(ownerId, shopId, { barberId: ana, type: 'ADVANCE', amount: 30 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await payroll.addEntry(ownerId, shopId, {
      barberId: ana,
      type: 'ADVANCE',
      amount: 300,
      method: 'CASH',
      date: '2026-08-15',
    });
    const advanceExpense = await prisma.expense.findFirstOrThrow({
      where: { barbershopId: shopId, description: 'Vale — Ana' },
    });
    expect(advanceExpense).toMatchObject({ category: 'SALARY', paymentMethod: 'CASH' });
    expect(advanceExpense.cashSessionId).not.toBeNull();

    const p = await payroll.preview(ownerId, shopId, ana, MONTH_FROM, MONTH_TO);
    expect(p).toMatchObject({ tips: 20, bonuses: 10, deductions: 5, advances: 300 });
    expect(p.total).toBe(1100 + 20 + 10 - 5 - 300);
    expect(p.entries).toHaveLength(4);

    const closed = await barbershops.closeCashSession(ownerId, shopId, { countedBalance: 200 });
    expect(Number(closed.expectedBalance)).toBe(200); // 500 − 300 do vale
  });

  it('pagar o período: despesa "Salário", lançamentos fechados, sem pagar duas vezes', async () => {
    const results = await Promise.allSettled([
      payroll.pay(ownerId, shopId, {
        barberId: ana,
        from: MONTH_FROM,
        to: MONTH_TO,
        method: 'PIX',
      }),
      payroll.pay(ownerId, shopId, {
        barberId: ana,
        from: MONTH_FROM,
        to: MONTH_TO,
        method: 'PIX',
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const payout = (results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>)
      .value;
    expect(payout).toMatchObject({ total: 825, commission: 100, fixedAmount: 1000, method: 'PIX' });

    const salary = await prisma.expense.findMany({
      where: { barbershopId: shopId, category: 'SALARY', description: { startsWith: 'Pagamento' } },
    });
    expect(salary).toHaveLength(1);
    expect(Number(salary[0].amount)).toBe(825);
    expect(
      await prisma.barberPayEntry.count({ where: { barberId: ana, payoutId: payout.id } }),
    ).toBe(4);

    // Período que encosta no pago também não
    await expect(
      payroll.pay(ownerId, shopId, {
        barberId: ana,
        from: '2026-08-31',
        to: '2026-09-05',
        method: 'PIX',
      }),
    ).rejects.toThrow('já foi pago');
    const again = await payroll.preview(ownerId, shopId, ana, MONTH_FROM, MONTH_TO);
    expect(again.alreadyPaid).toBe(`${MONTH_FROM} – ${MONTH_TO}`);
    expect(again.entries).toHaveLength(0);

    // Lançamento já fechado não se apaga
    const closedEntry = await prisma.barberPayEntry.findFirstOrThrow({
      where: { payoutId: payout.id },
    });
    await expect(payroll.deleteEntry(ownerId, shopId, closedEntry.id)).rejects.toThrow(
      'Desfaça o pagamento',
    );
  });

  it('vale maior que o devido: paga 0 e a diferença passa pro próximo período; desfazer volta tudo', async () => {
    await payroll.addEntry(ownerId, shopId, {
      barberId: beto,
      type: 'ADVANCE',
      amount: 100,
      method: 'PIX',
      date: '2026-08-12',
    });
    const payout = await payroll.pay(ownerId, shopId, {
      barberId: beto,
      from: MONTH_FROM,
      to: MONTH_TO,
      method: 'CASH',
    });
    expect(payout).toMatchObject({ commission: 20, advances: 100, total: 0 });
    const carry = await prisma.barberPayEntry.findFirstOrThrow({
      where: { barberId: beto, payoutId: null },
    });
    expect(carry).toMatchObject({ type: 'ADVANCE', expenseId: null });
    expect(Number(carry.amount)).toBe(80);
    const next = await payroll.preview(ownerId, shopId, beto, '2026-09-01', '2026-09-30');
    expect(next.advances).toBe(80);
    expect(next.total).toBe(-80);

    await payroll.undoPayout(ownerId, shopId, payout.id);
    expect(await prisma.barberPayout.count({ where: { barberId: beto } })).toBe(0);
    const open = await prisma.barberPayEntry.findMany({ where: { barberId: beto } });
    expect(open).toHaveLength(1); // o vale original, de novo em aberto
    expect(open[0].payoutId).toBeNull();
  });

  it('extrato: a barbeira vê o dela (não o do colega); o dono vê de todos', async () => {
    const mine = await payroll.statement(barberUserId, shopId, null);
    expect(mine.barberName).toBe('Ana');
    expect(mine.config).toMatchObject({ payType: 'FIXED_PLUS_COMMISSION', fixedAmount: 1000 });
    expect(mine.payouts).toHaveLength(1);
    const august = mine.receivedByMonth.find((m) => m.month === '2026-08');
    expect(august?.total).toBe(300); // o vale de agosto (o pagamento foi feito hoje)
    const thisMonth = mine.receivedByMonth.find(
      (m) => m.month === new Date().toISOString().slice(0, 7),
    );
    expect(thisMonth?.total).toBeGreaterThanOrEqual(825);
    // Em aberto: do dia seguinte ao último pagamento até hoje
    expect(mine.current?.periodStart.getTime()).toBeGreaterThan(
      new Date('2026-08-31T12:00:00Z').getTime(),
    );

    await expect(payroll.statement(barberUserId, shopId, beto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const betoSeenByOwner = await payroll.statement(ownerId, shopId, beto);
    expect(betoSeenByOwner.openEntries).toHaveLength(1);
    // Barbeira não vê o resumo geral
    await expect(
      payroll.overview(barberUserId, shopId, MONTH_FROM, MONTH_TO),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('visão do dono: quanto cada um gerou e recebeu, e o custo da equipe', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const o = await payroll.overview(ownerId, shopId, MONTH_FROM, today);
    const a = o.rows.find((r) => r.barberId === ana)!;
    const b = o.rows.find((r) => r.barberId === beto)!;
    expect(a).toMatchObject({
      sales: 250,
      commission: 100,
      tips: 20,
      advancesPaid: 300,
      paid: 1125,
    });
    expect(b).toMatchObject({ sales: 50, commission: 20, advancesPaid: 100, paid: 100 });
    expect(o.totalRevenue).toBe(300);
    expect(o.totalPaid).toBe(1225);
    expect(o.staffCostPercent).toBeCloseTo((1225 / 300) * 100, 1);
  });
});
