import { PrismaService } from '../../prisma/prisma.service';
import { UserResolver } from './user.resolver';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

/**
 * Trocar o nome depois da verificação de identidade tira o selo.
 * O outro caminho (UserService.updateUser) já fazia isso; o perfil pelo
 * GraphQL gravava direto e o selo ficava.
 */
describe('updateUserProfile e o selo de identidade', () => {
  const prisma = new PrismaService();
  const resolver = new UserResolver({} as never, prisma, {} as never);
  let userId: number;

  beforeAll(async () => {
    const role =
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }));
    userId = (
      await prisma.user.create({
        data: {
          email: `selo-${RUN}@test.local`,
          password: 'x',
          fullName: 'Nome Verificado',
          idDocNumber: `selo${RUN}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'female',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          isActive: true,
          roleId: role.id,
          identityVerifiedAt: new Date(),
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('o mesmo nome mantém o selo; outro nome limpa', async () => {
    await resolver.updateUserProfile({ id: userId } as never, { fullName: 'Nome Verificado' });
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).identityVerifiedAt,
    ).toBeTruthy();

    await resolver.updateUserProfile({ id: userId } as never, { phone: '+5511988887777' });
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).identityVerifiedAt,
    ).toBeTruthy();

    await resolver.updateUserProfile({ id: userId } as never, { fullName: 'Outro Nome' });
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).identityVerifiedAt,
    ).toBeNull();
  });
});
