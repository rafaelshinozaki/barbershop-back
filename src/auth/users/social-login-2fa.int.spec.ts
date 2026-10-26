/**
 * Item 315, contra o Postgres de verdade: a opção "login social também pede o
 * código" só liga com as duas etapas ligadas, desligar pede a senha atual, e
 * desligar as duas etapas zera a opção.
 */
import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { SOCIAL_TWO_FACTOR_NEEDS_2FA_MESSAGE, UserService } from './users.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const PASSWORD = 'Senha#Forte1';

describe('Login social com duas etapas (integração)', () => {
  const prisma = new PrismaService();
  const service = new UserService(
    prisma,
    { sendTemplateEmail: async () => undefined } as never,
    {} as never,
    { get: () => undefined } as never,
    { client: {} } as never,
  );
  let userId: number;

  beforeAll(async () => {
    const role =
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }));
    userId = (
      await prisma.user.create({
        data: {
          email: `social2fa-${RUN}@test.local`,
          password: await bcrypt.hash(PASSWORD, 10),
          fullName: 'Teste',
          idDocNumber: `s2f${RUN}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'male',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          isActive: true,
          roleId: role.id,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM "User" WHERE id = ${userId}`;
    await prisma.$disconnect();
  });

  const option = async () =>
    (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).socialLoginTwoFactor;

  it('sem as duas etapas não liga; com elas, liga', async () => {
    await expect(service.setSocialLoginTwoFactor(userId, true)).rejects.toThrow(
      SOCIAL_TWO_FACTOR_NEEDS_2FA_MESSAGE,
    );
    await prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
    await service.setSocialLoginTwoFactor(userId, true);
    expect(await option()).toBe(true);
  });

  it('desligar pede a senha atual', async () => {
    await expect(service.setSocialLoginTwoFactor(userId, false, 'errada')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(await option()).toBe(true);
    await service.setSocialLoginTwoFactor(userId, false, PASSWORD);
    expect(await option()).toBe(false);
  });

  it('desligar as duas etapas zera a opção', async () => {
    await service.setSocialLoginTwoFactor(userId, true);
    await service.setTwoFactor(userId, false);
    expect(await option()).toBe(false);
  });
});
