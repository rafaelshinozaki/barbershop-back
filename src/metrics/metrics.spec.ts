import {
  alertLimits,
  checkAlerts,
  percentile,
  RequestRecorder,
  type MetricsSnapshot,
} from './metrics';

const snapshot = (over: Partial<MetricsSnapshot> = {}): MetricsSnapshot => ({
  _time: '2026-10-05T12:00:00.000Z',
  type: 'metrics',
  instance: 'test:1',
  intervalSec: 60,
  requests: { requests: 0, errors: 0, errorRate: 0, p50Ms: 0, p95Ms: 0, maxMs: 0, slowest: [] },
  memory: { rssMb: 100, heapUsedMb: 50 },
  cpuPercent: 5,
  eventLoopLagP99Ms: 10,
  db: { ok: true, pingMs: 2, poolBusy: 1, poolIdle: 9, poolWaiting: 0 },
  redis: { ok: true, pingMs: 1 },
  queues: [],
  backup: null,
  ...over,
});

describe('métricas do minuto', () => {
  it('percentis, erros e as operações mais lentas; zera depois de fechar', () => {
    const r = new RequestRecorder();
    for (let i = 1; i <= 100; i++) r.record('Query.searchBarbershops', i, true);
    for (let i = 0; i < 10; i++) r.record('Mutation.createAppointment', 500, i < 8);
    const s = r.flush();
    expect(s).toMatchObject({ requests: 110, errors: 2, errorRate: 0.0182, maxMs: 500 });
    expect(s.p95Ms).toBe(500);
    expect(s.slowest[0]).toEqual({
      operation: 'Mutation.createAppointment',
      count: 10,
      errors: 2,
      p95Ms: 500,
    });
    expect(s.slowest[1]).toMatchObject({ operation: 'Query.searchBarbershops', p95Ms: 96 });
    expect(r.flush()).toMatchObject({ requests: 0, errors: 0, p95Ms: 0, slowest: [] });
    expect(percentile([], 95)).toBe(0);
  });

  it('limites dos alertas vêm do ambiente, com padrão', () => {
    expect(alertLimits({})).toEqual({
      p95Ms: 1000,
      errorRate: 0.02,
      minRequests: 50,
      queueStuckSec: 600,
    });
    expect(alertLimits({ ALERT_P95_MS: '700', ALERT_ERROR_RATE: 'x' })).toMatchObject({
      p95Ms: 700,
      errorRate: 0.02,
    });
  });

  it('alerta: lento, erro, fila com falha nova, fila parada, pool esperando, banco e Redis fora', () => {
    const limits = alertLimits({});
    expect(checkAlerts(snapshot(), limits, new Map())).toEqual([]);
    const bad = snapshot({
      requests: {
        requests: 200,
        errors: 10,
        errorRate: 0.05,
        p50Ms: 300,
        p95Ms: 1500,
        maxMs: 4000,
        slowest: [{ operation: 'Query.searchProfessionals', count: 50, errors: 0, p95Ms: 2100 }],
      },
      db: { ok: true, pingMs: 3, poolBusy: 10, poolIdle: 0, poolWaiting: 4 },
      redis: { ok: false, pingMs: 2000 },
      queues: [
        { name: 'email', waiting: 30, active: 0, delayed: 0, failed: 7, oldestWaitingSec: 900 },
      ],
    });
    const kinds = checkAlerts(bad, limits, new Map([['email', 5]])).map((a) => a.kind);
    expect(kinds).toEqual([
      'slow',
      'errors',
      'queue-failed',
      'queue-stuck',
      'db-pool',
      'redis-down',
    ]);
    // Pouco movimento não alerta por taxa de erro nem p95; falha antiga não alerta
    const quiet = snapshot({
      requests: { ...bad.requests, requests: 10 },
      queues: [
        { name: 'email', waiting: 0, active: 0, delayed: 0, failed: 7, oldestWaitingSec: 0 },
      ],
    });
    expect(checkAlerts(quiet, limits, new Map([['email', 7]]))).toEqual([]);
    expect(
      checkAlerts(snapshot({ db: { ...bad.db, ok: false } }), limits, new Map()).map((a) => a.kind),
    ).toEqual(['db-down']);
    expect(
      checkAlerts(
        snapshot({ backup: { lastAt: '2026-10-03T06:30:00.000Z', ageHours: 53.5, stale: true } }),
        limits,
        new Map(),
      ),
    ).toEqual([{ kind: 'backup-stale', message: 'Último backup do Postgres há 54 h' }]);
  });
});
