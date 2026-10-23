import { BarbershopService } from './barbershop.service';
import { ClubBillingPauseService } from './club-billing-pause.service';
import { UserService } from '../auth/users/users.service';

const row = (over: Record<string, unknown> = {}) => ({
  id: 7,
  stripeSubscriptionId: 'sub_1',
  shopPausedAt: null as Date | null,
  billingPauseReasons: [] as string[],
  clientAccount: { email: 'ana@test.local', name: 'Ana Silva', language: 'pt', deletedAt: null },
  plan: { name: 'Clube' },
  barbershop: { name: 'Centro' },
  ...over,
});

function pauseService(subs: unknown[], shops: Array<{ id: number }> = [{ id: 3 }]) {
  const updates: { data: Record<string, unknown> }[] = [];
  const emails: Record<string, unknown>[] = [];
  const stripe = jest.fn(async () => undefined);
  let where: unknown;
  let shopWhere: unknown;
  const prisma = {
    barbershop: {
      findMany: async (args: { where: unknown }) => {
        shopWhere = args.where;
        return shops;
      },
    },
    clientSubscription: {
      findMany: async (args: { where: unknown }) => {
        where = args.where;
        return subs;
      },
      update: async (args: { data: Record<string, unknown> }) => {
        updates.push(args);
        return {};
      },
    },
  };
  const service = new ClubBillingPauseService(
    prisma as never,
    { updateSubscription: stripe } as never,
    {
      sendCustomerEmail: async (_a: unknown, _b: unknown, context: Record<string, unknown>) => {
        emails.push(context);
      },
    } as never,
  );
  return {
    service,
    stripe,
    updates,
    emails,
    readWhere: () => where,
    readShopWhere: () => shopWhere,
  };
}

describe('clube de unidade fora do ar', () => {
  it('suspender a unidade pausa a Stripe e avisa quem assina', async () => {
    const { service, stripe, updates, emails } = pauseService([row()]);
    await service.forShop(3, true);
    expect(stripe).toHaveBeenCalledWith('sub_1', { pause_collection: { behavior: 'void' } });
    expect(updates[0].data).toEqual({ billingPauseReasons: { push: 'platform_shop' } });
    expect(emails[0]).toMatchObject({
      Paused: true,
      Resumed: false,
      OwnerInactive: false,
      ShopName: 'Centro',
      PlanName: 'Clube',
    });
  });

  it('não mexe na Stripe se o dono já tinha pausado a unidade', async () => {
    const { service, stripe, updates, emails } = pauseService([row({ shopPausedAt: new Date() })]);
    await service.forShop(3, true);
    expect(stripe).not.toHaveBeenCalled();
    expect(updates[0].data).toEqual({ billingPauseReasons: { push: 'platform_shop' } });
    expect(emails).toEqual([]);
  });

  it('tirar a suspensão da unidade retoma só esse motivo', async () => {
    const { service, stripe, updates, emails } = pauseService([
      row({ billingPauseReasons: ['platform_shop'] }),
    ]);
    await service.forShop(3, false);
    expect(stripe).toHaveBeenCalledWith('sub_1', { pause_collection: '' });
    expect(updates[0].data).toEqual({ billingPauseReasons: { set: [] } });
    expect(emails[0].Resumed).toBe(true);
  });

  it('não retoma se a pausa do dono continua', async () => {
    const { service, stripe, updates, emails } = pauseService([
      row({ shopPausedAt: new Date(), billingPauseReasons: ['platform_shop'] }),
    ]);
    await service.forShop(3, false);
    expect(stripe).not.toHaveBeenCalled();
    expect(updates[0].data).toEqual({ billingPauseReasons: { set: [] } });
    expect(emails).toEqual([]);
  });

  it('a rede pausa as unidades dela', async () => {
    const { service, readWhere } = pauseService([row()], [{ id: 3 }, { id: 4 }]);
    await service.forNetwork(8, true);
    expect(readWhere()).toMatchObject({
      barbershopId: { in: [3, 4] },
      NOT: { billingPauseReasons: { has: 'platform_network' } },
    });
  });

  it('dono desativado segura as unidades dele e as da rede', async () => {
    const { service, updates, emails, readShopWhere } = pauseService([row()]);
    await service.forOwner(4, true);
    expect(readShopWhere()).toEqual({
      OR: [{ ownerUserId: 4 }, { network: { ownerUserId: 4 } }],
    });
    expect(updates[0].data).toEqual({ billingPauseReasons: { push: 'owner_inactive:4' } });
    expect(emails[0].OwnerInactive).toBe(true);
  });

  it('outro motivo já marcado não pausa a Stripe de novo', async () => {
    const { service, stripe } = pauseService([row({ billingPauseReasons: ['owner_inactive:4'] })]);
    await service.forNetwork(8, true);
    expect(stripe).not.toHaveBeenCalled();
  });

  it('se a Stripe falha, o motivo não fica marcado', async () => {
    const { service, stripe, updates } = pauseService([row()]);
    stripe.mockRejectedValue(new Error('stripe down'));
    await expect(service.forShop(3, true)).rejects.toThrow('cobrança do clube');
    expect(updates).toEqual([]);
  });

  it('reativar a unidade não tira a pausa da plataforma', async () => {
    const stripe = jest.fn();
    const updates: { data: Record<string, unknown> }[] = [];
    const service = Object.create(BarbershopService.prototype) as BarbershopService;
    Object.assign(service, {
      logger: { error: () => undefined },
      stripeService: { updateSubscription: stripe },
      prisma: {
        clientSubscription: {
          findMany: async () => [
            { id: 7, stripeSubscriptionId: 'sub_1', billingPauseReasons: ['platform_shop'] },
          ],
          update: async (args: { data: Record<string, unknown> }) => {
            updates.push(args);
            return {};
          },
        },
      },
    });
    await service.setClubBillingPaused(3, false);
    expect(stripe).not.toHaveBeenCalled();
    expect(updates[0].data).toEqual({ shopPausedAt: null });
  });
});

describe('dono desativado', () => {
  it('setUserActive pede a pausa e a reativação tira', async () => {
    const forOwner = jest.fn(async () => undefined);
    const service = Object.create(UserService.prototype) as UserService;
    Object.assign(service, {
      clubPause: { forOwner },
      prisma: {
        user: { update: async () => ({}) },
        activeSession: { deleteMany: async () => ({ count: 0 }) },
        pushSubscription: { deleteMany: async () => ({ count: 0 }) },
        calendarFeed: { deleteMany: async () => ({ count: 0 }) },
      },
    });
    await service.setUserActive(4, false);
    expect(forOwner).toHaveBeenCalledWith(4, true);
    await service.setUserActive(4, true);
    expect(forOwner).toHaveBeenLastCalledWith(4, false);
  });
});
