/**
 * Descadastro dos e-mails de marketing (LGPD + descadastro com um clique do
 * Gmail/Yahoo), contra o Postgres de verdade. Antes o e-mail não tinha link
 * nenhum: o cliente só saía da lista se a barbearia desmarcasse à mão.
 */
import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService, MARKETING_EMAILS_PER_30_DAYS } from './barbershop.service';
import { EmailService } from '../email/email.service';
import { createUnsubscribeToken, verifyUnsubscribeToken } from './marketing-unsubscribe';
import { MarketingUnsubscribeController } from './marketing-unsubscribe.controller';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('Descadastro do marketing (integração com o banco)', () => {
  const prisma = new PrismaService();
  const queued: any[] = [];
  const service = new BarbershopService(
    prisma,
    {} as never,
    {} as never,
    { isConfigured: () => false } as never,
    {} as never,
    {
      emailBulk: async (jobs: unknown[]) => void queued.push(...jobs),
      whatsappBulk: async () => undefined,
    } as never,
    { notify: () => undefined } as never,
  );
  const controller = new MarketingUnsubscribeController(service);

  let ownerId: number;
  let shopId: number;
  let networkId: number;
  let customerId: number;
  const env = { ...process.env };

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
    process.env.FRONTEND_URL = 'https://app.test';
    process.env.PUBLIC_API_URL = 'https://api.test/';
    const role =
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }));
    ownerId = (
      await prisma.user.create({
        data: {
          email: `mkt-${RUN}@test.local`,
          password: 'x',
          fullName: 'Dono',
          idDocNumber: `mkt${RUN}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'male',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId: role.id,
        },
      })
    ).id;
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede Mkt ${RUN}` } })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: `Unidade ${RUN}`,
          slug: `mkt-${RUN}`,
          address: 'Rua 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `u-${RUN}@test.local`,
          networkId,
          ownerUserId: ownerId,
        },
      })
    ).id;
    customerId = (
      await prisma.customer.create({
        data: { networkId, name: 'Cliente', email: `cli-${RUN}@test.local`, phone: '11988887777' },
      })
    ).id;
    // Um serviço só pra unidade existir completa (não usado)
    await prisma.barbershopService.create({
      data: { barbershopId: shopId, name: 'Corte', durationMinutes: 30, price: new Decimal(50) },
    });
  });

  afterAll(async () => {
    await prisma.marketingCampaign.deleteMany({ where: { barbershopId: shopId } });
    await prisma.appointment.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barber.deleteMany({ where: { barbershopId: shopId } });
    await prisma.network.delete({ where: { id: networkId } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%${RUN}@test.local`}`;
    await prisma.$disconnect();
    process.env = env;
  });

  it('token: só vale o do próprio cliente (trocar o id ou a assinatura não passa)', () => {
    const token = createUnsubscribeToken(42);
    expect(verifyUnsubscribeToken(token)).toBe(42);
    expect(verifyUnsubscribeToken(token.replace(/^42\./, '43.'))).toBeNull();
    expect(verifyUnsubscribeToken(`${token.slice(0, -1)}x`)).toBeNull();
    expect(verifyUnsubscribeToken('lixo')).toBeNull();
  });

  it('cada e-mail da campanha leva o link do cliente e os cabeçalhos de um clique', async () => {
    await service.sendMarketingBlast(ownerId, shopId, {
      subject: 'Promoção',
      message: 'Corte com 20% off',
      segment: 'ALL',
      sendEmail: true,
      sendWhatsapp: false,
    });
    const job = queued.find((j) => j.to === `cli-${RUN}@test.local`);
    const token = createUnsubscribeToken(customerId);
    expect(job.context.UnsubscribeURL).toBe(
      `https://app.test/unsubscribe?t=${encodeURIComponent(token)}`,
    );
    expect(job.headers).toEqual({
      'List-Unsubscribe': `<https://api.test/marketing/unsubscribe?t=${encodeURIComponent(token)}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });

    // O link aparece no rodapé do e-mail, no idioma do cliente
    const email = new EmailService({} as never, prisma, { get: () => undefined } as never);
    const { html } = await email.render('marketing_blast', job.context, 'Promoção', 'pt');
    expect(html).toContain('Descadastre-se');
    // O Handlebars escapa "=" no href (&#x3D;) — o navegador decodifica
    expect(html.replace(/&#x3D;/g, '=')).toContain(`/unsubscribe?t=${encodeURIComponent(token)}`);
  });

  it('um clique (POST do Gmail) descadastra e o cliente sai das próximas campanhas', async () => {
    await expect(controller.unsubscribe(createUnsubscribeToken(customerId))).resolves.toEqual({
      unsubscribed: true,
    });
    expect(
      (await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })).marketingOptOut,
    ).toBe(true);

    queued.length = 0;
    // Uma campanha por dia: a do teste anterior sai pra este disparo valer
    await prisma.marketingCampaign.deleteMany({ where: { barbershopId: shopId } });
    await service.sendMarketingBlast(ownerId, shopId, {
      message: 'Outra promoção',
      segment: 'ALL',
      sendEmail: true,
      sendWhatsapp: false,
    });
    expect(queued.find((j) => j.to === `cli-${RUN}@test.local`)).toBeUndefined();

    // Pela página: devolve o nome da rede (repetir não dá erro)
    await expect(
      service.unsubscribeFromMarketing(createUnsubscribeToken(customerId)),
    ).resolves.toBe(`Rede Mkt ${RUN}`);
  });

  it('link adulterado não descadastra ninguém', async () => {
    await expect(
      service.unsubscribeFromMarketing(`${customerId}.inventado`),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('gerente manda só pra quem foi atendido na unidade, sem bloqueados; uma por dia e teto mensal', async () => {
    const role = await prisma.role.findFirstOrThrow({ where: { name: 'BarbershopOwner' } });
    const managerId = (
      await prisma.user.create({
        data: {
          email: `mkt-gerente-${RUN}@test.local`,
          password: 'x',
          fullName: 'Gerente',
          idDocNumber: `mktg${RUN}`.slice(-20),
          phone: `+5521${RUN}`.slice(0, 20),
          gender: 'male',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId: role.id,
        },
      })
    ).id;
    const barber = await prisma.barber.create({
      data: {
        barbershopId: shopId,
        name: 'Gerente',
        phone: '11977776666',
        userId: managerId,
        staffType: 'manager',
      },
    });
    const person = (label: string, extra: object = {}) =>
      prisma.customer.create({
        data: {
          networkId,
          name: label,
          email: `${label}-${RUN}@test.local`,
          phone: `119${label.length}${RUN}`.slice(0, 13),
          ...extra,
        },
      });
    const served = await person('atendido');
    const elsewhere = await person('outra-unidade');
    const blocked = await person('bloqueado', { blockedAt: new Date(), blockedReason: 'Ofensas' });
    for (const c of [served, blocked]) {
      await prisma.appointment.create({
        data: {
          barbershopId: shopId,
          barberId: barber.id,
          customerId: c.id,
          startAt: new Date(Date.now() - 86_400_000),
          endAt: new Date(Date.now() - 86_400_000 + 1_800_000),
          status: 'COMPLETED',
        },
      });
    }
    await prisma.marketingCampaign.deleteMany({ where: { barbershopId: shopId } });
    queued.length = 0;
    await service.sendMarketingBlast(managerId, shopId, {
      message: 'Só da unidade',
      segment: 'ALL',
      sendEmail: true,
      sendWhatsapp: false,
    });
    const to = queued.map((j) => j.to);
    expect(to).toContain(served.email);
    expect(to).not.toContain(elsewhere.email);
    expect(to).not.toContain(blocked.email);

    // Outra no mesmo dia: recusada
    await expect(
      service.sendMarketingBlast(ownerId, shopId, {
        message: 'De novo',
        segment: 'ALL',
        sendEmail: true,
        sendWhatsapp: false,
      }),
    ).rejects.toThrow('últimas 24 horas');

    // Teto de e-mails em 30 dias (a campanha de ontem já quase esgotou)
    await prisma.marketingCampaign.updateMany({
      where: { barbershopId: shopId },
      data: {
        createdAt: new Date(Date.now() - 2 * 86_400_000),
        emailQueuedCount: MARKETING_EMAILS_PER_30_DAYS,
      },
    });
    await expect(
      service.sendMarketingBlast(ownerId, shopId, {
        message: 'Mais uma',
        segment: 'ALL',
        sendEmail: true,
        sendWhatsapp: false,
      }),
    ).rejects.toThrow('limite de e-mails');
  });
});
