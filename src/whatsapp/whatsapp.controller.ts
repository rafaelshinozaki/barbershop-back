import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';
import { inboundWhatsappTexts } from './marketing-text';
import { WhatsappOptOutService } from './whatsapp-opt-out.service';

@Controller('whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly optOut: WhatsappOptOutService,
  ) {}

  /** A Meta confirma o endereço do webhook devolvendo o desafio. */
  @Get('webhook')
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const expected = this.config.get<string>('WHATSAPP_WEBHOOK_VERIFY_TOKEN');
    if (mode === 'subscribe' && expected && token === expected && challenge) {
      return res.status(200).type('text/plain').send(challenge);
    }
    return res.status(403).send('forbidden');
  }

  @Post('webhook')
  @HttpCode(200)
  async receive(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-hub-signature-256') signature: string | undefined,
  ) {
    const secret =
      this.config.get<string>('WHATSAPP_APP_SECRET') ||
      this.config.get<string>('META_APP_SECRET');
    if (!secret || !this.signatureOk(req.rawBody, signature, secret)) {
      throw new ForbiddenException('Assinatura do WhatsApp inválida');
    }
    let stopped = 0;
    for (const message of inboundWhatsappTexts(req.body)) {
      stopped += await this.optOut.optOutFromReply(message.from, message.text);
    }
    if (stopped) this.logger.log(`Descadastro por WhatsApp: ${stopped} ficha(s)`);
    return { received: true };
  }

  private signatureOk(raw: Buffer | undefined, header: string | undefined, secret: string) {
    if (!raw || !header?.startsWith('sha256=')) return false;
    const digest = createHmac('sha256', secret).update(raw).digest('hex');
    const given = Buffer.from(header.slice('sha256='.length));
    const expected = Buffer.from(digest);
    if (given.length !== expected.length) return false;
    return timingSafeEqual(given, expected);
  }
}
