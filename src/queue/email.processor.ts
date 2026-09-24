import { Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { EMAIL_QUEUE } from './queue.constants';
import type { EmailJob } from './notification-jobs';

// Limite de taxa: EMAIL_RATE_PER_SECOND (padrão 10/s) vale pra fila toda,
// somando todas as instâncias — o BullMQ controla isso no Redis.
const ratePerSecond = Number(process.env.EMAIL_RATE_PER_SECOND) || 10;

@Processor(EMAIL_QUEUE, {
  concurrency: 5,
  limiter: { max: ratePerSecond, duration: 1000 },
})
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private readonly emailService: EmailService, private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<EmailJob>) {
    const data = job.data;
    if (data.kind === 'user') {
      await this.emailService.sendTemplateEmail(
        data.userId,
        data.template,
        data.context,
        data.subject,
        data.meta,
        data.to,
      );
    } else {
      await this.emailService.sendCustomerEmail(
        data.loggedAgainstUserId,
        data.template,
        data.context,
        data.subject,
        data.meta,
        data.to,
        data.lang,
        data.headers,
      );
      if (data.campaignId) {
        await this.prisma.marketingCampaign.update({
          where: { id: data.campaignId },
          data: { emailSentCount: { increment: 1 } },
        });
      }
    }
  }

  // Só conta como falha da campanha depois da última tentativa
  @OnWorkerEvent('failed')
  async onFailed(job: Job<EmailJob> | undefined, error: Error) {
    if (!job) return;
    const finalAttempt = job.attemptsMade >= (job.opts.attempts ?? 1);
    this.logger.warn(
      `E-mail ${job.name} #${job.id} falhou (tentativa ${job.attemptsMade}): ${error.message}`,
    );
    if (finalAttempt && job.data.kind === 'customer' && job.data.campaignId) {
      await this.prisma.marketingCampaign
        .update({
          where: { id: job.data.campaignId },
          data: { emailFailedCount: { increment: 1 } },
        })
        .catch(() => undefined);
    }
  }
}
