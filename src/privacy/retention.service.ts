import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { DATA_RETENTION_QUEUE } from '../queue/queue.constants';
import { registerSchedulers } from '../queue/register-schedulers';
import { RETENTION_DAYS, cutoffBefore, deleteInBatches } from './retention-policy';

const BATCH = 1000;

/**
 * Uma vez por dia, apaga dado pessoal cujo propósito já acabou. Não toca em
 * pagamento, venda, caixinha nem assinatura: isso fica pelo prazo fiscal.
 * Chat e nota de conduta entram aqui quando essas tabelas existirem, com os
 * prazos de RETENTION_DAYS.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(now = new Date()) {
    const emailBefore = cutoffBefore(now, RETENTION_DAYS.emailCopy);
    const loginBefore = cutoffBefore(now, RETENTION_DAYS.loginHistory);
    const notificationBefore = cutoffBefore(now, RETENTION_DAYS.notification);

    const emailCopies = await deleteInBatches(
      (take) =>
        this.prisma.emailLogger.findMany({
          where: { createdAt: { lt: emailBefore } },
          select: { id: true },
          orderBy: { id: 'asc' },
          take,
        }),
      async (ids) => (await this.prisma.emailLogger.deleteMany({ where: { id: { in: ids } } })).count,
      BATCH,
    );
    const loginHistory = await deleteInBatches(
      (take) =>
        this.prisma.loginHistory.findMany({
          where: { createdAt: { lt: loginBefore } },
          select: { id: true },
          orderBy: { id: 'asc' },
          take,
        }),
      async (ids) =>
        (await this.prisma.loginHistory.deleteMany({ where: { id: { in: ids } } })).count,
      BATCH,
    );
    const notifications = await deleteInBatches(
      (take) =>
        this.prisma.userNotification.findMany({
          where: { createdAt: { lt: notificationBefore } },
          select: { id: true },
          orderBy: { id: 'asc' },
          take,
        }),
      async (ids) =>
        (await this.prisma.userNotification.deleteMany({ where: { id: { in: ids } } })).count,
      BATCH,
    );
    const verificationCodes = await deleteInBatches(
      (take) =>
        this.prisma.verificationCode.findMany({
              where: { OR: [{ expiresAt: { lt: now } }, { used: true }] },
          select: { id: true },
          orderBy: { id: 'asc' },
          take,
        }),
      async (ids) =>
        (await this.prisma.verificationCode.deleteMany({ where: { id: { in: ids } } })).count,
      BATCH,
    );
    const passwordResetTokens = await deleteInBatches(
      (take) =>
        this.prisma.passwordResetToken.findMany({
          where: { OR: [{ expiresAt: { lt: now } }, { used: true }] },
          select: { id: true },
          orderBy: { id: 'asc' },
          take,
        }),
      async (ids) =>
        (await this.prisma.passwordResetToken.deleteMany({ where: { id: { in: ids } } })).count,
      BATCH,
    );

    const result = {
      emailCopies,
      loginHistory,
      notifications,
      verificationCodes,
      passwordResetTokens,
    };
    this.logger.log(`Guarda cumprida: ${JSON.stringify(result)}`);
    return result;
  }
}

@Injectable()
export class RetentionScheduler implements OnModuleInit {
  constructor(@InjectQueue(DATA_RETENTION_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    registerSchedulers(this.queue, [
      { id: 'enforce-retention', repeat: { pattern: '0 15 3 * * *', tz: 'America/Sao_Paulo' } },
    ]);
  }
}

@Processor(DATA_RETENTION_QUEUE)
export class RetentionProcessor extends WorkerHost {
  constructor(private readonly retention: RetentionService) {
    super();
  }

  async process(job: Job) {
    if (job.name === 'enforce-retention') return this.retention.run();
  }
}
