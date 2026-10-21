/**
 * Item 240, contra o Postgres de verdade: agenda pessoal encerrada pode ser
 * aberta de novo, dois "começar" juntos criam uma só e a moeda é a do país
 * da agenda (não a do estabelecimento que a pessoa já tem).
 */
import { PrismaService } from '../prisma/prisma.service';
import { SoloService } from './solo.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('Agenda pessoal: abrir, encerrar e abrir de novo (integração)', () => {
  const prisma = new PrismaService();
  const solo = new SoloService(prisma);
  let userId: number;
  let networkId: number;

  const input = {
    name: 'Agenda da Ana',
    city: 'Lisboa',
    state: 'Lisboa',
    country: 'PT',
    address: 'Rua A, 1',
    postalCode: '1000-001',
    phone: '+351912345678',
  };

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    userId = (
      await prisma.user.create({
        data: {
          email: `r240-ana-${RUN}@test.local`,
          isActive: true,
          password: 'x',
          fullName: 'Ana',
          idDocNumber: `r240${RUN}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'female',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      })
    ).id;
    // Ela já é dona de um estabelecimento no Brasil (rede em reais)
    networkId = (
      await prisma.network.create({
        data: { ownerUserId: userId, name: `Rede ${RUN}`, currency: 'BRL' },
      })
    ).id;
  });

  afterAll(async () => {
    const shops = await prisma.barbershop.findMany({ where: { networkId }, select: { id: true } });
    const ids = shops.map((s) => s.id);
    await prisma.barber.deleteMany({ where: { barbershopId: { in: ids } } });
    await prisma.barbershop.deleteMany({ where: { id: { in: ids } } });
    await prisma.professional.deleteMany({ where: { userId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  it('dois "começar" ao mesmo tempo criam uma agenda só, na moeda do país dela', async () => {
    const [a, b] = await Promise.all([solo.start(userId, input), solo.start(userId, input)]);
    expect(a.active && b.active).toBe(true);
    const open = await prisma.barbershop.findMany({
      where: { ownerUserId: userId, practiceKind: 'solo', closedAt: null },
    });
    expect(open).toHaveLength(1);
    expect(open[0].currency).toBe('EUR');
  });

  it('depois de encerrada, o status não mostra a agenda e dá para abrir outra', async () => {
    const first = await prisma.barbershop.findFirstOrThrow({
      where: { ownerUserId: userId, practiceKind: 'solo', closedAt: null },
    });
    await prisma.barbershop.update({
      where: { id: first.id },
      data: { closedAt: new Date(), isActive: false, slug: `${first.slug}--encerrada-${first.id}` },
    });
    expect((await solo.status(userId)).active).toBe(false);
    const again = await solo.start(userId, input);
    expect(again.active).toBe(true);
    const open = await prisma.barbershop.findFirstOrThrow({
      where: { ownerUserId: userId, practiceKind: 'solo', closedAt: null },
    });
    expect(open.id).not.toBe(first.id);
  });
});
