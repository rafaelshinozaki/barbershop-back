/**
 * Taxa de falta e de cancelamento tardio, contra o Postgres de verdade:
 * cancelamento pela unidade não gera taxa, falta desfeita tira a pendente, e
 * a taxa recebida entra como venda no caixa aberto.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { COMPLETED_TOO_EARLY_MESSAGE, NO_SHOW_TOO_EARLY_MESSAGE } from './appointment-status-time';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService, NO_SHOW_FEE_NOT_PENDING_MESSAGE } from './barbershop.service';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const HOUR = 3_600_000;

// A taxa é registrada em segundo plano: espera aparecer (ou não)
async function waitFor(check: () => Promise<boolean>, ms = 3000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

describe('Taxa de falta (integração)', () => {
  const prisma = new PrismaService();
  // O horário já começou: falta e concluído só valem depois do início (item 260)
  const started = (id: number) =>
    prisma.$executeRaw`UPDATE "Appointment" SET "startAt" = "startAt" - interval '8 days', "endAt" = "endAt" - interval '8 days' WHERE id = ${id} AND "startAt" > NOW() - interval '5 minutes'`;
  const stub = {} as never;
  const shops = new BarbershopService(
    prisma,
    stub,
    stub,
    { isConfigured: () => false } as never,
    stub,
    { email: async () => undefined, whatsapp: async () => undefined } as never,
    { notify: () => undefined } as never,
  );
  let ownerId: number;
  let basicId: number;
  let networkId: number;
  let shopId: number;
  let barberId: number;
  let serviceId: number;
  let customerId: number;

  const user = async (label: string, roleId: number) =>
    (
      await prisma.user.create({
        data: {
          email: `nsf-${label}-${RUN}@test.local`,
          isActive: true,
          password: 'x',
          fullName: `Teste ${label}`,
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
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = await user('dona', roleId);
    basicId = await user('basico', roleId);
    networkId = (
      await prisma.network.create({
        data: {
          ownerUserId: ownerId,
          name: `Rede Taxa ${RUN}`,
          noShowFeeEnabled: true,
          noShowFeeType: 'FIXED',
          noShowFeeValue: 30,
          lateCancellationWindowHours: 24,
        },
      })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: 'Barbearia Taxa',
          slug: `nsf-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `nsf-${RUN}@test.local`,
          timezone: 'America/Sao_Paulo',
          networkId,
          ownerUserId: ownerId,
        },
      })
    ).id;
    barberId = (
      await prisma.barber.create({
        data: { barbershopId: shopId, name: 'Ana', phone: '11911111111' },
      })
    ).id;
    await prisma.barber.create({
      data: {
        barbershopId: shopId,
        name: 'Básico',
        phone: '11933333333',
        userId: basicId,
        staffType: 'basic',
      },
    });
    serviceId = (
      await prisma.barbershopService.create({
        data: { barbershopId: shopId, name: 'Corte', durationMinutes: 30, price: new Decimal(80) },
      })
    ).id;
    customerId = (
      await prisma.customer.create({
        data: { networkId, name: 'Cliente Taxa', phone: `5${RUN.slice(-10)}` },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.noShowFee.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.customer.deleteMany({ where: { networkId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  // Dentro da janela de 24 h de cancelamento tardio, um horário por agendamento
  let slot = 0;
  const appointment = async () => {
    const start = new Date(Date.now() + 2 * HOUR + slot++ * HOUR);
    const a = await shops.createAppointment(ownerId, shopId, {
      customerId,
      barberId,
      startAt: start,
      endAt: new Date(start.getTime() + 30 * 60_000),
      services: [{ serviceId, unitPrice: 80 }],
    });
    return a!.id;
  };
  const feeOf = (appointmentId: number) =>
    prisma.noShowFee.findUnique({ where: { appointmentId } });

  it('cancelamento tardio: só gera taxa quando quem cancelou foi o cliente', async () => {
    const byShop = await appointment();
    await shops.updateAppointment(
      ownerId,
      shopId,
      byShop,
      { status: 'CANCELLED' },
      {
        cancelledBy: 'business',
      },
    );
    expect(await waitFor(async () => !!(await feeOf(byShop)), 500)).toBe(false);

    const byClient = await appointment();
    await shops.updateAppointment(
      ownerId,
      shopId,
      byClient,
      { status: 'CANCELLED' },
      {
        cancelledBy: 'client',
      },
    );
    expect(await waitFor(async () => !!(await feeOf(byClient)))).toBe(true);
    expect(await feeOf(byClient)).toMatchObject({ reason: 'LATE_CANCELLATION', status: 'PENDING' });

    await expect(
      shops.updateAppointment(
        ownerId,
        shopId,
        await appointment(),
        { status: 'CANCELLED' },
        {
          cancelledBy: 'ninguém',
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('260: falta ou concluído num horário que ainda não começou é recusado; cancelar continua', async () => {
    const id = await appointment();
    await expect(
      shops.updateAppointment(ownerId, shopId, id, { status: 'NO_SHOW' }),
    ).rejects.toThrow(NO_SHOW_TOO_EARLY_MESSAGE);
    await expect(
      shops.updateAppointment(ownerId, shopId, id, { status: 'COMPLETED' }),
    ).rejects.toThrow(COMPLETED_TOO_EARLY_MESSAGE);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id } })).status).toBe(
      'CONFIRMED',
    );
    expect(await feeOf(id)).toBeNull();
    await shops.updateAppointment(
      ownerId,
      shopId,
      id,
      { status: 'CANCELLED' },
      { cancelledBy: 'business' },
    );
  });

  it('falta marcada por engano e corrigida: a taxa pendente sai; marcada de novo, volta', async () => {
    const id = await appointment();
    await started(id);
    await shops.updateAppointment(ownerId, shopId, id, { status: 'NO_SHOW' });
    expect(await waitFor(async () => !!(await feeOf(id)))).toBe(true);
    await started(id);
    await shops.updateAppointment(ownerId, shopId, id, { status: 'COMPLETED' });
    expect(await feeOf(id)).toBeNull();
    await started(id);
    await shops.updateAppointment(ownerId, shopId, id, { status: 'NO_SHOW' });
    expect(await waitFor(async () => (await feeOf(id))?.status === 'PENDING')).toBe(true);
  });

  it('taxa recebida: pede a forma de pagamento e entra como venda no caixa aberto', async () => {
    const id = await appointment();
    await started(id);
    await shops.updateAppointment(ownerId, shopId, id, { status: 'NO_SHOW' });
    expect(await waitFor(async () => !!(await feeOf(id)))).toBe(true);
    const fee = (await feeOf(id))!;
    const cash = await prisma.cashSession.create({
      data: { barbershopId: shopId, openedByUserId: ownerId, openingBalance: new Decimal(0) },
    });

    await expect(shops.markNoShowFeeCollected(ownerId, shopId, fee.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // Barbeiro básico não marca
    await expect(
      shops.markNoShowFeeCollected(basicId, shopId, fee.id, 'CASH'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await shops.markNoShowFeeCollected(ownerId, shopId, fee.id, 'CASH');
    const collected = await prisma.noShowFee.findUniqueOrThrow({ where: { id: fee.id } });
    expect(collected.status).toBe('COLLECTED');
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: collected.saleId! } });
    expect(sale).toMatchObject({
      saleType: 'NO_SHOW_FEE',
      paymentStatus: 'PAID',
      paymentMethod: 'CASH',
      cashSessionId: cash.id,
      customerId,
    });
    expect(Number(sale.total)).toBe(30);
    // Clicar de novo não lança outra venda
    await expect(
      shops.markNoShowFeeCollected(ownerId, shopId, fee.id, 'CASH'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.sale.count({ where: { barbershopId: shopId } })).toBe(1);
    // Já recebida: desfazer a falta não apaga
    await started(id);
    await shops.updateAppointment(ownerId, shopId, id, { status: 'COMPLETED' });
    expect((await feeOf(id))?.status).toBe('COLLECTED');

    // Apagar a venda da taxa: a taxa volta a ficar pendente
    await shops.deleteSale(ownerId, shopId, sale.id);
    expect(await prisma.noShowFee.findUniqueOrThrow({ where: { id: fee.id } })).toMatchObject({
      status: 'PENDING',
      saleId: null,
      collectedAt: null,
    });
  });

  it('unidade em outra moeda: sem taxa fixa e sem fidelidade; vale só na moeda em que foi vendido (item 188)', async () => {
    await prisma.network.update({
      where: { id: networkId },
      data: { loyaltyEnabled: true, loyaltyPointsPerCurrencyUnit: 1, loyaltyPointValue: 0.1 },
    });
    const lisbon = await prisma.barbershop.create({
      data: {
        name: 'Barbearia Lisboa',
        slug: `nsf-pt-${RUN}`,
        address: 'Rua B, 2',
        city: 'Lisboa',
        state: '',
        country: 'PT',
        postalCode: '1000-001',
        phone: '351911111111',
        email: `nsf-pt-${RUN}@test.local`,
        timezone: 'Europe/Lisbon',
        currency: 'EUR',
        networkId,
        ownerUserId: ownerId,
      },
    });
    try {
      const ptBarber = await prisma.barber.create({
        data: { barbershopId: lisbon.id, name: 'Rui', phone: '351922222222' },
      });
      const ptService = await prisma.barbershopService.create({
        data: {
          barbershopId: lisbon.id,
          name: 'Corte',
          durationMinutes: 30,
          price: new Decimal(20),
        },
      });
      // Taxa fixa de 30 é em real: na unidade em euro, a falta não gera taxa
      const start = new Date(Date.now() + 30 * HOUR);
      const appt = await shops.createAppointment(ownerId, lisbon.id, {
        customerId,
        barberId: ptBarber.id,
        startAt: start,
        endAt: new Date(start.getTime() + 30 * 60_000),
        services: [{ serviceId: ptService.id, unitPrice: 20 }],
      });
      await started(appt!.id);
      await shops.updateAppointment(ownerId, lisbon.id, appt!.id, { status: 'NO_SHOW' });
      expect(await waitFor(async () => !!(await feeOf(appt!.id)), 500)).toBe(false);

      // Fidelidade: ligada na unidade em real, desligada na de euro
      expect((await shops.getCustomerLoyalty(ownerId, shopId, customerId)).enabled).toBe(true);
      expect((await shops.getCustomerLoyalty(ownerId, lisbon.id, customerId)).enabled).toBe(false);

      // Vale vendido em real: vale aqui, não em Lisboa; e o valor tem teto
      const card = await shops.createGiftCard(ownerId, networkId, {
        initialValue: 100,
        barbershopId: shopId,
        paymentMethod: 'CASH',
      });
      expect(card.currency).toBe('BRL');
      await expect(shops.lookupGiftCard(ownerId, shopId, card.code)).resolves.toBeTruthy();
      await expect(shops.lookupGiftCard(ownerId, lisbon.id, card.code)).rejects.toThrow(
        'vendido em outra moeda',
      );
      const euro = await shops.createGiftCard(ownerId, networkId, {
        initialValue: 50,
        barbershopId: lisbon.id,
        paymentMethod: 'CASH',
      });
      expect(euro.currency).toBe('EUR');
      await expect(shops.lookupGiftCard(ownerId, lisbon.id, euro.code)).resolves.toBeTruthy();
      await expect(
        shops.createGiftCard(ownerId, networkId, { initialValue: 1e12 }),
      ).rejects.toThrow('Valor do cartão-presente inválido');
    } finally {
      await prisma.giftCard.deleteMany({ where: { networkId } });
      await prisma.barbershop.delete({ where: { id: lisbon.id } });
    }
  });

  it('sinal retido entra na taxa, valor em centavos, só perdoa pendente, barbeiro vê só as dele (item 223)', async () => {
    const withDeposit = async (amount: number) => {
      const id = await appointment();
      await prisma.appointment.update({
        where: { id },
        data: { depositPaid: true, depositPaidAt: new Date(), depositAmount: amount },
      });
      return id;
    };
    // Taxa fixa de 30: sinal de 20 retido → cobra 10; sinal de 40 → nada
    const partial = await withDeposit(20);
    await started(partial);
    await shops.updateAppointment(ownerId, shopId, partial, { status: 'NO_SHOW' });
    expect(await waitFor(async () => !!(await feeOf(partial)))).toBe(true);
    expect(Number((await feeOf(partial))!.amount)).toBe(10);
    const covered = await withDeposit(40);
    await started(covered);
    await shops.updateAppointment(ownerId, shopId, covered, { status: 'NO_SHOW' });
    expect(await waitFor(async () => !!(await feeOf(covered)), 500)).toBe(false);

    // Porcentagem arredondada para centavos: 80 × 12,345% = 9,876 → 9,88
    await prisma.network.update({
      where: { id: networkId },
      data: { noShowFeeType: 'PERCENT', noShowFeeValue: 12.345 },
    });
    try {
      const pct = await appointment();
      await started(pct);
      await shops.updateAppointment(ownerId, shopId, pct, { status: 'NO_SHOW' });
      expect(await waitFor(async () => !!(await feeOf(pct)))).toBe(true);
      expect(Number((await feeOf(pct))!.amount)).toBe(9.88);
    } finally {
      await prisma.network.update({
        where: { id: networkId },
        data: { noShowFeeType: 'FIXED', noShowFeeValue: 30 },
      });
    }

    // Já cobrada não vira "perdoada"
    const fee = (await feeOf(partial))!;
    await shops.markNoShowFeeCollected(ownerId, shopId, fee.id, 'CASH');
    await expect(shops.waiveNoShowFee(ownerId, shopId, fee.id)).rejects.toThrow(
      NO_SHOW_FEE_NOT_PENDING_MESSAGE,
    );

    // O barbeiro que não atende esses horários não vê as taxas
    expect((await shops.getBarbershopNoShowFees(ownerId, shopId)).length).toBeGreaterThan(0);
    await prisma.barber.updateMany({ where: { userId: basicId }, data: { staffType: 'barber' } });
    try {
      expect(await shops.getBarbershopNoShowFees(basicId, shopId)).toEqual([]);
    } finally {
      await prisma.barber.updateMany({ where: { userId: basicId }, data: { staffType: 'basic' } });
    }
  });
  it('pago antes pelo app: a taxa sai do valor pago e o resto volta, sem taxa devida (item 242)', async () => {
    const refunds: Array<{ intent: string; minor: number | undefined }> = [];
    const withStripe = new BarbershopService(
      prisma,
      stub,
      stub,
      { isConfigured: () => false } as never,
      {
        createRefund: async (intent: string, minor?: number) => {
          refunds.push({ intent, minor });
          return { id: `re_${refunds.length}` };
        },
      } as never,
      { email: async () => undefined, whatsapp: async () => undefined } as never,
      { notify: () => undefined } as never,
    );
    const prepaid = async () => {
      const id = await appointment();
      await prisma.appointment.update({
        where: { id },
        data: {
          prepaidAt: new Date(),
          prepaidAmount: 80,
          prepaidPaymentIntentId: `pi_pre_${RUN}_${id}`,
        },
      });
      return id;
    };

    // Falta: taxa fixa de 30 fica com a unidade, 50 voltam, nada pendente
    const noShow = await prepaid();
    await started(noShow);
    await withStripe.updateAppointment(ownerId, shopId, noShow, { status: 'NO_SHOW' });
    expect(refunds).toEqual([{ intent: `pi_pre_${RUN}_${noShow}`, minor: 5000 }]);
    let row = await prisma.appointment.findUniqueOrThrow({ where: { id: noShow } });
    expect(Number(row.prepaidRefundedAmount)).toBe(50);
    expect(row.prepaidRefundedAt).toBeNull();
    expect(await waitFor(async () => !!(await feeOf(noShow)), 500)).toBe(false);

    // Cancelamento tardio pelo cliente: mesma conta (antes devolvia tudo e
    // ainda registrava a taxa)
    refunds.length = 0;
    const late = await prepaid();
    await withStripe.updateAppointment(
      ownerId,
      shopId,
      late,
      { status: 'CANCELLED' },
      { cancelledBy: 'client' },
    );
    expect(refunds.map((r) => r.minor)).toEqual([5000]);
    expect(await waitFor(async () => !!(await feeOf(late)), 500)).toBe(false);

    // Pago menos que a taxa (40 de 80, taxa de 60): fica tudo e 20 ficam devidos
    await prisma.network.update({ where: { id: networkId }, data: { noShowFeeValue: 60 } });
    try {
      refunds.length = 0;
      const small = await appointment();
      await prisma.appointment.update({
        where: { id: small },
        data: { prepaidAt: new Date(), prepaidAmount: 40, prepaidPaymentIntentId: `pi_s_${RUN}` },
      });
      await started(small);
      await withStripe.updateAppointment(ownerId, shopId, small, { status: 'NO_SHOW' });
      expect(refunds).toEqual([]);
      expect(await waitFor(async () => !!(await feeOf(small)))).toBe(true);
      expect(Number((await feeOf(small))!.amount)).toBe(20);
    } finally {
      await prisma.network.update({ where: { id: networkId }, data: { noShowFeeValue: 30 } });
    }

    // A unidade cancelou: sem taxa, volta tudo
    refunds.length = 0;
    const byShop = await prepaid();
    await withStripe.updateAppointment(
      ownerId,
      shopId,
      byShop,
      { status: 'CANCELLED' },
      { cancelledBy: 'business' },
    );
    expect(refunds.map((r) => r.minor)).toEqual([8000]);
    row = await prisma.appointment.findUniqueOrThrow({ where: { id: byShop } });
    expect(row.prepaidRefundedAt).not.toBeNull();
  });
});
