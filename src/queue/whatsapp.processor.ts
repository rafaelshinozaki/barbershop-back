import { Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { PrismaService } from '../prisma/prisma.service';
import { WHATSAPP_QUEUE } from './queue.constants';
import type { WhatsappJob } from './notification-jobs';

// A Cloud API da Meta tem limite por número (começa em ~80 msg/s); padrão
// conservador, ajustável por WHATSAPP_RATE_PER_SECOND
const ratePerSecond = Number(process.env.WHATSAPP_RATE_PER_SECOND) || 20;

@Processor(WHATSAPP_QUEUE, {
  concurrency: 5,
  limiter: { max: ratePerSecond, duration: 1000 },
})
export class WhatsappProcessor extends WorkerHost {
  private readonly logger = new Logger(WhatsappProcessor.name);

  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<WhatsappJob>) {
    // Credencial removida depois de enfileirar: descarta sem retry
    if (!this.whatsappService.isConfigured()) return;
    const data = job.data;
    switch (data.kind) {
      case 'appointment-reminder':
        await this.whatsappService.sendAppointmentReminder(data.to, data.params);
        break;
      case 'waitlist-slot':
        await this.whatsappService.sendWaitlistSlotAvailable(data.to, data.params);
        break;
      case 'marketing':
        await this.whatsappService.sendMarketingBlast(data.to, data.message);
        if (data.campaignId) {
          await this.prisma.marketingCampaign.update({
            where: { id: data.campaignId },
            data: { whatsappSentCount: { increment: 1 } },
          });
        }
        break;
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<WhatsappJob> | undefined, error: Error) {
    if (!job) return;
    const finalAttempt = job.attemptsMade >= (job.opts.attempts ?? 1);
    this.logger.warn(
      `WhatsApp ${job.name} #${job.id} falhou (tentativa ${job.attemptsMade}): ${error.message}`,
    );
    if (finalAttempt && job.data.kind === 'marketing' && job.data.campaignId) {
      await this.prisma.marketingCampaign
        .update({
          where: { id: job.data.campaignId },
          data: { whatsappFailedCount: { increment: 1 } },
        })
        .catch(() => undefined);
    }
  }
}
