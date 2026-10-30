import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AppointmentSeriesService } from './appointment-series.service';
import { BarbershopMediaService, PHOTO_KEY_USED_MESSAGE } from './media.service';
import { BarbershopService, SUBSCRIPTION_SERVICE_INACTIVE_MESSAGE } from './barbershop.service';
import { ClosureService } from './closure.service';
import { JobOpeningService } from './job-opening.service';
import { ReviewManagementService } from './review-management.service';

describe('itens 503 a 512', () => {
  it('fechamento recusa o dia 31 de fevereiro', async () => {
    const service = Object.create(ClosureService.prototype) as ClosureService;
    Object.assign(service, {
      barbershopService: { ensureAccess: async () => undefined },
      prisma: { barbershop: { findUnique: async () => ({ timezone: 'America/Sao_Paulo' }) } },
    });
    await expect(
      service.impact(1, 3, { date: '2027-02-31' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('capa ocultada não volta ao confirmar a mesma chave', async () => {
    const hidden = 'barbershops/3/cover-hidden';
    const next = 'barbershops/3/cover-next';
    const deleted: string[] = [];
    let shop: {
      coverKey: string | null;
      coverHiddenAt: Date | null;
      hiddenCoverKeys: string[];
    } = {
      coverKey: hidden,
      coverHiddenAt: new Date(),
      hiddenCoverKeys: [],
    };
    const media = Object.create(BarbershopMediaService.prototype) as BarbershopMediaService;
    Object.assign(media, {
      logger: { error: () => undefined },
      barbershopService: { ensureAccess: async () => undefined },
      s3: {
        deleteObject: async (key: string) => {
          deleted.push(key);
        },
        getDownloadUrl: async (key: string) => key,
      },
      prisma: {
        barbershop: {
          findUnique: async () => shop,
          update: async ({ data }: { data: Record<string, unknown> }) => {
            const push = data.hiddenCoverKeys as { push?: string } | undefined;
            shop = {
              coverKey: (data.coverKey as string | null) ?? null,
              coverHiddenAt:
                'coverHiddenAt' in data ? (data.coverHiddenAt as Date | null) : shop.coverHiddenAt,
              hiddenCoverKeys: push?.push ? [...shop.hiddenCoverKeys, push.push] : shop.hiddenCoverKeys,
            };
            return shop;
          },
        },
      },
    });
    await expect(media.setCover(1, 3, hidden)).rejects.toThrow(PHOTO_KEY_USED_MESSAGE);
    await media.setCover(1, 3, next);
    expect(deleted).toEqual([hidden]);
    expect(shop.hiddenCoverKeys).toEqual([hidden]);
    await expect(media.setCover(1, 3, hidden)).rejects.toThrow(PHOTO_KEY_USED_MESSAGE);
  });

  it('cancelar a série não estorna o horário que já começou', async () => {
    const refunds: number[] = [];
    const emailed: number[][] = [];
    const later = new Date(Date.now() + 3_600_000);
    const service = Object.create(AppointmentSeriesService.prototype) as AppointmentSeriesService;
    Object.assign(service, {
      logger: { error: () => undefined },
      prisma: {
        appointment: {
          findFirst: async () => ({
            id: 1,
            seriesId: 'serie',
            barberId: 5,
            startAt: later,
            customerId: 8,
          }),
          findMany: async () => [
            {
              id: 1,
              startAt: later,
              barberId: 5,
              depositPaid: true,
              depositPaidAt: new Date(),
              contactEmail: 'ana@test.local',
              customer: { email: 'ana@test.local' },
              services: [],
            },
            {
              id: 2,
              startAt: new Date(later.getTime() + 86_400_000),
              barberId: 5,
              depositPaid: true,
              depositPaidAt: new Date(),
              contactEmail: 'ana@test.local',
              customer: { email: 'ana@test.local' },
              services: [],
            },
          ],
          updateMany: async ({ where }: { where: { id: number } }) => ({
            count: where.id === 2 ? 0 : 1,
          }),
        },
        barbershop: {
          findUnique: async () => ({ timezone: 'America/Sao_Paulo', country: 'BR' }),
        },
      },
      barbershopService: {
        ensureCanBookForBarber: async () => undefined,
        checkWaitlistOnCancellation: async () => undefined,
        refundOnlineDeposit: async (id: number) => {
          refunds.push(id);
          return true;
        },
        refundPrepayment: async (id: number) => {
          refunds.push(id);
          return true;
        },
        notifyAppointmentCancelled: async (
          _id: number,
          _email: string,
          _reason: string | null,
          _dates: string[],
          ids: number[],
        ) => {
          emailed.push(ids);
        },
      },
    });
    await expect(service.cancelFromHere(1, 3, 1)).resolves.toEqual({ cancelledCount: 1 });
    expect(refunds).toEqual([1, 1]);
    expect(emailed).toEqual([[1]]);
  });

  it('renomear o plano atualiza o produto e nome vazio é recusado', async () => {
    const products: string[] = [];
    const service = Object.create(BarbershopService.prototype) as BarbershopService;
    Object.assign(service, {
      ensureBarbershopAccess: async () => ({ name: 'Centro', currency: 'BRL' }),
      ensureModuleAccess: async () => undefined,
      prisma: {
        clientSubscriptionPlan: {
          findFirst: async () => ({
            id: 5,
            name: 'Mensal',
            price: 40,
            stripeProductId: 'prod_1',
            stripePriceId: 'price_1',
          }),
          update: async ({ data }: { data: { name?: string } }) => ({
            ...data,
            service: { name: 'Corte' },
          }),
        },
      },
      stripeService: {
        updateProduct: async (_id: string, name: string) => {
          products.push(name);
        },
      },
    });
    await expect(
      service.updateSubscriptionPlan(1, 3, 5, { name: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await service.updateSubscriptionPlan(1, 3, 5, { name: '  Corte mensal  ' });
    expect(products).toEqual(['Centro — Corte mensal']);
  });

  it('editar o plano sem o módulo é recusado e serviço desativado não vira plano', async () => {
    const service = Object.create(BarbershopService.prototype) as BarbershopService;
    Object.assign(service, {
      ensureBarbershopAccess: async () => ({ name: 'Centro', currency: 'BRL' }),
      ensureModuleAccess: async () => {
        throw new ForbiddenException(
          'Este recurso não está disponível no seu plano atual. Faça upgrade para acessá-lo.',
        );
      },
      prisma: {
        barbershopService: {
          findFirst: async () => ({ id: 4, isActive: false, name: 'Corte' }),
        },
      },
      stripeService: {},
    });
    await expect(service.updateSubscriptionPlan(1, 3, 5, { name: 'Mensal' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    Object.assign(service, { ensureModuleAccess: async () => undefined });
    await expect(
      service.createSubscriptionPlan(1, 3, { serviceId: 4, name: 'Mensal', price: 40 }),
    ).rejects.toThrow(SUBSCRIPTION_SERVICE_INACTIVE_MESSAGE);
  });

  it('resposta à avaliação sai no idioma da conta', async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'teste-ficha';
    const langs: string[] = [];
    const service = Object.create(ReviewManagementService.prototype) as ReviewManagementService;
    Object.assign(service, {
      logger: { error: () => undefined },
      barbershopService: { ensureAccess: async () => undefined },
      prisma: {
        review: {
          findFirst: async () => ({
            id: 1,
            reply: null,
            replyHiddenAt: null,
            replyNotifiedAt: null,
          }),
          update: async () => ({}),
          updateMany: async () => ({ count: 1 }),
          findUnique: async () => ({
            id: 1,
            rating: 5,
            comment: 'Bom',
            clientAccount: { name: 'Ann', email: 'ann@test.local', language: 'en' },
            customer: { id: 8, name: 'Ann', email: 'ann@test.local', marketingOptOut: false },
            barbershop: { name: 'Centro', country: 'BR', slug: 'centro', ownerUserId: 1 },
          }),
        },
      },
      notificationQueue: {
        email: async (job: { lang: string }) => {
          langs.push(job.lang);
        },
      },
    });
    await service.reply(1, 3, 1, 'Obrigado');
    expect(langs).toEqual(['en']);
  });

  it('candidatar de novo em seguida avisa uma vez só', async () => {
    const notices: string[] = [];
    let row: { id: number; status: string; returnedOnce: boolean } | null = null;
    const jobs = Object.create(JobOpeningService.prototype) as JobOpeningService;
    Object.assign(jobs, {
      myShopIds: async () => [],
      shopManagers: async () => [2],
      today: async () => ({ today: '2026-10-30' }),
      notify: async (_ids: number[], texts: { pt: { title: string } }) => {
        notices.push(texts.pt.title);
      },
      prisma: {
        jobOpening: {
          findUnique: async () => ({
            id: 1,
            status: 'open',
            endDate: '2099-01-01',
            title: 'Corte',
            barbershopId: 3,
            barbershop: {
              isActive: true,
              platformSuspendedAt: null,
              network: { platformSuspendedAt: null },
            },
          }),
        },
        jobApplication: {
          count: async () => 0,
          findUnique: async () => row,
          create: async () => {
            row = { id: 9, status: 'pending', returnedOnce: false };
            return row;
          },
          update: async () => {
            row = { id: 9, status: 'pending', returnedOnce: true };
            return row;
          },
          updateMany: async () => {
            if (row?.status !== 'pending') return { count: 0 };
            row = { ...row, status: 'withdrawn' };
            return { count: 1 };
          },
        },
        user: { findUnique: async () => ({ fullName: 'Ana' }) },
      },
    });
    await jobs.apply(4, 1);
    await jobs.withdraw(4, 9);
    await jobs.apply(4, 1);
    expect(notices).toEqual(['Nova candidatura']);
  });
});
