/**
 * Sessão da equipe contra o banco de verdade: só o cookie do cliente, o
 * state do OAuth ou um token sem sessão ativa não entram (antes, o cookie do
 * cliente virava o usuário 1); a sessão de verdade entra.
 */
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { GraphQLJwtAuthGuard } from './graphql-jwt-auth.guard';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const SECRET = 'segredo-de-teste';

describe('GraphQLJwtAuthGuard (integração)', () => {
  const prisma = new PrismaService();
  const jwt = new JwtService({ secret: SECRET });
  const guard = new GraphQLJwtAuthGuard(
    jwt,
    { get: (k: string) => (k === 'JWT_SECRET' ? SECRET : undefined) } as never,
    prisma,
    { getAllAndOverride: () => undefined } as never,
  );
  let userId: number;
  const sessionToken = `guard-${RUN}`;

  const run = (cookies: Record<string, string>) => {
    const req: {
      cookies: Record<string, string>;
      headers: Record<string, string>;
      user?: { id: number };
    } = {
      cookies,
      headers: {
        cookie: Object.entries(cookies)
          .map(([k, v]) => `${k}=${v}`)
          .join('; '),
      },
    };
    jest
      .spyOn(GqlExecutionContext, 'create')
      .mockReturnValue({ getContext: () => ({ req, res: undefined }) } as never);
    return guard
      .canActivate({
        getHandler: () => undefined,
        getClass: () => undefined,
      } as unknown as ExecutionContext)
      .then(() => req.user);
  };

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    userId = (
      await prisma.user.create({
        data: {
          email: `guard-${RUN}@test.local`,
          password: 'x',
          fullName: 'Guard Teste',
          idDocNumber: `g${RUN}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'male',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      })
    ).id;
    await prisma.activeSession.create({
      data: {
        userId,
        sessionToken,
        deviceType: 'd',
        browser: 'b',
        os: 'o',
        ip: 'i',
        location: 'l',
      },
    });
  });

  afterAll(async () => {
    await prisma.activeSession.deleteMany({ where: { userId } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE id = ${userId}`;
    await prisma.$disconnect();
  });

  it('só o cookie do cliente não entra como equipe', async () => {
    const client = jwt.sign({ clientAccountId: 1, email: 'c@test.local', v: 0 });
    await expect(run({ ClientAuthentication: client })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    // Nem colocado no cookie da equipe
    await expect(run({ Authentication: client })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('state do OAuth (tem userId) e token sem sessão ativa não entram', async () => {
    const state = jwt.sign({ barbershopId: 1, userId });
    await expect(run({ Authentication: state })).rejects.toBeInstanceOf(UnauthorizedException);
    const ended = jwt.sign({ userId, email: 'x', sessionToken: `outra-${RUN}` });
    await expect(run({ Authentication: ended })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('sessão de verdade entra, como o próprio usuário', async () => {
    const token = jwt.sign({ userId, email: 'x', sessionToken });
    await expect(
      run({ Authentication: token, ClientAuthentication: 'qualquer' }),
    ).resolves.toMatchObject({ id: userId });
  });

  it('busca de usuário sem id dá erro (não devolve o primeiro da tabela)', async () => {
    await expect(prisma.user.findUnique({ where: { id: undefined as never } })).rejects.toThrow(
      /sem chave/,
    );
  });
});
