// src/email/email.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailNotSentException } from '@/common/errors';
import { MailgunService } from './mailgun.service';
import * as path from 'path';
import * as fs from 'fs/promises';
import Handlebars from 'handlebars';
import { ConfigService } from '@nestjs/config';
import { isLocalized, LOCALE, Lang, Localized, normalizeLang, pick } from './language';

// O log de e-mails guardava o contexto inteiro — inclusive o link de
// redefinição de senha (com o token) e códigos de verificação: quem lesse a
// tabela EmailLogger conseguia trocar a senha de qualquer usuário.
const SECRET_KEY = /url|link|token|code|password|senha/i;
function redactSecrets(context: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(context).map(([k, v]) => [k, SECRET_KEY.test(k) ? '[redacted]' : v]),
  );
}

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
    context: Record<string, any>, // ex: { FullName, AppName, … } — valores podem ser Localized
    subject: string | Localized, // ex: { pt: 'Bem-vindo', en: 'Welcome', es: 'Bienvenido' }
    meta: string, // string genérica só para log
    to: string, // ex: 'rafaelsinosak@gmail.com'
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId },
      select: { userSystemConfig: { select: { language: true } } },
    });
    const lang = normalizeLang(user?.userSystemConfig?.language);
    return this.renderAndSend(userId, template, context, subject, meta, to, lang);
  }

  /**
   * Igual a sendTemplateEmail, mas para destinatários sem conta de usuário
   * (ex.: cliente final recebendo lembrete de agendamento) — recebe o idioma
   * diretamente em vez de buscar em UserSystemConfig, e loga contra o
   * userId informado (normalmente o dono da barbearia) só para auditoria.
   */
  async sendCustomerEmail(
    loggedAgainstUserId: number,
    template: string,
    context: Record<string, any>,
    subject: string | Localized,
    meta: string,
    to: string,
    lang = 'pt',
  ) {
    return this.renderAndSend(
      loggedAgainstUserId,
      template,
      context,
      subject,
      meta,
      to,
      normalizeLang(lang),
    );
  }

  /**
   * Monta o e-mail no idioma do destinatário: template de
   * templates/<idioma> (cai no pt se não houver tradução — antes caía num
   * caminho inexistente e o envio falhava), assunto e valores Localized
   * escolhidos pelo idioma, e helpers de data/dinheiro no formato local.
   */
  async render(
    template: string,
    context: Record<string, any>,
    subject: string | Localized,
    lang: Lang,
  ): Promise<{ html: string; subject: string }> {
    let templatePath = path.join(__dirname, 'templates', lang, `${template}.hbs`);
    try {
      await fs.access(templatePath);
    } catch {
      this.logger.warn(`Template ${template} sem versão "${lang}" — usando pt`);
      templatePath = path.join(__dirname, 'templates', 'pt', `${template}.hbs`);
    }
    const source = await fs.readFile(templatePath, 'utf8');
    const localizedContext = Object.fromEntries(
      Object.entries(context).map(([k, v]) => [k, isLocalized(v) ? v[lang] : v]),
    );
    const locale = LOCALE[lang];
    const date = (value: unknown) => {
      if (value === undefined || value === null || value === '') return '';
      const d = value instanceof Date ? value : new Date(value as string);
      return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString(locale);
    };
    const money = (value: unknown, currency?: unknown) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value ?? '');
      const code = typeof currency === 'string' && currency ? currency.toUpperCase() : 'BRL';
      try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(n);
      } catch {
        return n.toFixed(2);
      }
    };
    const html = Handlebars.compile(source)(localizedContext, {
      helpers: { date, formatDate: date, money },
    });
    return { html, subject: pick(subject, lang) };
  }

  private async renderAndSend(
    userId: number,
    template: string,
    context: Record<string, any>,
    subjectIn: string | Localized,
    meta: string,
    to: string,
    lang: Lang,
  ) {
    this.logger.log(`Enviando email (${template}, ${lang}) para [${to}]`);

    try {
      const { html, subject } = await this.render(template, context, subjectIn, lang);

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
          body: JSON.stringify(redactSecrets(context)),
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
