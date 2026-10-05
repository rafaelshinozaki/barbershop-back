/**
 * Métricas contra o Postgres e o Redis de verdade: o minuto fecha com as
 * requests gravadas, o ping do banco e do Redis, o pool do Prisma e as
 * filas (job mais antigo esperando).
 */
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { MetricsService } from './metrics.service';

describe('MetricsService (integração)', () => {
  const prisma = new PrismaService();
  const redis = new RedisService({ get: () => process.env.REDIS_URL } as never);
  const queue = {
    getJobCounts: async () => ({ waiting: 2, active: 1, delayed: 0, failed: 3 }),
    getWaiting: async () => [{ timestamp: Date.parse('2026-10-05T11:50:00Z') }],
  };
  const moduleRef = {
    get: (token: string) => {
      if (String(token).includes('email')) return queue;
      throw new Error('não registrada');
    },
  };
  const metrics = new MetricsService(
    prisma,
    redis,
    moduleRef as never,
    {
      config: { enabled: false },
    } as never,
  );

  // Sem fila offline: espera conectar (no app, já está conectado bem antes)
  beforeAll(async () => {
    if (redis.client.status !== 'ready') {
      await new Promise((resolve) => redis.client.once('ready', resolve));
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
    redis.client.disconnect();
  });

  it('fecha o minuto com requests, banco, Redis e filas', async () => {
    metrics.recorder.record('Query.me', 12, true);
    metrics.recorder.record('Query.me', 30, false);
    const s = await metrics.tick(new Date('2026-10-05T12:00:00Z'));
    expect(s).toMatchObject({
      type: 'metrics',
      requests: { requests: 2, errors: 1, errorRate: 0.5 },
      db: { ok: true },
      redis: { ok: true },
      queues: [{ name: 'email', waiting: 2, active: 1, failed: 3, oldestWaitingSec: 600 }],
    });
    expect(s.db.poolBusy).not.toBeNull();
    expect(s.memory.rssMb).toBeGreaterThan(0);
    expect(metrics.latest()).toBe(s);
    // O minuto seguinte começa zerado
    expect((await metrics.collect()).requests.requests).toBe(0);
  });
});
