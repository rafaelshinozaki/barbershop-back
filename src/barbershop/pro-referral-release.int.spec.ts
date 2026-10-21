/**
 * Item 239, contra o Postgres de verdade: o mês de quem indicou só entra
 * quando a conta indicada atende de verdade, e entra uma vez só.
 */
import { PrismaService } from '../prisma/prisma.service';
import { releaseInviterMonths } from './pro-referral-release';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('Mês de quem indicou o Pro (integração)', () => {
  const prisma = new PrismaService();
  let inviterId: number;
  let invitedId: number;
  let networkId: number;
  let shopId: number;
  let barberId: number;
  let customerId: number;

  const user = async (tag: string, roleId: number) =>
    (
      await prisma.user.create({
        data: {
          email: `r239-${tag}-${RUN}@test.local`,
          isActive: true,
          password: 'x',
          fullName: tag,
          idDocNumber: `${tag}${RUN}`.slice(-20),
          phone: `+55${tag.length}${RUN}`.slice(0, 20),
          gender: 'other',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      })
    ).id;

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    inviterId = await user('indicou', roleId);
    invitedId = await user('indicada', roleId);
    networkId = (
      await prisma.network.create({ data: { ownerUserId: invitedId, name: `R ${RUN}` } })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: 'Agenda indicada',
          slug: `r239-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `r239-shop-${RUN}@test.local`,
          networkId,
          ownerUserId: invitedId,
          practiceKind: 'solo',
        },
      })
    ).id;
    barberId = (
      await prisma.barber.create({
        data: {
          barbershopId: shopId,
          name: 'Indicada',
          phone: `+55118${RUN}`.slice(0, 20),
          userId: invitedId,
        },
      })
    ).id;
    customerId = (
      await prisma.customer.create({
        data: { networkId, name: 'Cliente', phone: `+55117${RUN}`.slice(0, 20) },
      })
    ).id;
    await prisma.proReferral.create({
      data: { inviterUserId: inviterId, invitedUserId: invitedId, months: 1 },
    });
  });

  afterAll(async () => {
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  const appointment = (data: { status: string; endAt: Date; source?: string }) =>
    prisma.appointment.create({
      data: {
        barbershopId: shopId,
        customerId,
        barberId,
        startAt: new Date(data.endAt.getTime() - 30 * 60_000),
        endAt: data.endAt,
        status: data.status,
        source: data.source ?? 'PHONE',
      },
    });

  const proUntil = async () =>
    (await prisma.user.findUniqueOrThrow({ where: { id: inviterId } })).proUntil;

  it('sem atendimento de verdade, o mês de quem indicou não entra', async () => {
    const past = new Date(Date.now() - 3_600_000);
    // Lançado pela própria conta (por telefone, sem conta de cliente) e
    // marcado como concluído no futuro: não conta
    await appointment({ status: 'COMPLETED', endAt: past });
    await appointment({
      status: 'COMPLETED',
      endAt: new Date(Date.now() + 86_400_000),
      source: 'ONLINE',
    });
    await appointment({ status: 'CANCELLED', endAt: past, source: 'ONLINE' });
    expect(await releaseInviterMonths(prisma, inviterId)).toBe(0);
    expect(await proUntil()).toBeNull();
  });

  it('atendimento concluído agendado pela página libera o mês, uma vez só', async () => {
    await appointment({
      status: 'COMPLETED',
      endAt: new Date(Date.now() - 60_000),
      source: 'ONLINE',
    });
    const [a, b] = await Promise.all([
      releaseInviterMonths(prisma, inviterId),
      releaseInviterMonths(prisma, inviterId),
    ]);
    expect(a + b).toBe(1);
    const until = await proUntil();
    expect(until).not.toBeNull();
    const days = ((until as Date).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(27);
    expect(days).toBeLessThan(32);
    const referral = await prisma.proReferral.findUniqueOrThrow({
      where: { invitedUserId: invitedId },
    });
    expect(referral.inviterGrantedAt).not.toBeNull();
    expect(await releaseInviterMonths(prisma, inviterId)).toBe(0);
  });
});
