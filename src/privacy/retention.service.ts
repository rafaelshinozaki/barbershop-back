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
 * O chat sai 12 meses depois da última mensagem da conversa (salvo denúncia
 * ou disputa aberta, que segura o texto até retainUntil).
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(now = new Date()) {
    const emailBefore = cutoffBefore(now, RETENTION_DAYS.emailCopy);
    const loginBefore = cutoffBefore(now, RETENTION_DAYS.loginHistory);
    const notificationBefore = cutoffBefore(now, RETENTION_DAYS.notification);
    const conductBefore = cutoffBefore(now, RETENTION_DAYS.clientConductNote);
    const chatBefore = cutoffBefore(now, RETENTION_DAYS.chatText);
    const supportBefore = cutoffBefore(now, RETENTION_DAYS.supportTicket);
    const pushBefore = cutoffBefore(now, RETENTION_DAYS.pushSubscription);
    const searchBefore = cutoffBefore(now, RETENTION_DAYS.searchEvent);
    const auditBefore = cutoffBefore(now, RETENTION_DAYS.backofficeAudit);

    const emailCopies = await deleteInBatches(
      (take) =>
        this.prisma.emailLogger.findMany({
          where: { createdAt: { lt: emailBefore } },
          select: { id: true },
          orderBy: { id: 'asc' },
          take,
        }),
      async (ids) =>
        (
          await this.prisma.emailLogger.deleteMany({ where: { id: { in: ids } } })
        ).count,
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
        (
          await this.prisma.loginHistory.deleteMany({ where: { id: { in: ids } } })
        ).count,
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
        (
          await this.prisma.userNotification.deleteMany({ where: { id: { in: ids } } })
        ).count,
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
        (
          await this.prisma.verificationCode.deleteMany({ where: { id: { in: ids } } })
        ).count,
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
        (
          await this.prisma.passwordResetToken.deleteMany({ where: { id: { in: ids } } })
        ).count,
      BATCH,
    );

    // Nota de conduta do cliente: sai quando a relação acaba (2 anos sem
    // atendimento novo daquela ficha)
    const clientConductNotes = await deleteInBatches(
      (take) =>
        this.prisma.customerRating.findMany({
          where: {
            createdAt: { lt: conductBefore },
            customer: { appointments: { none: { startAt: { gte: conductBefore } } } },
          },
          select: { id: true },
          orderBy: { id: 'asc' },
          take,
        }),
      async (ids) =>
        (
          await this.prisma.customerRating.deleteMany({ where: { id: { in: ids } } })
        ).count,
      BATCH,
    );

    // Chat: a conversa inteira sai (mensagens junto, em cascata) 12 meses
    // depois da última mensagem, salvo se estiver segurada
    const chatThreads = await deleteInBatches(
      (take) =>
        this.prisma.chatThread.findMany({
          where: {
            lastMessageAt: { lt: chatBefore },
            OR: [{ retainUntil: null }, { retainUntil: { lt: now } }],
          },
          select: { id: true },
          orderBy: { id: 'asc' },
          take,
        }),
      async (ids) =>
        (
          await this.prisma.chatThread.deleteMany({ where: { id: { in: ids } } })
        ).count,
      BATCH,
    );

    // Suporte: o pedido inteiro sai 24 meses depois da última atividade
    const supportTickets = await deleteInBatches(
      (take) =>
        this.prisma.supportTicket.findMany({
          where: { lastActivityAt: { lt: supportBefore } },
          select: { id: true },
          orderBy: { id: 'asc' },
          take,
        }),
      async (ids) =>
        (
          await this.prisma.supportTicket.deleteMany({ where: { id: { in: ids } } })
        ).count,
      BATCH,
    );

    // Aparelho que ninguém usa há 6 meses (trocou de celular, desinstalou)
    const pushSubscriptions = (
      await this.prisma.pushSubscription.deleteMany({ where: { lastUsedAt: { lt: pushBefore } } })
    ).count;

    // Buscas da métrica do piloto: um ano basta para comparar períodos
    const searchEvents = await deleteInBatches(
      (take) =>
        this.prisma.searchEvent.findMany({
          where: { createdAt: { lt: searchBefore } },
          select: { id: true },
          take,
        }),
      async (ids) =>
        (
          await this.prisma.searchEvent.deleteMany({ where: { id: { in: ids } } })
        ).count,
      BATCH,
    );

    // Registro de ações do backoffice: dois anos
    const backofficeAudit = await deleteInBatches(
      (take) =>
        this.prisma.backofficeAuditLog.findMany({
          where: { createdAt: { lt: auditBefore } },
          select: { id: true },
          take,
        }),
      async (ids) =>
        (
          await this.prisma.backofficeAuditLog.deleteMany({ where: { id: { in: ids } } })
        ).count,
      BATCH,
    );

    const result = {
      backofficeAudit,
      chatThreads,
      supportTickets,
      pushSubscriptions,
      searchEvents,
      emailCopies,
      loginHistory,
      notifications,
      verificationCodes,
      passwordResetTokens,
      clientConductNotes,
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
