import { BadRequestException } from '@nestjs/common';
import { BarbershopService } from './barbershop.service';

const CONFIRM = 'Este serviço tem plano, pacote ou horário marcado. Confirme a desativação.';
const PLAN_INACTIVE = 'Este plano não aceita assinatura nova porque o serviço foi desativado.';
const PACKAGE_INACTIVE = 'Este pacote não está mais à venda porque o serviço foi desativado.';

function emptyLinks() {
  return {
    plans: [] as { id: number; name: string; _count: { subscriptions: number } }[],
    packages: [] as { id: number; name: string }[],
    balance: 0,
    future: 0,
  };
}

describe('desativar serviço', () => {
  function build(links = emptyLinks()) {
    const updated: { id: number; isActive: boolean }[] = [];
    const prisma = {
      barbershopService: {
        findFirst: async () => ({ id: 4, isActive: true, depositAmount: null }),
        update: async ({
          where,
          data,
        }: {
          where: { id: number };
          data: { isActive?: boolean };
        }) => {
          updated.push({ id: where.id, isActive: data.isActive ?? true });
          return { id: where.id };
        },
      },
      clientSubscriptionPlan: {
        findMany: async () => links.plans,
        findFirst: async () => null,
      },
      servicePackage: {
        findMany: async () => links.packages,
        findFirst: async () => null,
      },
      appointment: { count: async () => links.future },
      $queryRaw: async () => [{ count: links.balance }],
    };
    const service = Object.create(BarbershopService.prototype) as BarbershopService;
    Object.assign(service, {
      prisma,
      ensureBarbershopAccess: async () => ({ networkId: 1, currency: 'BRL' }),
    });
    return { service, updated, prisma };
  }

  it('desativa sem pedir confirmação quando nada está ligado', async () => {
    const { service, updated } = build();
    await service.deleteService(1, 3, 4);
    expect(updated).toEqual([{ id: 4, isActive: false }]);
  });

  it('pede confirmação quando há plano e não desativa', async () => {
    const { service, updated } = build({
      ...emptyLinks(),
      plans: [{ id: 8, name: 'Corte mensal', _count: { subscriptions: 2 } }],
    });
    await expect(service.deleteService(1, 3, 4, false)).rejects.toThrow(
      new BadRequestException(CONFIRM),
    );
    expect(updated).toEqual([]);
  });

  it('desativa quando a pessoa confirma, mesmo com plano', async () => {
    const { service, updated } = build({
      ...emptyLinks(),
      plans: [{ id: 8, name: 'Corte mensal', _count: { subscriptions: 2 } }],
    });
    await service.deleteService(1, 3, 4, true);
    expect(updated).toEqual([{ id: 4, isActive: false }]);
  });

  it('a prévia traz os assinantes do plano', async () => {
    const { service } = build({
      ...emptyLinks(),
      plans: [{ id: 8, name: 'Corte mensal', _count: { subscriptions: 2 } }],
      packages: [{ id: 5, name: 'Pacote 4' }],
      balance: 3,
      future: 1,
    });
    await expect(service.serviceDeactivationPreview(1, 3, 4)).resolves.toEqual({
      plans: [{ id: 8, name: 'Corte mensal', subscribers: 2 }],
      packagesForSale: [{ id: 5, name: 'Pacote 4' }],
      packagesWithBalance: 3,
      futureAppointments: 1,
    });
  });

  it('editar o serviço para inativo também pede confirmação', async () => {
    const { service, updated } = build({
      ...emptyLinks(),
      future: 1,
    });
    await expect(service.updateService(1, 3, 4, { isActive: false })).rejects.toThrow(
      new BadRequestException(CONFIRM),
    );
    expect(updated).toEqual([]);
  });
});

describe('assinatura e pacote de serviço desativado', () => {
  it('não abre assinatura nova quando o serviço do plano está inativo', async () => {
    const createSubscription = jest.fn();
    const prisma = {
      clientAccount: {
        findUnique: async () => ({ stripeCustomerId: 'cus_1' }),
      },
      clientSubscriptionPlan: {
        findFirst: async () => ({
          id: 8,
          stripePriceId: 'price_1',
          service: { isActive: false },
        }),
      },
    };
    const service = Object.create(BarbershopService.prototype) as BarbershopService;
    Object.assign(service, {
      prisma,
      stripeService: { createSubscription },
    });
    await expect(service.subscribeToPlan(2, 3, 8, 'pm_1')).rejects.toThrow(
      new BadRequestException(PLAN_INACTIVE),
    );
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it('não vende pacote quando o serviço está inativo', async () => {
    const prisma = {
      servicePackage: {
        findFirst: async () => ({
          id: 5,
          name: 'Pacote 4',
          price: 80,
          service: { isActive: false },
        }),
      },
    };
    const service = Object.create(BarbershopService.prototype) as BarbershopService;
    Object.assign(service, {
      prisma,
      ensureBarbershopAccess: async () => ({ networkId: 1 }),
      ensureCustomerOfNetwork: async () => undefined,
      ensureModuleAccess: async () => undefined,
    });
    await expect(
      service.purchaseClientPackage(1, 3, { customerId: 9, servicePackageId: 5 }),
    ).rejects.toThrow(new BadRequestException(PACKAGE_INACTIVE));
  });
});
