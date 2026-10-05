/**
 * R3 contra o Postgres de verdade: a ação da equipe da plataforma no registro
 * de ações vem com o antes → depois (histórico do mesmo request) e a unidade
 * afetada; a ficha da unidade junta dono, equipe e movimento; e o histórico
 * interno mostra quem da equipe mexeu (o dono vê "Equipe da plataforma").
 */
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { requestContext, type ChangeActor } from '../common/request-context';
import { BackofficeAuditService } from './audit/backoffice-audit.service';
import { BarbershopDossierService } from './barbershop-dossier.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('Registro de ações + ficha da unidade (integração)', () => {
  const prisma = new PrismaService();
  const audit = new BackofficeAuditService(prisma);
  const dossier = new BarbershopDossierService(prisma);
  const staff: ChangeActor = {
    type: 'staff',
    id: 999002,
    name: `Funcionária ${RUN}`,
    role: 'SystemManager',
    origin: 'backoffice',
    reason: 'pedido do dono',
  };
  const requestId = `req-r3-${RUN}`;
  let ownerId: number;
  let networkId: number;
  let shopId: number;
  let clientId: number;

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = (
      await prisma.user.create({
        data: {
          email: `r3-${RUN}@test.local`,
          password: 'x',
          fullName: 'Dona R3',
          idDocNumber: `${RUN}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'female',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      })
    ).id;
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede R3 ${RUN}` } })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: 'Unidade R3',
          slug: `r3-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `r3-shop-${RUN}@test.local`,
          timezone: 'America/Sao_Paulo',
          networkId,
          ownerUserId: ownerId,
        },
      })
    ).id;
    await prisma.barber.create({
      data: { barbershopId: shopId, name: 'Ana R3', phone: '11911111111' },
    });
    clientId = (
      await prisma.clientAccount.create({
        data: { email: `r3-client-${RUN}@test.local`, name: 'Cliente R3' },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.changeLog.deleteMany({
      where: {
        OR: [
          { barbershopId: shopId },
          { networkId },
          { requestId },
          { entityType: 'ClientAccount', entityId: String(clientId) },
          { entityType: 'User', entityId: String(ownerId) },
        ],
      },
    });
    await prisma.backofficeAuditLog.deleteMany({ where: { requestId } });
    await prisma.clientAccount.deleteMany({ where: { id: clientId } });
    await prisma.barber.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
    await prisma.$disconnect();
  });

  it('a ação no registro vem com o antes → depois e a unidade afetada', async () => {
    const until = new Date('2030-01-31T12:00:00Z');
    await requestContext.run({ requestId, actor: staff }, async () => {
      await prisma.barbershop.update({ where: { id: shopId }, data: { featuredUntil: until } });
      await prisma.clientAccount.update({
        where: { id: clientId },
        data: { suspendedAt: new Date(), suspendedReason: 'fraude' },
      });
    });
    await audit.record({
      actorId: staff.id,
      actorEmail: 'staff@test.local',
      actorRole: 'SystemManager',
      operation: `setBarbershopFeatured${RUN}`,
      area: 'operations',
      args: { barbershopId: shopId },
      success: true,
      requestId,
    });

    const page = await audit.list({ operation: `setBarbershopFeatured${RUN}` });
    expect(page.items).toHaveLength(1);
    const changes = page.items[0].changes;
    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'Barbershop',
          entityName: 'Unidade R3',
          barbershopId: shopId,
          barbershopName: 'Unidade R3',
          action: 'update',
          fields: [
            { field: 'featuredUntil', before: null, after: expect.stringMatching(/^2030-01-31/) },
          ],
        }),
        // Conta de cliente não é de uma unidade: entra no registro, não no Histórico do dono
        expect.objectContaining({
          entityType: 'ClientAccount',
          barbershopId: null,
          fields: expect.arrayContaining([
            { field: 'suspendedReason', before: null, after: 'fraude' },
          ]),
        }),
      ]),
    );
  });

  it('a ficha junta dono, equipe e movimento', async () => {
    const d = await dossier.detail(shopId);
    expect(d).toMatchObject({
      id: shopId,
      name: 'Unidade R3',
      networkName: `Rede R3 ${RUN}`,
      owner: { id: ownerId, fullName: 'Dona R3' },
      team: [{ name: 'Ana R3', hasAccount: false, isActive: true }],
      appointments30d: 0,
      payments: { connected: false },
      openSupportTickets: 0,
      openReports: 0,
    });
    await expect(dossier.detail(-1)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('o histórico interno mostra quem da equipe mexeu, com o motivo', async () => {
    const log = await dossier.changeLog(shopId);
    const featured = log.items.find((i) => i.entityType === 'Barbershop');
    expect(featured).toMatchObject({
      actorKind: 'platform',
      actorName: staff.name,
      reason: 'pedido do dono',
    });
    // A conta de cliente (sem unidade) não entra no histórico da unidade
    expect(log.items.some((i) => i.entityType === 'ClientAccount')).toBe(false);
  });
});
