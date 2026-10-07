/**
 * Fase 2 do backoffice contra o Postgres de verdade: ficha da pessoa (com o
 * Financeiro só pra quem tem), busca do topo por área, derrubar sessões e
 * pagamentos pelo app (lista, estorno com motivo e disputa da Stripe).
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserDossierService } from './user-dossier.service';
import { BackofficeSearchService } from './backoffice-search.service';
import { AppPaymentsService } from '../barbershop/app-payments.service';
import { hasBackofficeArea } from '../auth/backoffice-areas';
import { UserService } from '../auth/users/users.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const HOUR = 3_600_000;

describe('Backoffice fase 2 (integração)', () => {
  const prisma = new PrismaService();
  const dossier = new UserDossierService(prisma);
  const search = new BackofficeSearchService(prisma);
  const refunds: Array<{ intent: string; amount?: number; connected: boolean }> = [];
  const stripe = {
    createRefund: async (
      intent: string,
      amount?: number,
      _reason?: string,
      _key?: string,
      connected = false,
    ) => {
      if (intent.includes('falha')) throw new Error('stripe fora');
      refunds.push({ intent, amount, connected });
      return {};
    },
  };
  const delegated: string[] = [];
  const barbershops = {
    refundOnlineDeposit: async (id: number) => {
      delegated.push(`deposit:${id}`);
      await prisma.appointment.update({
        where: { id },
        data: { depositPaid: false, depositRefundedAt: new Date() },
      });
      return true;
    },
    refundPrepayment: async (id: number, amount?: number) => {
      delegated.push(`prepaid:${id}:${amount ?? 'tudo'}`);
      await prisma.appointment.update({
        where: { id },
        data: { prepaidRefundedAmount: amount ?? 50 },
      });
      return true;
    },
  };
  const payments = new AppPaymentsService(prisma, barbershops as never, stripe as never);

  let ownerId: number;
  let networkId: number;
  let shopId: number;
  let barberId: number;
  let customerId: number;
  let deposit: number;
  let prepaid: number;
  let closedPrepaid: number;
  let tipId: number;
  let failingTipId: number;

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = (
      await prisma.user.create({
        data: {
          email: `fase2-${RUN}@test.local`,
          password: 'x',
          fullName: `Dona Fase2 ${RUN}`,
          idDocNumber: `${RUN}`.slice(-20),
          phone: '+5511900000000',
          gender: 'female',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
          membership: 'PRO',
        },
      })
    ).id;
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede F2 ${RUN}` } })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: `Unidade Fase2 ${RUN}`,
          slug: `fase2-${RUN}`,
          address: 'Rua A, 1',
          city: 'Campinas',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `fase2-shop-${RUN}@test.local`,
          networkId,
          ownerUserId: ownerId,
        },
      })
    ).id;
    barberId = (
      await prisma.barber.create({ data: { barbershopId: shopId, name: 'Pro F2', phone: '119' } })
    ).id;
    customerId = (
      await prisma.customer.create({ data: { networkId, name: 'Cliente F2', phone: `8${RUN}` } })
    ).id;
    const appt = (data: object) =>
      prisma.appointment.create({
        data: {
          barbershopId: shopId,
          barberId,
          customerId,
          startAt: new Date(Date.now() + 24 * HOUR),
          endAt: new Date(Date.now() + 25 * HOUR),
          ...data,
        },
      });
    deposit = (
      await appt({
        depositAmount: 20,
        depositPaid: true,
        depositPaidAt: new Date(Date.now() - 3 * HOUR),
        depositPaymentIntentId: `pi_dep_${RUN}`,
      })
    ).id;
    prepaid = (
      await appt({
        prepaidAmount: 80,
        prepaidAt: new Date(Date.now() - 2 * HOUR),
        prepaidPaymentIntentId: `pi_pre_${RUN}`,
      })
    ).id;
    closedPrepaid = (
      await appt({
        prepaidAmount: 40,
        prepaidAt: new Date(Date.now() - 2 * HOUR),
        prepaidPaymentIntentId: `pi_pre2_${RUN}`,
      })
    ).id;
    await prisma.sale.create({
      data: {
        barbershopId: shopId,
        appointmentId: closedPrepaid,
        total: 40,
        subtotal: 40,
        saleType: 'SERVICE',
      },
    });
    const tip = (intent: string) =>
      prisma.appointmentTip.create({
        data: {
          appointmentId: prepaid,
          barbershopId: shopId,
          destination: 'unit',
          method: 'STRIPE',
          amount: 10,
          currency: 'BRL',
          stripePaymentIntentId: intent,
        },
      });
    tipId = (await tip(`pi_tip_${RUN}`)).id;
    failingTipId = (await tip(`pi_tip_falha_${RUN}`)).id;
    await prisma.activeSession.createMany({
      data: [1, 2].map((i) => ({
        userId: ownerId,
        sessionToken: `sess-f2-${RUN}-${i}`,
        deviceType: 'desktop',
        browser: 'Chrome',
        os: 'Linux',
        ip: '200.0.0.1',
        location: 'Campinas',
      })),
    });
    await prisma.supportTicket.create({
      data: {
        category: 'billing',
        subject: 'Cobrança em dobro',
        name: 'Dona',
        email: `fase2-${RUN}@test.local`,
        userId: ownerId,
      },
    });
  });

  afterAll(async () => {
    await prisma.paymentDispute.deleteMany({ where: { stripeDisputeId: { contains: RUN } } });
    await prisma.supportTicket.deleteMany({ where: { userId: ownerId } });
    await prisma.activeSession.deleteMany({ where: { userId: ownerId } });
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.customer.deleteMany({ where: { networkId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
    await prisma.$disconnect();
  });

  it('área: com mais de uma, basta ter qualquer uma', () => {
    expect(hasBackofficeArea('SystemManager', ['support'], ['users', 'support'])).toBe(true);
    expect(hasBackofficeArea('SystemManager', ['finance'], ['users', 'support'])).toBe(false);
    expect(hasBackofficeArea('SystemAdmin', [], ['users'])).toBe(true);
    expect(hasBackofficeArea('BarbershopOwner', ['users'], 'users')).toBe(false);
  });

  it('ficha da pessoa: conta, unidades, sessões e suporte; plano só com o Financeiro', async () => {
    const sem = await dossier.detail(ownerId, { finance: false });
    expect(sem).toMatchObject({
      id: ownerId,
      role: 'BarbershopOwner',
      units: [expect.objectContaining({ id: shopId, relation: 'owner' })],
      supportTickets: [expect.objectContaining({ subject: 'Cobrança em dobro' })],
      finance: null,
    });
    expect(sem.sessions).toHaveLength(2);
    // Sem IP na ficha
    expect(JSON.stringify(sem)).not.toContain('200.0.0.1');
    const com = await dossier.detail(ownerId, { finance: true });
    expect(com.finance).toMatchObject({ membership: 'PRO', payments: [] });
    await expect(dossier.detail(999_999_999, { finance: true })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('derrubar sessões: todas caem; conta que não existe dá 404', async () => {
    const users = new UserService(
      prisma,
      {} as never,
      {} as never,
      { get: () => undefined } as never,
      {} as never,
    );
    expect(await users.revokeAllSessions(ownerId)).toBe(2);
    expect(await prisma.activeSession.count({ where: { userId: ownerId } })).toBe(0);
    await expect(users.revokeAllSessions(999_999_999)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('busca: conta e unidade com Usuários; nada sem a área', async () => {
    const hits = await search.search(`Fase2 ${RUN}`, { users: true, clients: true });
    expect(hits.map((h) => `${h.kind}:${h.id}`)).toEqual(
      expect.arrayContaining([`user:${ownerId}`, `barbershop:${shopId}`]),
    );
    expect(await search.search(`Fase2 ${RUN}`, { users: false, clients: true })).toEqual([]);
    expect(
      (await search.search(`#${shopId}`, { users: true, clients: false })).map((h) => h.id),
    ).toContain(shopId);
    expect(await search.search('a', { users: true, clients: true })).toEqual([]);
  });

  it('pagamentos pelo app: os três tipos, com filtro, total e taxa estimada', async () => {
    const page = await payments.list({ barbershopId: shopId, limit: 50 });
    expect(page.items.map((i) => `${i.kind}:${i.id}`).sort()).toEqual(
      [
        `deposit:${deposit}`,
        `prepaid:${prepaid}`,
        `prepaid:${closedPrepaid}`,
        `tip:${tipId}`,
        `tip:${failingTipId}`,
      ].sort(),
    );
    expect(page.total).toBe(5);
    expect(page.amount).toBe(160);
    expect(page.estimatedFee).toBeCloseTo((160 * page.feePercent) / 100, 2);
    const tips = await payments.list({ barbershopId: shopId, kind: 'tip' });
    expect(tips.total).toBe(2);
  });

  it('estorno: motivo obrigatório; sinal e atendimento pelo fluxo de sempre; conta fechada não', async () => {
    await expect(payments.refund('deposit', deposit, null, 'x')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(payments.refund('deposit', deposit, 5, 'cliente pediu')).rejects.toThrow(
      /inteiro/,
    );
    await payments.refund('deposit', deposit, null, 'cliente pediu');
    await expect(payments.refund('deposit', deposit, null, 'de novo agora')).rejects.toThrow(
      /já foi estornado/,
    );
    await payments.refund('prepaid', prepaid, 30, 'serviço trocado');
    // O limite sem confirmação vale pela soma dos estornos em partes
    expect(await payments.refundedSoFar('prepaid', prepaid)).toBe(30);
    expect(await payments.refundedSoFar('deposit', deposit)).toBe(0);
    await expect(payments.refund('prepaid', closedPrepaid, null, 'cliente pediu')).rejects.toThrow(
      /conta deste horário já foi fechada/,
    );
    expect(delegated).toEqual([`deposit:${deposit}`, `prepaid:${prepaid}:30`]);

    const page = await payments.list({ barbershopId: shopId });
    const status = (kind: string, id: number) =>
      page.items.find((i) => i.kind === kind && i.id === id)?.status;
    expect(status('deposit', deposit)).toBe('refunded');
    expect(status('prepaid', prepaid)).toBe('partial');
    expect((await payments.list({ barbershopId: shopId, status: 'refunded' })).total).toBe(1);
  });

  it('caixinha: volta inteira pela Stripe (desfaz o repasse), uma vez só; erro da Stripe desfaz a marca', async () => {
    await payments.refund('tip', tipId, null, 'cobrança errada');
    expect(refunds).toEqual([{ intent: `pi_tip_${RUN}`, amount: undefined, connected: true }]);
    await expect(payments.refund('tip', tipId, null, 'cobrança errada')).rejects.toThrow(
      /já foi estornada/,
    );
    await expect(payments.refund('tip', failingTipId, null, 'cobrança errada')).rejects.toThrow(
      /Não foi possível estornar agora/,
    );
    const failing = await prisma.appointmentTip.findUnique({ where: { id: failingTipId } });
    expect(failing?.refundedAt).toBeNull();
  });

  it('disputa da Stripe aparece no pagamento e sai quando fecha', async () => {
    const dispute = (status: string) =>
      ({
        id: `dp_${RUN}`,
        payment_intent: `pi_pre_${RUN}`,
        amount: 5000,
        currency: 'brl',
        reason: 'fraudulent',
        status,
        evidence_details: { due_by: Math.floor(Date.now() / 1000) + 86_400 },
      } as never);
    await payments.recordDispute(dispute('needs_response'));
    let row = (await payments.list({ barbershopId: shopId, status: 'disputed' })).items;
    expect(row).toEqual([
      expect.objectContaining({
        kind: 'prepaid',
        id: prepaid,
        status: 'disputed',
        disputeReason: 'fraudulent',
      }),
    ]);
    await payments.recordDispute(dispute('won'));
    row = (await payments.list({ barbershopId: shopId, status: 'disputed' })).items;
    expect(row).toEqual([]);
    const saved = await prisma.paymentDispute.findUnique({
      where: { stripeDisputeId: `dp_${RUN}` },
    });
    expect(saved?.closedAt).not.toBeNull();
    // Evento atrasado ("ainda precisa de resposta") não reabre a disputa ganha
    await payments.recordDispute(dispute('needs_response'));
    expect(
      await prisma.paymentDispute.findUnique({ where: { stripeDisputeId: `dp_${RUN}` } }),
    ).toMatchObject({ status: 'won', closedAt: saved?.closedAt });
  });
});
