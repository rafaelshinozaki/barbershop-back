import { RetentionService } from './retention.service';

/**
 * A guarda diária toca várias tabelas. Aqui o banco é um dublê: findMany vazio
 * e deleteMany com contagem, para conferir só a escolha de Página vencida.
 */
function stubPrisma() {
  const calls: { model: string; method: string; args: unknown }[] = [];
  const prisma = new Proxy(
    {},
    {
      get: (_target, model: string) =>
        new Proxy(
          {},
          {
            get: (_model, method: string) => async (args: unknown) => {
              calls.push({ model, method, args });
              if (method === 'findMany') return [];
              if (model === 'socialPageChoice') return { count: 2 };
              return { count: 0 };
            },
          },
        ),
    },
  );
  return { prisma, calls };
}

describe('Guarda: escolha de Página do Facebook vencida', () => {
  it('apaga SocialPageChoice com expiresAt no passado e deixa a que ainda vale', async () => {
    const now = new Date('2026-10-20T15:00:00Z');
    const { prisma, calls } = stubPrisma();
    const result = await new RetentionService(prisma as never).run(now);
    expect(result.socialPageChoices).toBe(2);
    expect(calls).toContainEqual({
      model: 'socialPageChoice',
      method: 'deleteMany',
      args: { where: { expiresAt: { lt: now } } },
    });
  });
});
