/**
 * Itens 273 a 275, contra o Postgres de verdade: o histórico de atendimentos
 * acompanha os horários concluídos (ficha, painel e público "inativos"), o
 * painel da rede só conta produtos pagos e profissionais com vínculo valendo,
 * e o descadastro do WhatsApp não mexe no e-mail (e o do e-mail tem volta).
 */
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';
import { createUnsubscribeToken } from './marketing-unsubscribe';
import { WhatsappOptOutService } from '../whatsapp/whatsapp-opt-out.service';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const DAY = 86_400_000;

describe('Itens 273 a 275 (integração)', () => {
  const prisma = new PrismaService();
  const stub = {} as never;
  const emails: { to: string }[] = [];
  const whatsapps: { to: string }[] = [];
  const shops = new BarbershopService(
    prisma,
    stub,
    stub,
    { isConfigured: () => true } as never,
    stub,
    {
      email: async () => undefined,
      whatsapp: async () => undefined,
      emailBulk: async (jobs: { to: string }[]) => void emails.push(...jobs),
      whatsappBulk: async (jobs: { to: string }[]) => void whatsapps.push(...jobs),
    } as never,
    { notify: () => undefined } as never,
  );
  const optOut = new WhatsappOptOutService(prisma);
  let ownerId: number;
  let networkId: number;
  let shopId: number;
  let barberId: number;
  let serviceId: number;
  let productId: number;

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = (
      await prisma.user.create({
        data: {
          email: `r273-dona-${RUN}@test.local`,
          isActive: true,
          password: 'x',
          fullName: 'Dona',
          idDocNumber: `r273${RUN}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'female',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      })
    ).id;
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede 273 ${RUN}` } })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: 'Unidade 273',
          slug: `r273-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `r273-shop-${RUN}@test.local`,
          timezone: 'America/Sao_Paulo',
          networkId,
          ownerUserId: ownerId,
        },
      })
    ).id;
    barberId = (
      await prisma.barber.create({
        data: { barbershopId: shopId, name: 'Barbeiro', phone: '11900000001' },
      })
    ).id;
    // Freelancer cujo período já acabou: não conta no painel (item 274)
    await prisma.barber.create({
      data: {
        barbershopId: shopId,
        name: 'Freela vencido',
        phone: '11900000002',
        accessStartsAt: new Date(Date.now() - 10 * DAY),
        accessEndsAt: new Date(Date.now() - 2 * DAY),
      },
    });
    serviceId = (
      await prisma.barbershopService.create({
        data: { barbershopId: shopId, name: 'Corte', durationMinutes: 30, price: 50 },
      })
    ).id;
    productId = (
      await prisma.barbershopProduct.create({
        data: { barbershopId: shopId, name: 'Pomada', salePrice: 30 },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.whatsappOptOut.deleteMany({ where: { phoneDigits: { contains: '1197777' } } });
    await prisma.marketingCampaign.deleteMany({ where: { barbershopId: shopId } });
    await prisma.sale.deleteMany({ where: { barbershopId: shopId } });
    await prisma.appointment.deleteMany({ where: { barbershopId: shopId } });
    await prisma.inventoryMovement.deleteMany({
      where: { inventoryItem: { barbershopId: shopId } },
    });
    await prisma.inventoryItem.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershopProduct.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.customer.deleteMany({ where: { networkId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  const book = async (customerId: number, daysAgo: number) => {
    const start = new Date(Date.now() - daysAgo * DAY - 3_600_000);
    const appt = await shops.createAppointment(ownerId, shopId, {
      customerId,
      barberId,
      startAt: start,
      endAt: new Date(start.getTime() + 30 * 60_000),
      services: [{ serviceId, unitPrice: 50 }],
    });
    return appt!.id;
  };

  it('273: concluir o horário entra na ficha, no painel e tira o cliente dos inativos', async () => {
    const customer = await prisma.customer.create({
      data: {
        networkId,
        name: 'Rita Volta',
        phone: '11977770001',
        email: `rita-${RUN}@test.local`,
      },
    });
    const old = await book(customer.id, 100);
    expect(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: old } })).createdByUserId,
    ).toBe(ownerId);
    // Marcado, mas não concluído: nada no histórico
    expect(await shops.getCustomerServiceHistory(ownerId, shopId, customer.id)).toEqual([]);

    await shops.updateAppointment(ownerId, shopId, old, { status: 'COMPLETED' });
    const history = await shops.getCustomerServiceHistory(ownerId, shopId, customer.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      serviceName: 'Corte',
      priceCharged: 50,
      barberName: 'Barbeiro',
    });

    const stats = await shops.getNetworkDashboardStats(ownerId, shopId);
    expect(stats.totalServicesDone).toBe(1);

    // Atendido há 100 dias e nada depois: inativo
    const inactive = () => shops.previewMarketingSegment(ownerId, shopId, 'INACTIVE', 60);
    expect((await inactive()).recipientCount).toBe(1);
    const recent = await book(customer.id, 1);
    await shops.updateAppointment(ownerId, shopId, recent, { status: 'COMPLETED' });
    expect((await inactive()).recipientCount).toBe(0);

    // Voltou de "concluído": a linha sai
    await prisma.appointment.update({ where: { id: recent }, data: { status: 'CONFIRMED' } });
    expect(await shops.getCustomerServiceHistory(ownerId, shopId, customer.id)).toHaveLength(1);
    // Horário apagado leva a linha junto
    await prisma.appointment.delete({ where: { id: old } });
    expect(await shops.getCustomerServiceHistory(ownerId, shopId, customer.id)).toEqual([]);
  });

  it('274: produtos só de vendas pagas; profissionais com vínculo valendo', async () => {
    const sale = (paymentStatus: string) =>
      shops.createSale(ownerId, shopId, {
        saleType: 'PRODUCT',
        items: [{ itemType: 'PRODUCT', productId, quantity: 2, unitPrice: 30, totalPrice: 60 }],
        subtotal: 60,
        total: 60,
        paymentStatus,
        paymentMethod: 'CASH',
      });
    await sale('PAID');
    await sale('PENDING');
    const stats = await shops.getNetworkDashboardStats(ownerId, shopId);
    expect(stats.totalProductsSold).toBe(2);
    expect(stats.totalBarbers).toBe(1);
  });

  it('275: SAIR no WhatsApp não tira o e-mail; o e-mail tem caminho de volta', async () => {
    await prisma.customer.deleteMany({ where: { networkId } });
    const ana = await prisma.customer.create({
      data: { networkId, name: 'Ana Canal', phone: '11977770002', email: `ana-${RUN}@test.local` },
    });
    const blast = async () => {
      emails.length = 0;
      whatsapps.length = 0;
      await prisma.marketingCampaign.deleteMany({ where: { barbershopId: shopId } });
      await shops.sendMarketingBlast(ownerId, shopId, {
        subject: 'Promo',
        message: 'Corte com desconto',
        segment: 'ALL',
        sendEmail: true,
        sendWhatsapp: true,
      });
      return { emails: emails.map((e) => e.to), whatsapps: whatsapps.map((w) => w.to) };
    };
    let sent = await blast();
    expect(sent.emails).toEqual([`ana-${RUN}@test.local`]);
    expect(sent.whatsapps).toEqual(['+5511977770002']);

    // SAIR no WhatsApp: some só do WhatsApp; a ficha não muda
    expect(await optOut.optOutFromReply('5511977770002', 'SAIR')).toBe(1);
    expect(
      (await prisma.customer.findUniqueOrThrow({ where: { id: ana.id } })).marketingOptOut,
    ).toBe(false);
    sent = await blast();
    expect(sent.emails).toEqual([`ana-${RUN}@test.local`]);
    expect(sent.whatsapps).toEqual([]);

    // VOLTAR: recebe de novo
    await optOut.optOutFromReply('5511977770002', 'VOLTAR');
    // Sai do e-mail pelo link: o WhatsApp continua
    await shops.unsubscribeFromMarketing(createUnsubscribeToken(ana.id));
    sent = await blast();
    expect(sent.emails).toEqual([]);
    expect(sent.whatsapps).toEqual(['+5511977770002']);

    // E volta pelo mesmo link
    await shops.resubscribeToMarketing(createUnsubscribeToken(ana.id));
    sent = await blast();
    expect(sent.emails).toEqual([`ana-${RUN}@test.local`]);
  });
});
