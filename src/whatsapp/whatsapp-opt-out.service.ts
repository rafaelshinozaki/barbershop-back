import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { whatsappSenderVariants } from '../common/phone.util';
import { isMarketingOptOut } from './marketing-text';

/** "SAIR" / "STOP" / "SALIR" tira o telefone das campanhas, em qualquer ficha. */
@Injectable()
export class WhatsappOptOutService {
  constructor(private readonly prisma: PrismaService) {}

  async optOutFromReply(from: string, text: string): Promise<number> {
    if (!isMarketingOptOut(text)) return 0;
    const variants = whatsappSenderVariants(from);
    if (!variants.length) return 0;
    return this.prisma.$executeRaw`
      UPDATE "Customer"
         SET "marketingOptOut" = true
       WHERE "deletedAt" IS NULL
         AND regexp_replace(phone, '\\D', '', 'g') IN (${Prisma.join(variants)})
    `;
  }
}
