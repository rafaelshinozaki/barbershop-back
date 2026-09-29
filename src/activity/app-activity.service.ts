import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { APP_ACTIVITY_QUEUE } from '../queue/queue.constants';
import { withEnqueueTimeout } from '../queue/notification-queue.service';
import { axiomConfig, type AppActivityEvent, type AxiomConfig } from './app-activity';

/** Eventos por envio ao Axiom */
export const ACTIVITY_BATCH = 200;
const ACTIVITY_FLUSH_MS = 5_000;
const ENQUEUE_TIMEOUT_MS = 2_000;

type ActivityJob = { events: AppActivityEvent[] };

/**
 * Junta os eventos da trilha na memória e, a cada 5 s (ou 200 eventos),
 * põe um job na fila com o lote. O request nunca espera: com o Redis fora,
 * o lote se perde (vai pro log) e a ação da pessoa segue.
 */
@Injectable()
export class AppActivityService implements OnModuleDestroy {
  private readonly logger = new Logger(AppActivityService.name);
  readonly config: AxiomConfig | undefined = axiomConfig(process.env);
  private pending: AppActivityEvent[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(@InjectQueue(APP_ACTIVITY_QUEUE) private readonly queue: Queue<ActivityJob>) {}

  get enabled() {
    return !!this.config;
  }

  record(event: AppActivityEvent) {
    if (!this.enabled) return;
    this.pending.push(event);
    if (this.pending.length >= ACTIVITY_BATCH) {
      void this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), ACTIVITY_FLUSH_MS);
      this.timer.unref?.();
    }
  }

  async flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const events = this.pending.splice(0);
    if (!events.length) return;
    try {
      await withEnqueueTimeout(this.queue.add('batch', { events }), ENQUEUE_TIMEOUT_MS, () =>
        this.logger.warn(`Fila lenta (Redis fora?): ${events.length} evento(s) da trilha depois`),
      );
    } catch (err) {
      this.logger.warn(`${events.length} evento(s) da trilha perdidos: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy() {
    await this.flush();
  }
}

/** Manda o lote pro Axiom; erro faz o BullMQ tentar de novo (5 vezes, espera crescente) */
@Processor(APP_ACTIVITY_QUEUE)
export class AppActivityProcessor extends WorkerHost {
  private readonly config = axiomConfig(process.env);

  async process(job: Job<ActivityJob>) {
    if (!this.config) return 0;
    const { url, dataset, token } = this.config;
    const res = await fetch(`${url}/v1/datasets/${encodeURIComponent(dataset)}/ingest`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(job.data.events),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Axiom respondeu ${res.status}`);
    return job.data.events.length;
  }
}
