import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EMAIL_QUEUE, WHATSAPP_QUEUE } from './queue.constants';
import type { EmailJob, WhatsappJob } from './notification-jobs';

const BULK_CHUNK = 500;
/** Quanto a requisição espera a fila antes de seguir sem ela */
export const ENQUEUE_TIMEOUT_MS = 2_000;

/**
 * Espera o `add` da fila no máximo `ms`. Com o Redis fora, o BullMQ segura o
 * comando até a conexão voltar; a requisição não pode ficar parada por isso.
 * Passado o tempo, segue (o comando continua na fila do cliente Redis e o
 * envio sai quando o Redis voltar); erro de verdade continua subindo.
 */
export async function withEnqueueTimeout<T>(
  work: Promise<T>,
  ms: number,
  onTimeout: () => void,
): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      onTimeout();
      resolve(undefined);
    }, ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Coloca envios de e-mail/WhatsApp na fila em vez de mandar dentro da
 * requisição. Os workers (EmailProcessor/WhatsappProcessor) enviam com
 * limite de taxa por provedor e tentam de novo em caso de falha.
 *
 * `jobId` opcional evita duplicar o mesmo envio (ex.: lembrete do mesmo
 * agendamento enfileirado por duas execuções) — o BullMQ ignora um add com
 * jobId que já existe.
 */
@Injectable()
export class NotificationQueueService {
  private readonly logger = new Logger(NotificationQueueService.name);

  constructor(
    @InjectQueue(EMAIL_QUEUE) private readonly emailQueue: Queue<EmailJob>,
    @InjectQueue(WHATSAPP_QUEUE) private readonly whatsappQueue: Queue<WhatsappJob>,
  ) {}

  async email(job: EmailJob, jobId?: string) {
    await withEnqueueTimeout(
      this.emailQueue.add(job.template, job, jobId ? { jobId } : undefined),
      ENQUEUE_TIMEOUT_MS,
      () => this.logger.warn(`Fila lenta (Redis fora?): e-mail ${job.template} segue depois`),
    );
  }

  async whatsapp(job: WhatsappJob, jobId?: string) {
    await withEnqueueTimeout(
      this.whatsappQueue.add(job.kind, job, jobId ? { jobId } : undefined),
      ENQUEUE_TIMEOUT_MS,
      () => this.logger.warn(`Fila lenta (Redis fora?): WhatsApp ${job.kind} segue depois`),
    );
  }

  /** Muitos envios de uma vez (campanha), em lotes pra não montar um comando gigante no Redis. */
  async emailBulk(jobs: EmailJob[]) {
    for (let i = 0; i < jobs.length; i += BULK_CHUNK) {
      await this.emailQueue.addBulk(
        jobs.slice(i, i + BULK_CHUNK).map((data) => ({ name: data.template, data })),
      );
    }
  }

  async whatsappBulk(jobs: WhatsappJob[]) {
    for (let i = 0; i < jobs.length; i += BULK_CHUNK) {
      await this.whatsappQueue.addBulk(
        jobs.slice(i, i + BULK_CHUNK).map((data) => ({ name: data.kind, data })),
      );
    }
  }
}
