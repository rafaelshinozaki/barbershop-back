/**
 * Publicar o perfil liga as fichas da própria conta criadas antes dele (a do
 * dono, criada com a unidade). Sem isso, o perfil público saía sem as
 * unidades e sem a distância na busca.
 */
import { PrismaService } from '../prisma/prisma.service';
import { CareerService } from './career.service';
import { ProfessionalReviewService } from './professional-review.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('Perfil público e as fichas da conta (integração)', () => {
  const prisma = new PrismaService();
  const career = new CareerService(prisma, new ProfessionalReviewService(prisma));
  let userId: number;
  let networkId: number;
  let shopId: number;

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    userId = (
      await prisma.user.create({
        data: {
          email: `pub-${RUN}@test.local`,
          isActive: true,
          password: 'x',
          fullName: 'Dono Publica',
          idDocNumber: `pub${RUN}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'male',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      })
    ).id;
    networkId = (await prisma.network.create({ data: { ownerUserId: userId, name: `Pub ${RUN}` } }))
      .id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: 'Unidade Pub',
          slug: `pub-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `pub-shop-${RUN}@test.local`,
          networkId,
          ownerUserId: userId,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.professional.deleteMany({ where: { userId } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE id = ${userId}`;
    await prisma.$disconnect();
  });

  it('a ficha do dono, criada antes do perfil, fica ligada ao publicar', async () => {
    const barber = await prisma.barber.create({
      data: { barbershopId: shopId, userId, name: 'Dono Publica', phone: '11900000001' },
    });
    expect(barber.professionalId).toBeNull();
    await career.setPublic(userId, true);
    const professional = await prisma.professional.findUniqueOrThrow({ where: { userId } });
    expect(professional.visibility).toBe('public');
    expect(
      (await prisma.barber.findUniqueOrThrow({ where: { id: barber.id } })).professionalId,
    ).toBe(professional.id);
  });
});
