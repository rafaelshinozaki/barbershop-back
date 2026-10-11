import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Mailgun from 'mailgun.js';
import * as FormData from 'form-data';

@Injectable()
export class MailgunService {
  private readonly logger = new Logger(MailgunService.name);
  private readonly client;
  private readonly domain: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('MAILGUN_API_KEY');
    if (!apiKey) {
      throw new Error('MAILGUN_API_KEY is required in environment variables');
    }
    const username = 'api';
    const domain = this.config.get<string>('MAILGUN_DOMAIN');
    if (!domain) {
      throw new Error('MAILGUN_DOMAIN is required in environment variables');
    }
    this.domain = domain;

    // Domínio criado na região EU do Mailgun usa outro endereço da API
    const url = this.config.get<string>('MAILGUN_URL') || 'https://api.mailgun.net';
    const mailgun = new Mailgun(FormData);
    this.client = mailgun.client({ username, key: apiKey, url });
  }

  async send(options: {
    from: string;
    to: string[] | string;
    subject: string;
    text?: string;
    html?: string;
    headers?: Record<string, string>;
  }) {
    try {
      const { headers, ...message } = options;
      // Cabeçalhos customizados no Mailgun vão como "h:<Nome>"
      const extra = Object.fromEntries(
        Object.entries(headers ?? {}).map(([k, v]) => [`h:${k}`, v]),
      );
      const data = await this.client.messages.create(this.domain, {
        ...message,
        ...extra,
      } as never);
      // Só o id/status — o corpo do e-mail tem links de redefinição de senha e códigos
      this.logger.log(`Mailgun: ${data.status ?? ''} ${data.id ?? ''}`.trim());
      return data;
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }
}
