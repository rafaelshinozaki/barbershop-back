import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
import { hostname } from 'os';
import { monitorEventLoopDelay, type IntervalHistogram } from 'perf_hooks';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { BackupService } from '../backup/backup.service';
import { axiomConfig } from '../activity/app-activity';
import * as Q from '../queue/queue.constants';
import {
  alertLimits,
  checkAlerts,
  RequestRecorder,
  type AlertKind,
  type MetricsSnapshot,
  type QueueStats,
} from './metrics';

const INTERVAL_MS = 60_000;
/** O mesmo alerta não repete antes disso (Sentry agrupa, mas não precisa de 1 por minuto) */
const ALERT_COOLDOWN_MS = 15 * 60_000;

const QUEUES = Object.entries(Q)
  .filter(([key, value]) => key.endsWith('_QUEUE') && typeof value === 'string')
  .map(([, value]) => value as string);

const round = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;

/**
 * Métricas a cada 60 s (horizonte "Registros e estabilidade", R4):
 * requisições/erros/p95 por operação, pool do Prisma, Redis, filas do
 * BullMQ, memória, CPU e atraso do event loop. Vão pro Axiom (um evento por
 * minuto por instância, type=metrics, no AXIOM_METRICS_DATASET ou no
 * AXIOM_DATASET) e passam pelos limites dos alertas: o que estourar vira
 * aviso no Sentry (sem SENTRY_DSN, só no log). O último minuto fica na
 * memória pra tela Saúde do sistema.
 */
@Injectable()
export class MetricsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MetricsService.name);
  readonly recorder = new RequestRecorder();
  private readonly instance = `${hostname()}:${process.pid}`;
  private readonly axiom = axiomConfig(process.env);
  private readonly dataset = process.env.AXIOM_METRICS_DATASET?.trim() || this.axiom?.dataset;
  private readonly limits = alertLimits(process.env);
  private timer?: NodeJS.Timeout;
  private loop?: IntervalHistogram;
  private lastCpu = process.cpuUsage();
  private lastAt = Date.now();
  private failedBefore = new Map<string, number>();
  private alertedAt = new Map<AlertKind, number>();
  private last: MetricsSnapshot | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly moduleRef: ModuleRef,
    private readonly backups: BackupService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.METRICS_DISABLED === 'true' || process.env.NODE_ENV === 'test') return;
    this.loop = monitorEventLoopDelay({ resolution: 20 });
    this.loop.enable();
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.loop?.disable();
  }

  /** Último minuto fechado (tela Saúde do sistema) */
  latest(): MetricsSnapshot | null {
    return this.last;
  }

  async tick(now = new Date()): Promise<MetricsSnapshot> {
    const snapshot = await this.collect(now);
    this.last = snapshot;
    await this.ship(snapshot);
    this.alert(snapshot, now.getTime());
    this.failedBefore = new Map(snapshot.queues.map((q) => [q.name, q.failed]));
    return snapshot;
  }

  async collect(now = new Date()): Promise<MetricsSnapshot> {
    const elapsedMs = Math.max(now.getTime() - this.lastAt, 1);
    const cpu = process.cpuUsage(this.lastCpu);
    this.lastCpu = process.cpuUsage();
    this.lastAt = now.getTime();
    const mem = process.memoryUsage();
    const lagP99 = this.loop ? this.loop.percentile(99) / 1e6 : 0;
    this.loop?.reset();
    const [db, redis, queues, backup] = await Promise.all([
      this.dbStats(),
      this.redisStats(),
      this.queueStats(now),
      this.backupStats(now),
    ]);
    return {
      _time: now.toISOString(),
      type: 'metrics',
      instance: this.instance,
      intervalSec: Math.round(elapsedMs / 1000),
      requests: this.recorder.flush(),
      memory: { rssMb: round(mem.rss / 1048576), heapUsedMb: round(mem.heapUsed / 1048576) },
      cpuPercent: round(((cpu.user + cpu.system) / 1000 / elapsedMs) * 100),
      eventLoopLagP99Ms: round(lagP99),
      db,
      redis,
      queues,
      backup,
    };
  }

  private async backupStats(now: Date): Promise<MetricsSnapshot['backup']> {
    if (!this.backups.config.enabled) return null;
    try {
      const s = await this.backups.status(now);
      return { lastAt: s.lastAt?.toISOString() ?? null, ageHours: s.ageHours, stale: s.stale };
    } catch (err) {
      // S3 fora ou sem permissão de listar: não dá pra saber; avisa no log
      this.logger.warn(`Status do backup indisponível: ${(err as Error).message}`);
      return null;
    }
  }

  private async dbStats(): Promise<MetricsSnapshot['db']> {
    const started = Date.now();
    let ok = true;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      ok = false;
    }
    const pingMs = Date.now() - started;
    let poolBusy: number | null = null;
    let poolIdle: number | null = null;
    let poolWaiting: number | null = null;
    try {
      const { gauges } = await this.prisma.$metrics.json();
      const gauge = (key: string) => gauges.find((g) => g.key === key)?.value ?? null;
      poolBusy = gauge('prisma_pool_connections_busy');
      poolIdle = gauge('prisma_pool_connections_idle');
      poolWaiting = gauge('prisma_client_queries_wait');
    } catch {
      // Métricas do Prisma indisponíveis: fica só o ping
    }
    return { ok, pingMs, poolBusy, poolIdle, poolWaiting };
  }

  private async redisStats(): Promise<MetricsSnapshot['redis']> {
    const started = Date.now();
    try {
      await Promise.race([
        this.redis.client.ping(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000).unref()),
      ]);
      return { ok: true, pingMs: Date.now() - started };
    } catch {
      return { ok: false, pingMs: Date.now() - started };
    }
  }

  private async queueStats(now: Date): Promise<QueueStats[]> {
    const out: QueueStats[] = [];
    for (const name of QUEUES) {
      let queue: Queue | undefined;
      try {
        queue = this.moduleRef.get<Queue>(getQueueToken(name), { strict: false });
      } catch {
        continue; // fila não registrada nesta instância
      }
      try {
        const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
        const [oldest] = counts.waiting ? await queue.getWaiting(0, 0) : [];
        out.push({
          name,
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          delayed: counts.delayed ?? 0,
          failed: counts.failed ?? 0,
          oldestWaitingSec: oldest
            ? Math.max(0, Math.round((now.getTime() - oldest.timestamp) / 1000))
            : 0,
        });
      } catch {
        // Redis fora: o redisStats já conta
      }
    }
    return out;
  }

  private async ship(snapshot: MetricsSnapshot) {
    if (!this.axiom || !this.dataset) return;
    try {
      const res = await fetch(
        `${this.axiom.url}/v1/datasets/${encodeURIComponent(this.dataset)}/ingest`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.axiom.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify([snapshot]),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!res.ok) this.logger.warn(`Métricas não enviadas ao Axiom (${res.status})`);
    } catch (err) {
      this.logger.warn(`Métricas não enviadas ao Axiom: ${(err as Error).message}`);
    }
  }

  private alert(snapshot: MetricsSnapshot, nowMs: number) {
    for (const { kind, message } of checkAlerts(snapshot, this.limits, this.failedBefore)) {
      const last = this.alertedAt.get(kind) ?? 0;
      if (nowMs - last < ALERT_COOLDOWN_MS) continue;
      this.alertedAt.set(kind, nowMs);
      this.logger.warn(`[alerta ${kind}] ${message}`);
      if (Sentry.getClient()) {
        Sentry.withScope((scope) => {
          scope.setTag('alert', kind);
          scope.setTag('instance', snapshot.instance);
          scope.setFingerprint(['metrics-alert', kind]);
          scope.setExtra('snapshot', {
            requests: snapshot.requests,
            db: snapshot.db,
            redis: snapshot.redis,
          });
          Sentry.captureMessage(`Alerta: ${message}`, 'warning');
        });
      }
    }
  }
}
