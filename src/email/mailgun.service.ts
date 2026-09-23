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
    this.domain = this.config.get<string>('MAILGUN_DOMAIN');
    if (!this.domain) {
      throw new Error('MAILGUN_DOMAIN is required in environment variables');
    }

    const mailgun = new Mailgun(FormData);
    this.client = mailgun.client({ username, key: apiKey, url: 'https://api.mailgun.net' });
  }

  async send(options: {
    from: string;
    to: string[] | string;
    subject: string;
    text?: string;
    html?: string;
  }) {
    try {
      const data = await this.client.messages.create(this.domain, options);
      // Só o id/status — o corpo do e-mail tem links de redefinição de senha e códigos
      this.logger.log(`Mailgun: ${data.status ?? ''} ${data.id ?? ''}`.trim());
      return data;
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }
}
