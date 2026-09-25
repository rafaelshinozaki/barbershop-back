import { Test } from '@nestjs/testing';
import { UserService } from './users.service';
import { PrismaService } from '@/prisma/prisma.service';

// Histórico de login e sessões ativas como a tela de segurança recebe
describe('UserService — histórico de login e sessões', () => {
  const at = new Date('2026-09-25T14:46:00Z');
  let service: UserService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
      loginHistory: {
        count: jest.fn().mockResolvedValue(3),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 3,
            userId: 1,
            sessionToken: 'atual',
            latitude: -23.5,
            longitude: -46.6,
            location: 'São Paulo',
            createdAt: at,
          },
          {
            id: 2,
            userId: 1,
            sessionToken: 'outra',
            latitude: null,
            longitude: null,
            location: 'Local Network',
            createdAt: at,
          },
          {
            id: 1,
            userId: 1,
            sessionToken: null,
            latitude: null,
            longitude: null,
            location: 'Unknown',
            createdAt: at,
          },
        ]),
      },
      activeSession: {
        count: jest.fn().mockResolvedValue(2),
        findMany: jest.fn(),
      },
    };
    const module = await Test.createTestingModule({
      providers: [UserService, { provide: PrismaService, useValue: prisma }],
    })
      .useMocker(() => ({}))
      .compile();
    service = module.get(UserService);
  });

  it('login diz se a sessão que abriu ainda está ativa (sem expor o token)', async () => {
    prisma.activeSession.findMany.mockResolvedValue([
      { id: 10, sessionToken: 'atual' },
      { id: 11, sessionToken: 'outra' },
    ]);
    const { data } = await service.getLoginHistory(1, 1, 10, 'atual');
    expect(prisma.activeSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 1, sessionToken: { in: ['atual', 'outra'] } } }),
    );
    expect(data.map((d) => [d.sessionId, d.isCurrent])).toEqual([
      [10, true],
      [11, false],
      [null, false],
    ]);
    expect(data[0]).toMatchObject({
      latitude: -23.5,
      longitude: -46.6,
      createdAt: at.toISOString(),
    });
    expect(data.some((d) => 'sessionToken' in d)).toBe(false);
  });

  it('sessão ativa vem com data em ISO (antes ia número e a tela mostrava "-")', async () => {
    prisma.activeSession.findFirst = jest.fn().mockResolvedValue(null);
    prisma.activeSession.findMany.mockResolvedValue([
      { id: 10, userId: 1, sessionToken: 'atual', createdAt: at, latitude: 1, longitude: 2 },
      { id: 11, userId: 1, sessionToken: 'outra', createdAt: at, latitude: null, longitude: null },
    ]);
    const { data } = await service.getActiveSessions(1, 1, 10, 'atual');
    expect(data[0]).toMatchObject({
      id: 10,
      isCurrent: true,
      createdAt: at.toISOString(),
      latitude: 1,
    });
    expect(data[1]).toMatchObject({ id: 11, isCurrent: false });
    expect(data.some((d) => 'sessionToken' in d)).toBe(false);
  });

  it('a sessão em uso vem primeiro, mesmo sendo a mais antiga', async () => {
    const current = { id: 1, userId: 1, sessionToken: 'atual', createdAt: at };
    prisma.activeSession.findFirst = jest.fn().mockResolvedValue(current);
    prisma.activeSession.findMany.mockResolvedValue([
      { id: 12, userId: 1, sessionToken: 'b', createdAt: at },
      { id: 11, userId: 1, sessionToken: 'a', createdAt: at },
    ]);
    const first = await service.getActiveSessions(1, 1, 3, 'atual');
    expect(first.data.map((d) => [d.id, d.isCurrent])).toEqual([
      [1, true],
      [12, false],
      [11, false],
    ]);
    expect(prisma.activeSession.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { userId: 1, NOT: { sessionToken: 'atual' } },
        skip: 0,
        take: 2,
      }),
    );
    // Página 2: pula as que já foram na 1ª (a atual ocupa um lugar dela)
    await service.getActiveSessions(1, 2, 3, 'atual');
    expect(prisma.activeSession.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ skip: 2, take: 3 }),
    );
  });
});
