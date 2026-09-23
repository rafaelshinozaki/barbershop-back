import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EMAIL_QUEUE, WHATSAPP_QUEUE } from './queue.constants';
import type { EmailJob, WhatsappJob } from './notification-jobs';

const BULK_CHUNK = 500;

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
  constructor(
    @InjectQueue(EMAIL_QUEUE) private readonly emailQueue: Queue<EmailJob>,
    @InjectQueue(WHATSAPP_QUEUE) private readonly whatsappQueue: Queue<WhatsappJob>,
  ) {}

  async email(job: EmailJob, jobId?: string) {
    await this.emailQueue.add(job.template, job, jobId ? { jobId } : undefined);
  }

  async whatsapp(job: WhatsappJob, jobId?: string) {
    await this.whatsappQueue.add(job.kind, job, jobId ? { jobId } : undefined);
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
