import { Controller, HttpCode, Post, Query } from '@nestjs/common';
import { BarbershopService } from './barbershop.service';

/**
 * Descadastro com um clique (RFC 8058): o Gmail/Yahoo fazem POST aqui quando
 * a pessoa clica em "cancelar inscrição" no próprio cliente de e-mail. Sem
 * login — o token assinado identifica o cliente.
 */
@Controller('marketing')
export class MarketingUnsubscribeController {
  constructor(private readonly barbershopService: BarbershopService) {}

  @Post('unsubscribe')
  @HttpCode(200)
  // Sem o limite estrito de login: os pedidos vêm dos servidores do Gmail/
  // Yahoo (muitos clientes pelo mesmo IP). O token assinado não dá pra chutar.
  async unsubscribe(@Query('t') token: string) {
    await this.barbershopService.unsubscribeFromMarketing(token);
    return { unsubscribed: true };
  }
}
