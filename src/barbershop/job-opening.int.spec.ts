/**
 * Vagas para freelancer, contra o Postgres de verdade: a unidade abre a vaga,
 * profissionais se candidatam, a unidade aceita (vira convite com vínculo
 * temporário no período da vaga) ou recusa, e encerra.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';
import { EmployeeInviteService } from './employee-invite.service';
import { JobOpeningService } from './job-opening.service';
import { DEFAULT_PRICING, setCurrentPricing } from '../pricing/pricing';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

const addDays = (n: number) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(),
  );
  return new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
};

describe('Vagas para freelancer (integração)', () => {
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
  const invitesSent: string[] = [];
  const invites = new EmployeeInviteService(
    prisma,
    {
      sendCustomerEmail: async (...args: unknown[]) => void invitesSent.push(JSON.stringify(args)),
    } as never,
    { get: () => 'https://app.test' } as never,
    barbershops,
    { notify: () => undefined } as never,
    { memberJoined: async () => undefined } as never,
  );
  const pushed: number[][] = [];
  const jobs = new JobOpeningService(
    prisma,
    barbershops,
    invites,
    { notifyUsers: () => undefined, notify: () => undefined } as never,
    { sendToUsers: async (ids: number[]) => void pushed.push(ids) } as never,
  );

  let roleId: number;
  let ownerId: number;
  let staffId: number;
  let proId: number;
  let pro2Id: number;
  let pro3Id: number;
  let networkId: number;
  let shopId: number;
  const start = addDays(10);
  const end = addDays(11);

  const createUser = async (label: string) =>
    (
      await prisma.user.create({
        data: {
          email: `job-${label}-${RUN}@test.local`,
          password: 'x',
          fullName: `Vaga ${label}`,
          idDocNumber: `${RUN}${label}`.slice(-20),
          phone: `+55119${RUN.slice(-7)}${label.length}`,
          gender: 'female',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      })
    ).id;
  const notificationsOf = (userId: number) =>
    prisma.userNotification.findMany({ where: { userId }, orderBy: { id: 'asc' } });
  const opening = (over: Record<string, unknown> = {}) =>
    jobs.create(ownerId, {
      barbershopId: shopId,
      title: 'Barbeiro para o sábado',
      description: 'Movimento alto; trazer máquina',
      category: 'HAIR',
      startDate: start,
      endDate: end,
      payInfo: 'R$ 200 a diária',
      ...over,
    } as never);

  beforeAll(async () => {
    roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = await createUser('owner');
    staffId = await createUser('staff');
    proId = await createUser('pro');
    pro2Id = await createUser('pro-dois');
    pro3Id = await createUser('pro-tres-x');
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede Vaga ${RUN}` } })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: `Vaga ${RUN}`,
          slug: `vaga-${RUN}`,
          address: 'Rua 1',
          city: `Cidade Vaga ${RUN}`,
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `vaga-${RUN}@test.local`,
          timezone: 'America/Sao_Paulo',
          networkId,
          ownerUserId: ownerId,
        },
      })
    ).id;
    await prisma.barber.create({
      data: { barbershopId: shopId, name: 'Da casa', phone: '11900000009', userId: staffId },
    });
  });

  afterAll(async () => {
    await prisma.jobOpening.deleteMany({ where: { barbershopId: shopId } });
    await prisma.employeeInvite.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barber.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.userNotification.deleteMany({
      where: { userId: { in: [ownerId, staffId, proId, pro2Id, pro3Id] } },
    });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  it('abre a vaga (gerente/dono), valida; o profissional vê, se candidata e a unidade é avisada', async () => {
    await expect(opening({ startDate: addDays(-1) })).rejects.toBeInstanceOf(BadRequestException);
    await expect(opening({ endDate: addDays(200) })).rejects.toThrow('de 1 a 90 dias');
    await expect(opening({ title: 'ab' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      jobs.create(staffId, {
        barbershopId: shopId,
        title: 'Da equipe não abre',
        startDate: start,
        endDate: end,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const job = await opening();
    expect(job).toMatchObject({
      status: 'open',
      slots: 1,
      payInfo: 'R$ 200 a diária',
      applications: [],
    });

    // O profissional de fora vê a vaga (filtro por cidade); quem já é da casa não
    const seen = await jobs.openOpenings(proId, { city: `Cidade Vaga ${RUN}` });
    expect(seen.map((o) => o.id)).toEqual([job.id]);
    expect(seen[0]).toMatchObject({ barbershopSlug: `vaga-${RUN}`, myApplicationId: null });
    expect((await jobs.openOpenings(staffId, { city: `Cidade Vaga ${RUN}` })).length).toBe(0);
    await expect(jobs.apply(staffId, job.id)).rejects.toBeInstanceOf(ForbiddenException);

    const applied = await jobs.apply(proId, job.id, 'Tenho 5 anos de experiência');
    expect(applied.status).toBe('pending');
    await expect(jobs.apply(proId, job.id)).rejects.toThrow('já se candidatou');
    expect((await notificationsOf(ownerId)).map((n) => n.actionUrl)).toContain(
      `/barbershops/${shopId}/jobs`,
    );
    expect(pushed.some((ids) => ids.includes(ownerId))).toBe(true);
    expect((await jobs.openOpenings(proId, { city: `Cidade Vaga ${RUN}` }))[0]).toMatchObject({
      myApplicationStatus: 'pending',
    });

    const [shopView] = await jobs.shopOpenings(ownerId, shopId);
    expect(shopView.applications).toEqual([
      expect.objectContaining({ name: 'Vaga pro', message: 'Tenho 5 anos de experiência' }),
    ]);
  });

  it('aceitar vira convite com o período da vaga; a vaga de 1 pessoa fica preenchida', async () => {
    const [job] = await jobs.shopOpenings(ownerId, shopId);
    const applicationId = job.applications![0].id;
    const after = await jobs.accept(ownerId, shopId, applicationId);
    expect(after.status).toBe('filled');
    expect(after.applications![0].status).toBe('accepted');
    await expect(jobs.accept(ownerId, shopId, applicationId)).rejects.toThrow('já foi respondida');

    const app = await prisma.jobApplication.findUniqueOrThrow({ where: { id: applicationId } });
    const invite = await prisma.employeeInvite.findUniqueOrThrow({
      where: { id: app.inviteId! },
      include: { barber: true },
    });
    expect(invite.email).toBe(`job-pro-${RUN}@test.local`);
    // Do início do primeiro dia ao fim do último, no horário de Brasília
    expect(invite.barber.accessStartsAt!.toISOString()).toBe(
      new Date(`${start}T00:00:00-03:00`).toISOString(),
    );
    expect(invite.barber.accessEndsAt!.toISOString()).toBe(
      new Date(new Date(`${end}T00:00:00-03:00`).getTime() + 86_400_000 - 1).toISOString(),
    );
    expect(invitesSent.some((a) => a.includes(`job-pro-${RUN}@test.local`))).toBe(true);
    expect((await notificationsOf(proId)).map((n) => n.title)).toContain('Candidatura aceita');
    // Preenchida: sai da lista de vagas abertas
    expect((await jobs.openOpenings(pro2Id, { city: `Cidade Vaga ${RUN}` })).length).toBe(0);
    expect((await jobs.myApplications(proId))[0]).toMatchObject({ status: 'accepted' });
  });

  it('desistir e se candidatar de novo; recusar avisa; encerrar recusa quem esperava', async () => {
    const job = await opening({ title: 'Manicure para a semana', category: null, slots: 2 });
    const a = await jobs.apply(pro2Id, job.id);
    expect(await jobs.withdraw(pro2Id, a.id)).toBe(true);
    await expect(jobs.withdraw(pro2Id, a.id)).rejects.toBeInstanceOf(BadRequestException);
    // Outra pessoa não mexe na candidatura
    const again = await jobs.apply(pro2Id, job.id, 'Voltei');
    expect(again.id).toBe(a.id);
    await expect(jobs.withdraw(proId, a.id)).rejects.toBeInstanceOf(BadRequestException);

    await jobs.reject(ownerId, shopId, a.id);
    expect((await notificationsOf(pro2Id)).map((n) => n.title)).toContain('Candidatura não aceita');
    await expect(jobs.reject(ownerId, shopId, a.id)).rejects.toThrow('já foi respondida');

    const other = await opening({ title: 'Recepção no feriado' });
    const pending = await jobs.apply(pro2Id, other.id);
    const closed = await jobs.close(ownerId, shopId, other.id);
    expect(closed.status).toBe('closed');
    expect(
      (await prisma.jobApplication.findUniqueOrThrow({ where: { id: pending.id } })).status,
    ).toBe('rejected');
    expect((await notificationsOf(pro2Id)).map((n) => n.title)).toContain('Vaga encerrada');
    await expect(jobs.apply(proId, other.id)).rejects.toThrow('não está mais aberta');
    // Encerrada não conta no limite de vagas abertas e não aparece para o profissional
    expect(
      (await jobs.openOpenings(proId, { city: `Cidade Vaga ${RUN}` })).map((o) => o.id),
    ).toEqual([job.id]);
  });

  it('taxa por vaga preenchida: com Stripe, aceitar exige pagar; pago, aceita; se não der, devolve', async () => {
    const intents = new Map<string, any>();
    const refunds: string[] = [];
    let seq = 0;
    const stripe = {
      createPaymentIntent: async (amount: number, _c: string, _x: unknown, opts: any) => {
        const pi = {
          id: `pi_job_${RUN}_${++seq}`,
          amount,
          status: 'requires_payment_method',
          client_secret: `secret_job_${seq}`,
          metadata: { ...opts.metadata },
        };
        intents.set(pi.id, pi);
        return pi;
      },
      retrievePaymentIntent: async (id: string) => intents.get(id),
      cancelPaymentIntent: async (id: string) => {
        intents.get(id).status = 'canceled';
      },
      createRefund: async (id: string) => void refunds.push(id),
    };
    const keyBefore = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = 'sk_test_simulado';
    const paid = new JobOpeningService(
      prisma,
      barbershops,
      invites,
      { notifyUsers: () => undefined, notify: () => undefined } as never,
      { sendToUsers: async () => undefined } as never,
      stripe as never,
    );
    const pay = (id: string) => (intents.get(id).status = 'succeeded');
    try {
      expect(paid.fillFee()).toEqual({
        feeCents: DEFAULT_PRICING.jobFillFeeCents,
        currency: 'BRL',
        required: true,
      });
      const job = await opening({ title: 'Vaga com taxa' });
      const a = await paid.apply(pro3Id, job.id);
      await expect(paid.accept(ownerId, shopId, a.id)).rejects.toThrow('Pague a taxa');
      await expect(paid.startAcceptPayment(staffId, shopId, a.id)).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      const checkout = await paid.startAcceptPayment(ownerId, shopId, a.id);
      expect(checkout.feeCents).toBe(DEFAULT_PRICING.jobFillFeeCents);
      // Abrir de novo retoma o mesmo pagamento
      expect((await paid.startAcceptPayment(ownerId, shopId, a.id)).clientSecret).toBe(
        checkout.clientSecret,
      );
      // Sem pagar: não aceita
      expect((await paid.confirmAcceptPayment(ownerId, shopId, a.id)).paid).toBe(false);
      const piId = (await prisma.jobApplication.findUniqueOrThrow({ where: { id: a.id } }))
        .feePaymentIntentId!;
      pay(piId);
      const done = await paid.confirmAcceptPayment(ownerId, shopId, a.id);
      expect(done.paid).toBe(true);
      expect(done.opening.status).toBe('filled');
      const app = await prisma.jobApplication.findUniqueOrThrow({ where: { id: a.id } });
      expect(app).toMatchObject({ status: 'accepted', feeCents: DEFAULT_PRICING.jobFillFeeCents });
      expect(app.feePaidAt).toBeInstanceOf(Date);
      expect(app.inviteId).not.toBeNull();
      // Webhook depois: não aceita de novo
      expect(await paid.finalizeFee(intents.get(piId))).toBe(true);
      expect(
        await prisma.employeeInvite.count({
          where: { barbershopId: shopId, email: `job-pro-tres-x-${RUN}@test.local` },
        }),
      ).toBe(1);

      // Libera as vagas do plano de teste, ocupadas pelos convites de antes
      await prisma.barber.updateMany({
        where: { barbershopId: shopId, userId: null },
        data: { isActive: false },
      });
      // Pagou, mas a vaga foi encerrada no meio: a taxa volta
      const other = await opening({ title: 'Vaga encerrada no meio' });
      const b = await paid.apply(pro2Id, other.id);
      await paid.startAcceptPayment(ownerId, shopId, b.id);
      const piB = (await prisma.jobApplication.findUniqueOrThrow({ where: { id: b.id } }))
        .feePaymentIntentId!;
      await paid.close(ownerId, shopId, other.id);
      pay(piB);
      expect(await paid.finalizeFee(intents.get(piB))).toBe(false);
      expect(refunds).toContain(piB);
      const refunded = await prisma.jobApplication.findUniqueOrThrow({ where: { id: b.id } });
      expect(refunded.feeRefundedAt).toBeInstanceOf(Date);
      expect(refunded.feePaidAt).toBeNull();

      // Taxa desligada (0) em "Preços e taxas": aceita direto
      await prisma.barber.updateMany({
        where: { barbershopId: shopId, userId: null },
        data: { isActive: false },
      });
      setCurrentPricing({ jobFillFeeCents: 0 });
      expect(paid.fillFee().required).toBe(false);
      const free = await opening({ title: 'Vaga sem taxa' });
      const c = await paid.apply(pro2Id, free.id);
      expect((await paid.accept(ownerId, shopId, c.id)).status).toBe('filled');
    } finally {
      setCurrentPricing({});
      if (keyBefore === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = keyBefore;
    }
  });
});
