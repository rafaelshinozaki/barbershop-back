// src/email/email.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailNotSentException } from '@/common/errors';
import { MailgunService } from './mailgun.service';
import * as path from 'path';
import * as fs from 'fs/promises';
import Handlebars from 'handlebars';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly mailgun: MailgunService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async sendTemplateEmail(
    userId: number,
    template: string, // ex: 'welcome_email'
    context: Record<string, any>, // ex: { FullName, AppName, … }
    subject: string, // ex: 'Bem-vindo ao Barbershop'
    meta: string, // string genérica só para log
    to: string, // ex: 'rafaelsinosak@gmail.com'
  ) {
    this.logger.log(`Enviando email (${template}) para [${to}]`);

    try {
      const user = await this.prisma.user.findFirst({
        where: { id: userId },
        select: { userSystemConfig: { select: { language: true } } },
      });
      const lang = user?.userSystemConfig?.language?.toLowerCase() || 'pt';

      let templatePath = path.join(__dirname, 'templates', lang, `${template}.hbs`);
      try {
        await fs.access(templatePath);
      } catch {
        templatePath = path.join(__dirname, 'templates', `${template}.hbs`);
      }
      const source = await fs.readFile(templatePath, 'utf8');
      const html = Handlebars.compile(source)(context);

      const from = this.config.get<string>('EMAIL_FROM') || 'noreply@yourdomain.com';

      const emailResponse = await this.mailgun.send({
        from: `Barbershop <${from}>`,
        to,
        subject,
        html,
      });

      await this.prisma.emailLogger.create({
        data: {
          userId,
          body: JSON.stringify(context),
          sentTo: to,
          subject,
          meta: `[${meta}] -> ${JSON.stringify(emailResponse)}`,
        },
      });

      this.logger.log(JSON.stringify(emailResponse));
      return 'Email sent successfully';
    } catch (error) {
      this.logger.error(error);
      throw new EmailNotSentException(error);
    }
  }
}
