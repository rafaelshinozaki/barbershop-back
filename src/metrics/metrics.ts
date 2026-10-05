/**
 * Métricas do minuto (sem dependência de Nest, pra testar sem subir nada).
 * Cada request vira uma amostra por operação; a cada 60 s o MetricsService
 * fecha o minuto, manda pro Axiom e confere os limites dos alertas.
 */

export type OperationStats = {
  operation: string;
  count: number;
  errors: number;
  p95Ms: number;
};

export type RequestStats = {
  requests: number;
  errors: number;
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  /** As 10 operações mais lentas (p95) do minuto */
  slowest: OperationStats[];
};

export type QueueStats = {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  /** Há quanto tempo o job mais antigo espera (s); 0 sem fila */
  oldestWaitingSec: number;
};

export type MetricsSnapshot = {
  _time: string;
  type: 'metrics';
  instance: string;
  intervalSec: number;
  requests: RequestStats;
  memory: { rssMb: number; heapUsedMb: number };
  cpuPercent: number;
  eventLoopLagP99Ms: number;
  db: {
    ok: boolean;
    pingMs: number;
    poolBusy: number | null;
    poolIdle: number | null;
    poolWaiting: number | null;
  };
  redis: { ok: boolean; pingMs: number };
  queues: QueueStats[];
};

/** Percentil de uma lista já ordenada */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

const MAX_SAMPLES_PER_OPERATION = 2000;

/**
 * Amostras do minuto por operação. Guarda até 2.000 tempos por operação (o
 * suficiente pro p95 de um minuto de uma instância) e conta o resto.
 */
export class RequestRecorder {
  private byOperation = new Map<string, { times: number[]; count: number; errors: number }>();

  record(operation: string, ms: number, ok: boolean): void {
    let entry = this.byOperation.get(operation);
    if (!entry) {
      entry = { times: [], count: 0, errors: 0 };
      this.byOperation.set(operation, entry);
    }
    entry.count++;
    if (!ok) entry.errors++;
    if (entry.times.length < MAX_SAMPLES_PER_OPERATION) entry.times.push(ms);
  }

  /** Fecha o minuto e zera as amostras */
  flush(): RequestStats {
    const all: number[] = [];
    let requests = 0;
    let errors = 0;
    const perOperation: OperationStats[] = [];
    for (const [operation, e] of this.byOperation) {
      requests += e.count;
      errors += e.errors;
      const sorted = [...e.times].sort((a, b) => a - b);
      all.push(...sorted);
      perOperation.push({
        operation,
        count: e.count,
        errors: e.errors,
        p95Ms: Math.round(percentile(sorted, 95)),
      });
    }
    this.byOperation = new Map();
    all.sort((a, b) => a - b);
    return {
      requests,
      errors,
      errorRate: requests ? Math.round((errors / requests) * 10_000) / 10_000 : 0,
      p50Ms: Math.round(percentile(all, 50)),
      p95Ms: Math.round(percentile(all, 95)),
      maxMs: Math.round(all.at(-1) ?? 0),
      slowest: perOperation.sort((a, b) => b.p95Ms - a.p95Ms).slice(0, 10),
    };
  }
}

export type AlertKind =
  | 'slow'
  | 'errors'
  | 'queue-failed'
  | 'queue-stuck'
  | 'db-pool'
  | 'db-down'
  | 'redis-down';

export type AlertLimits = {
  p95Ms: number;
  errorRate: number;
  /** Abaixo disso a taxa de erro não alerta (3 erros em 5 requests não é incidente) */
  minRequests: number;
  queueStuckSec: number;
};

export function alertLimits(env: NodeJS.ProcessEnv): AlertLimits {
  const num = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    p95Ms: num(env.ALERT_P95_MS, 1000),
    errorRate: num(env.ALERT_ERROR_RATE, 0.02),
    minRequests: num(env.ALERT_MIN_REQUESTS, 50),
    queueStuckSec: num(env.ALERT_QUEUE_STUCK_SEC, 600),
  };
}

/**
 * O que está fora do normal neste minuto. `failedBefore` é o total de jobs
 * com falha no minuto anterior, por fila: alerta quando cresce (falha nova),
 * não pelo histórico guardado.
 */
export function checkAlerts(
  s: MetricsSnapshot,
  limits: AlertLimits,
  failedBefore: Map<string, number>,
): { kind: AlertKind; message: string }[] {
  const out: { kind: AlertKind; message: string }[] = [];
  const r = s.requests;
  if (r.requests >= limits.minRequests && r.p95Ms > limits.p95Ms) {
    const worst = r.slowest[0];
    out.push({
      kind: 'slow',
      message: `p95 de ${r.p95Ms} ms em ${r.requests} requests (limite ${limits.p95Ms} ms)${
        worst ? `; mais lenta: ${worst.operation} (${worst.p95Ms} ms)` : ''
      }`,
    });
  }
  if (r.requests >= limits.minRequests && r.errorRate > limits.errorRate) {
    out.push({
      kind: 'errors',
      message: `${(r.errorRate * 100).toFixed(1)}% de erro (${r.errors}/${r.requests}; limite ${
        limits.errorRate * 100
      }%)`,
    });
  }
  for (const q of s.queues) {
    const before = failedBefore.get(q.name);
    if (before != null && q.failed > before) {
      out.push({
        kind: 'queue-failed',
        message: `Fila ${q.name}: ${q.failed - before} job(s) falharam de vez`,
      });
    }
    if (q.oldestWaitingSec > limits.queueStuckSec) {
      out.push({
        kind: 'queue-stuck',
        message: `Fila ${q.name}: job esperando há ${Math.round(q.oldestWaitingSec / 60)} min (${
          q.waiting
        } na fila)`,
      });
    }
  }
  if (!s.db.ok) out.push({ kind: 'db-down', message: 'Postgres não respondeu ao ping' });
  else if ((s.db.poolWaiting ?? 0) > 0) {
    out.push({
      kind: 'db-pool',
      message: `${s.db.poolWaiting} consulta(s) esperando conexão do pool do Prisma`,
    });
  }
  if (!s.redis.ok) out.push({ kind: 'redis-down', message: 'Redis não respondeu ao ping' });
  return out;
}
