/**
 * Espaço compartilhado (cadeira alugada, como o "Shared Location" do Booksy),
 * contra o Postgres de verdade.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';
import { SharedLocationService } from './shared-location.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('Espaço compartilhado (integração)', () => {
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
  const events: string[] = [];
  const service = new SharedLocationService(prisma, barbershops, {
    sharedLocationEvent: async (to: number, event: string) => void events.push(`${to}:${event}`),
  } as never);

  let roleId: number;
  const shops: Record<
    'host' | 'member' | 'sibling',
    { ownerId: number; shopId: number; networkId: number }
  > = {} as never;
  let hostBarberUserId: number;

  const createUser = (label: string) =>
    prisma.user.create({
      data: {
        email: `sl-${label}-${RUN}@test.local`,
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
  const createShop = (label: string, networkId: number, ownerUserId: number) =>
    prisma.barbershop.create({
      data: {
        name: `SL ${label}`,
        slug: `sl-${label}-${RUN}`,
        address: 'Rua 1',
        city: 'SP',
        state: 'SP',
        country: 'BR',
        postalCode: '01000000',
        phone: '11999999999',
        email: `sl-${label}-${RUN}@test.local`,
        networkId,
        ownerUserId,
      },
    });

  beforeAll(async () => {
    roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    for (const label of ['host', 'member'] as const) {
      const owner = await createUser(label);
      const network = await prisma.network.create({
        data: { ownerUserId: owner.id, name: `Rede SL ${label} ${RUN}` },
      });
      const shop = await createShop(label, network.id, owner.id);
      shops[label] = { ownerId: owner.id, shopId: shop.id, networkId: network.id };
    }
    // Outra unidade da mesma rede do espaço
    const sibling = await createShop('sibling', shops.host.networkId, shops.host.ownerId);
    shops.sibling = { ...shops.host, shopId: sibling.id };
    // Barbeiro do espaço (sem cargo de gestão)
    hostBarberUserId = (await createUser('hostbarber')).id;
    await prisma.barber.create({
      data: {
        barbershopId: shops.host.shopId,
        userId: hostBarberUserId,
        name: 'Barbeiro do espaço',
        phone: '11911110000',
      },
    });
  });

  afterAll(async () => {
    const ids = Object.values(shops).map((s) => s.shopId);
    await prisma.sharedLocationMember.deleteMany({ where: { hostBarbershopId: { in: ids } } });
    await prisma.barber.deleteMany({ where: { barbershopId: { in: ids } } });
    await prisma.barbershop.deleteMany({ where: { id: { in: ids } } });
    await prisma.network.deleteMany({
      where: { id: { in: [shops.host.networkId, shops.member.networkId] } },
    });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  it('o espaço convida pelo link da página do profissional; ele aceita e os dois aparecem nas páginas', async () => {
    // Barbeiro do espaço não convida (é do gerente/dono)
    await expect(
      service.invite(hostBarberUserId, shops.host.shopId, `sl-member-${RUN}`),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // Unidade da mesma rede não é profissional independente
    await expect(
      service.invite(shops.host.ownerId, shops.host.shopId, `sl-sibling-${RUN}`),
    ).rejects.toThrow(/própria rede/);
    await expect(
      service.invite(shops.host.ownerId, shops.host.shopId, 'nao-existe-xyz'),
    ).rejects.toThrow(/Não achamos/);

    const link = await service.invite(
      shops.host.ownerId,
      shops.host.shopId,
      `https://app.test/u/sl-member-${RUN}/`,
    );
    expect(link).toMatchObject({ status: 'PENDING', shop: { slug: `sl-member-${RUN}` } });
    expect(events).toContain(`${shops.member.shopId}:invited`);
    await expect(
      service.invite(shops.host.ownerId, shops.host.shopId, `sl-member-${RUN}`),
    ).rejects.toThrow(/pendente/);

    // Cada lado vê o vínculo na sua lista
    expect((await service.list(shops.host.ownerId, shops.host.shopId)).asHost).toHaveLength(1);
    expect((await service.list(shops.member.ownerId, shops.member.shopId)).asMember).toMatchObject([
      { status: 'PENDING', shop: { slug: `sl-host-${RUN}` } },
    ]);
    // Pendente ainda não aparece na página pública
    expect((await service.publicLinks(shops.host.shopId)).sharedLocationMembers).toEqual([]);

    // Só o profissional responde o convite
    await expect(service.respond(shops.host.ownerId, link.id, true)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await service.respond(shops.member.ownerId, link.id, true);
    expect(events).toContain(`${shops.host.shopId}:accepted`);
    await expect(service.respond(shops.member.ownerId, link.id, true)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    const hostPage = await service.publicLinks(shops.host.shopId);
    expect(hostPage.sharedLocationMembers.map((s) => s.slug)).toEqual([`sl-member-${RUN}`]);
    const memberPage = await service.publicLinks(shops.member.shopId);
    expect(memberPage.sharedLocationHosts.map((s) => s.slug)).toEqual([`sl-host-${RUN}`]);

    // Cada negócio continua separado: o espaço não entra nos dados do profissional
    await expect(
      barbershops.getCustomers(shops.host.ownerId, shops.member.shopId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('qualquer lado encerra; depois dá pra convidar de novo, e recusar também avisa', async () => {
    const [link] = (await service.list(shops.member.ownerId, shops.member.shopId)).asMember;
    // O profissional sai do espaço
    await expect(
      service.end(shops.member.ownerId, link.id, shops.host.shopId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await service.end(shops.member.ownerId, link.id, shops.member.shopId);
    expect(events).toContain(`${shops.host.shopId}:left`);
    expect((await service.publicLinks(shops.host.shopId)).sharedLocationMembers).toEqual([]);
    expect((await service.list(shops.host.ownerId, shops.host.shopId)).asHost).toEqual([]);

    // Convite de novo, e o profissional recusa
    const again = await service.invite(shops.host.ownerId, shops.host.shopId, `sl-member-${RUN}`);
    expect(again.id).toBe(link.id);
    await service.respond(shops.member.ownerId, again.id, false);
    expect(events).toContain(`${shops.host.shopId}:declined`);
    expect((await service.publicLinks(shops.member.shopId)).sharedLocationHosts).toEqual([]);
  });
});
