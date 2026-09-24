/**
 * Senha do dono/funcionário, contra o Postgres de verdade: trocar ou redefinir
 * derruba as sessões abertas, o link de redefinição fica só em hash no banco e
 * o "esqueci a senha" não denuncia quem tem conta.
 */
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { UserService } from './users.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const OLD = 'Antiga#Senha1';

describe('Senha: sessões e link de redefinição (integração)', () => {
  const prisma = new PrismaService();
  const sent: Array<{ template: string; context: any; to: string }> = [];
  const service = new UserService(
    prisma,
    {
      sendTemplateEmail: async (
        _u: number,
        template: string,
        context: any,
        _s: unknown,
        _t: string,
        to: string,
      ) => void sent.push({ template, context, to }),
    } as never,
    {} as never,
    { get: (k: string) => (k === 'FRONTEND_URL' ? 'https://app.test' : undefined) } as never,
    // Contador de tentativas no Redis: sem Redis o login segue (só não conta)
    {
      client: {
        exists: async () => 0,
        incr: async () => 1,
        expire: async () => 1,
        del: async () => 1,
      },
    } as never,
  );
  let userId: number;
  const email = `pw-${RUN}@test.local`;

  const openSession = (token: string) =>
    prisma.activeSession.create({
      data: {
        userId,
        sessionToken: `${token}-${RUN}`,
        deviceType: 'desktop',
        browser: 'Chrome',
        os: 'Linux',
        ip: '127.0.0.1',
        location: '—',
      },
    });
  const sessions = async () =>
    (await prisma.activeSession.findMany({ where: { userId } })).map((s) => s.sessionToken);
  const waitForEmail = async (count: number) => {
    for (let i = 0; i < 50 && sent.length < count; i++) await new Promise((r) => setTimeout(r, 20));
  };

  beforeAll(async () => {
    const role =
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }));
    userId = (
      await prisma.user.create({
        data: {
          email,
          password: await bcrypt.hash(OLD, 10),
          fullName: 'Teste Senha',
          idDocNumber: `pw${RUN}`.slice(-20),
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
    await prisma.activeSession.deleteMany({ where: { userId } });
    await prisma.passwordResetToken.deleteMany({ where: { userId } });
    await prisma.verificationCode.deleteMany({ where: { userId } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE id = ${userId}`;
    await prisma.$disconnect();
  });

  it('esqueci a senha: link só em hash no banco; redefinir derruba todas as sessões', async () => {
    await openSession('ladrao');
    await openSession('celular');

    // E-mail com maiúsculas também acha a conta
    await expect(service.forgotPass({ email: email.toUpperCase() })).resolves.toBe(true);
    await waitForEmail(1);
    const link: string = sent[0].context.ResetURL;
    const token = link.split('/forgot-password/')[1].split('?')[0];
    const stored = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId } });
    expect(stored.token).not.toBe(token); // o banco não tem o link
    expect(stored.token).toHaveLength(64); // sha256

    expect(await service.forgotPassCheck({ token, email })).toBe(true);
    await service.resetPasswordByToken(email, token, 'Nova#Senha2');
    expect(await sessions()).toEqual([]);
    // Link usado não vale de novo
    await expect(service.resetPasswordByToken(email, token, 'Outra#Senha3')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('trocar a senha (logado) derruba as outras sessões e mantém a atual', async () => {
    await openSession('atual');
    await openSession('outra');
    await prisma.verificationCode.create({
      data: { userId, code: `c${RUN}`.slice(0, 12), expiresAt: new Date(Date.now() + 600_000) },
    });
    await service.changePassword(
      userId,
      email,
      'Nova#Senha2',
      'Troca#Senha4',
      `c${RUN}`.slice(0, 12),
      `atual-${RUN}`,
    );
    expect(await sessions()).toEqual([`atual-${RUN}`]);
  });

  it('esqueci a senha pra e-mail sem conta responde igual e não manda nada', async () => {
    const before = sent.length;
    await expect(service.forgotPass({ email: `ninguem-${RUN}@test.local` })).resolves.toBe(true);
    await new Promise((r) => setTimeout(r, 100));
    expect(sent.length).toBe(before);
  });

  it('login de e-mail sem conta leva o tempo de uma senha errada', async () => {
    const time = async (fn: () => Promise<unknown>) => {
      const t = Date.now();
      await fn().catch(() => undefined);
      return Date.now() - t;
    };
    const missing = await time(() => service.verifyUser(`ninguem-${RUN}@test.local`, 'Qualquer#1'));
    const wrong = await time(() => service.verifyUser(email, 'Errada#Senha9'));
    // Os dois passam por um bcrypt (dezenas de ms); sem conta não pode ser instantâneo
    expect(missing).toBeGreaterThan(wrong / 3);
  });
});
