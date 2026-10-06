import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { EmailService } from '../email/email.service';
import { BACKOFFICE_COMMANDS_QUEUE } from '../queue/queue.constants';
import { SupportService } from '../support/support.service';
import { ClientSuspensionService } from '../client-auth/client-suspension.service';
import { SearchCacheService } from '../barbershop/search-cache.service';
import { PricingService } from '../pricing/pricing.service';
import { RealtimeService } from '../realtime/realtime.service';
import { BackofficeService } from '../backoffice/backoffice.service';
import {
  ADMIN_NOTIFICATION_EMAIL,
  CLIENT_SUSPENDED_EMAIL,
  EMAIL_SEND,
  NOTIFICATIONS_CREATED,
  parseAdminNotificationEmail,
  parseClientSuspendedEmail,
  parseEmailSend,
  parseNotificationsCreated,
  parseSupportReplyEmail,
  PRICING_RELOAD,
  SEARCH_CACHE_BUMP,
  SUPPORT_REPLY_EMAIL,
} from './commands';

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'suporte@barbershop.com.br';

/**
 * Executa os comandos da API do backoffice (ver commands.ts): e-mail de
 * template permitido (email.send) e os avisos que dependem de regra daqui
 * (resposta do suporte com o link assinado, suspensão de conta de cliente,
 * cache da busca depois do Destaque, preços relidos depois de salvos, avisos
 * em tempo real e o e-mail da equipe pra contas do app).
 */
@Processor(BACKOFFICE_COMMANDS_QUEUE, { concurrency: 5 })
export class BackofficeCommandsProcessor extends WorkerHost {
  private readonly logger = new Logger(BackofficeCommandsProcessor.name);

  constructor(
    private readonly email: EmailService,
    private readonly support: SupportService,
    private readonly suspension: ClientSuspensionService,
    private readonly searchCache: SearchCacheService,
    private readonly pricing: PricingService,
    private readonly realtime: RealtimeService,
    private readonly backoffice: BackofficeService,
  ) {
    super();
  }

  async process(job: Job) {
    if (job.name === SUPPORT_REPLY_EMAIL) {
      const cmd = parseSupportReplyEmail(job.data);
      await this.support.emailReply(cmd.ticketId, cmd.reply);
      return;
    }
    if (job.name === CLIENT_SUSPENDED_EMAIL) {
      const cmd = parseClientSuspendedEmail(job.data);
      await this.suspension.emailSuspended(cmd.clientAccountId);
      return;
    }
    if (job.name === PRICING_RELOAD) {
      await this.pricing.reload();
      return;
    }
    if (job.name === NOTIFICATIONS_CREATED) {
      const cmd = parseNotificationsCreated(job.data);
      this.realtime.notifyUsers(cmd.userIds, 'CREATED', cmd.title);
      return;
    }
    if (job.name === ADMIN_NOTIFICATION_EMAIL) {
      const cmd = parseAdminNotificationEmail(job.data);
      await this.backoffice.sendEmailNotification(cmd);
      this.logger.log(`${ADMIN_NOTIFICATION_EMAIL} para ${cmd.userIds.length} pessoas`);
      return;
    }
    if (job.name === SEARCH_CACHE_BUMP) {
      await this.searchCache.bump();
      return;
    }
    if (job.name !== EMAIL_SEND) throw new Error(`Comando desconhecido: ${job.name}`);
    const cmd = parseEmailSend(job.data);
    await this.email.sendCustomerEmail(
      null,
      cmd.template,
      {
        AppName: 'Barbershop',
        SupportEmail: SUPPORT_EMAIL,
        Year: new Date().getFullYear(),
        ...cmd.context,
      },
      cmd.subject,
      `backoffice:${cmd.template}`,
      cmd.to,
      cmd.lang,
    );
    this.logger.log(`email.send ${cmd.template} enviado`);
  }
}
