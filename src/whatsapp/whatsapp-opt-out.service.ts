import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { whatsappSenderVariants } from '../common/phone.util';
import { marketingOptOutReply } from './marketing-text';
import { WhatsappService } from './whatsapp.service';

/** "SAIR" / "STOP" / "SALIR" tira o telefone das campanhas, em qualquer ficha. */
@Injectable()
export class WhatsappOptOutService {
  private readonly logger = new Logger(WhatsappOptOutService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly whatsapp?: WhatsappService,
  ) {}

  async optOutFromReply(from: string, text: string): Promise<number> {
    const reply = marketingOptOutReply(text);
    if (!reply) return 0;
    const variants = whatsappSenderVariants(from);
    if (!variants.length) return 0;
    const updated = await this.prisma.$executeRaw`
      UPDATE "Customer"
         SET "marketingOptOut" = true
       WHERE "deletedAt" IS NULL
         AND "phoneDigits" IN (${Prisma.join(variants)})
    `;
    if (updated > 0) {
      try {
        await this.whatsapp?.sendSessionText(from, reply);
      } catch (err) {
        this.logger.error('Não foi possível confirmar o descadastro no WhatsApp', err as Error);
      }
    }
    return updated;
  }
}
