import { BadRequestException } from '@nestjs/common';
import { SharedLocationService } from './shared-location.service';

const DAY = 86_400_000;
const COOLDOWN = 'Só dá para convidar de novo 30 dias depois de recusar ou encerrar.';
const BLOCKED = 'Este profissional bloqueou convites deste espaço.';
const STILL_THERE = 'Saia do espaço antes de bloquear novos convites.';

const shop = {
  id: 4,
  name: 'Studio',
  slug: 'studio',
  address: 'Rua 1',
  city: 'SP',
  state: 'SP',
  isActive: true,
};

describe('vitrine e convite do espaço compartilhado', () => {
  it('a página pública exige dono ativo e unidade fora da moderação', async () => {
    const wheres: Array<Record<string, unknown>> = [];
    const service = Object.create(SharedLocationService.prototype) as SharedLocationService;
    Object.assign(service, {
      prisma: {
        sharedLocationMember: {
          findMany: async ({ where }: { where: Record<string, unknown> }) => {
            wheres.push(where);
            return [];
          },
        },
      },
    });
    await service.publicLinks(3);
    expect(wheres[0]).toMatchObject({
      status: 'ACTIVE',
      member: { isActive: true, searchHiddenAt: null, platformSuspendedAt: null },
    });
    expect(wheres[1]).toMatchObject({
      status: 'ACTIVE',
      host: { isActive: true, searchHiddenAt: null, platformSuspendedAt: null },
    });
  });

  function build(existing: Record<string, unknown> | null) {
    const updates: Record<string, unknown>[] = [];
    const events: string[] = [];
    const service = Object.create(SharedLocationService.prototype) as SharedLocationService;
    Object.assign(service, {
      prisma: {
        barbershop: {
          findUnique: async () => ({ id: 4, isActive: true, networkId: 2 }),
        },
        sharedLocationMember: {
          findUnique: async () => existing,
          findUniqueOrThrow: async () => ({
            id: 8,
            status: 'PENDING',
            invitesBlockedAt: null,
            createdAt: new Date(),
            hostBarbershopId: 3,
            memberBarbershopId: 4,
            host: { ...shop, id: 3, name: 'Espaço', slug: 'espaco' },
            member: shop,
          }),
          update: async ({ data }: { data: Record<string, unknown> }) => {
            updates.push(data);
            return { id: 8, updatedAt: new Date(), ...(existing ?? {}), ...data };
          },
        },
      },
      barbershopService: {
        ensureAccess: async () => ({ id: 3, name: 'Espaço', networkId: 1 }),
      },
      activity: {
        sharedLocationEvent: async (_to: number, event: string) => {
          events.push(event);
        },
      },
      chairRent: { view: async () => ({ linkId: 8 }) },
    });
    return { service, updates, events };
  }

  const declined = (daysAgo: number, invitesBlockedAt: Date | null = null) => ({
    id: 8,
    status: 'DECLINED',
    invitesBlockedAt,
    respondedAt: new Date(Date.now() - daysAgo * DAY),
    updatedAt: new Date(),
    hostBarbershopId: 3,
    memberBarbershopId: 4,
    member: { name: 'Studio' },
  });

  it('convite recusado há pouco não se repete', async () => {
    const { service, updates } = build(declined(1));
    await expect(service.invite(1, 3, 'studio')).rejects.toThrow(new BadRequestException(COOLDOWN));
    expect(updates).toEqual([]);
  });

  it('depois de 30 dias o convite pode ser refeito', async () => {
    const { service, updates } = build(declined(31));
    await service.invite(1, 3, 'studio');
    expect(updates[0]).toMatchObject({ status: 'PENDING', respondedAt: null });
  });

  it('bloqueio do profissional impede o convite', async () => {
    const { service, updates } = build(declined(40, new Date()));
    await expect(service.invite(1, 3, 'studio')).rejects.toThrow(new BadRequestException(BLOCKED));
    expect(updates).toEqual([]);
  });

  it('bloquear um convite pendente recusa e marca o bloqueio', async () => {
    const { service, updates, events } = build({
      ...declined(0),
      status: 'PENDING',
      invitesBlockedAt: null,
    });
    await expect(service.setInviteBlock(2, 8, 4, true)).resolves.toBe(true);
    expect(updates[0]).toMatchObject({ status: 'DECLINED' });
    expect(updates[0].invitesBlockedAt).toBeInstanceOf(Date);
    expect(events).toEqual(['declined']);
  });

  it('não bloqueia enquanto ainda atende no espaço', async () => {
    const { service, updates } = build({ ...declined(0), status: 'ACTIVE' });
    await expect(service.setInviteBlock(2, 8, 4, true)).rejects.toThrow(
      new BadRequestException(STILL_THERE),
    );
    expect(updates).toEqual([]);
  });
});
