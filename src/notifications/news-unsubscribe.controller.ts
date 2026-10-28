import { Controller, Get, Header, HttpCode, Post, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { verifyNewsUnsubscribeToken } from './news-unsubscribe';

const page = (body: string) =>
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Barbershop</title></head><body style="font-family:sans-serif;max-width:480px;margin:48px auto;padding:0 16px;line-height:1.5">${body}</body></html>`;

/**
 * Sair dos e-mails de novidades da plataforma (item 487). GET só mostra a
 * confirmação (leitores de e-mail abrem links sozinhos); o POST desliga —
 * é o que o botão da página e o "cancelar inscrição" do Gmail/Yahoo fazem.
 */
@ApiExcludeController()
@Controller('notifications')
export class NewsUnsubscribeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('unsubscribe-news')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  confirm(@Query('t') token: string) {
    if (verifyNewsUnsubscribeToken(token) == null) {
      return page('<p>Este link não é válido.</p>');
    }
    const action = `?t=${encodeURIComponent(token)}`;
    return page(
      `<p>Parar de receber os e-mails de novidades do Barbershop?</p><form method="post" action="${action}"><button type="submit" style="padding:10px 18px">Sim, parar de receber</button></form><p style="color:#666;font-size:14px">Avisos de segurança e da sua conta continuam chegando.</p>`,
    );
  }

  @Post('unsubscribe-news')
  @HttpCode(200)
  @Header('Content-Type', 'text/html; charset=utf-8')
  async unsubscribe(@Query('t') token: string) {
    const userId = verifyNewsUnsubscribeToken(token);
    if (userId == null) return page('<p>Este link não é válido.</p>');
    await this.prisma.notificationPreference.updateMany({
      where: { userId },
      data: { newsEmail: false },
    });
    return page(
      '<p>Pronto: você não recebe mais os e-mails de novidades. Dá para ligar de novo nas preferências da sua conta.</p>',
    );
  }
}
