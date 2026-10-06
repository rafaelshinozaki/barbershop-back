import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { EmailService } from '../email/email.service';
import { BACKOFFICE_COMMANDS_QUEUE } from '../queue/queue.constants';
import { EMAIL_SEND, parseEmailSend } from './commands';

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'suporte@barbershop.com.br';

/**
 * Executa os comandos da API do backoffice (ver commands.ts). Hoje só
 * email.send: o e-mail sai pelo mesmo envio do app, com o template daqui.
 */
@Processor(BACKOFFICE_COMMANDS_QUEUE, { concurrency: 5 })
export class BackofficeCommandsProcessor extends WorkerHost {
  private readonly logger = new Logger(BackofficeCommandsProcessor.name);

  constructor(private readonly email: EmailService) {
    super();
  }

  async process(job: Job) {
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
