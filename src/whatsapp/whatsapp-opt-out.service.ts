import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { whatsappSenderVariants } from '../common/phone.util';
import { marketingOptInReply, marketingOptOutReply } from './marketing-text';
import { WhatsappService } from './whatsapp.service';

type Db = Pick<PrismaService, 'whatsappOptOut'>;

/**
 * Dos telefones (no formato de envio, "+55…"), os que saíram das campanhas
 * pelo WhatsApp (item 275).
 */
export async function whatsappOptedOut(db: Db, phones: string[]): Promise<Set<string>> {
  const digits = [...new Set(phones.map((p) => p.replace(/\D/g, '')).filter(Boolean))];
  if (!digits.length) return new Set();
  const rows = await db.whatsappOptOut.findMany({
    where: { phoneDigits: { in: digits } },
    select: { phoneDigits: true },
  });
  const out = new Set(rows.map((r) => r.phoneDigits));
  return new Set(phones.filter((p) => out.has(p.replace(/\D/g, ''))));
}

/**
 * "SAIR" / "STOP" / "SALIR" tira o telefone das campanhas do WhatsApp;
 * "VOLTAR" / "START" / "VOLVER" põe de volta. O número de envio é um só, da
 * plataforma: o descadastro é do telefone, só neste canal. Antes marcava
 * marketingOptOut em todas as fichas com o número, de todas as redes, e
 * cortava também o e-mail, sem caminho de volta (item 275).
 */
@Injectable()
export class WhatsappOptOutService {
  private readonly logger = new Logger(WhatsappOptOutService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly whatsapp?: WhatsappService,
  ) {}

  /** Devolve 1 se a resposta mudou o descadastro (saiu ou voltou), 0 se não. */
  async optOutFromReply(from: string, text: string): Promise<number> {
    const variants = whatsappSenderVariants(from);
    if (!variants.length) return 0;
    const out = marketingOptOutReply(text);
    if (out) {
      // SAIR no WhatsApp não fica no nome de uma conta: só VOLTAR desfaz.
      const existing = await this.prisma.whatsappOptOut.findMany({
        where: { phoneDigits: { in: variants } },
        select: { phoneDigits: true, clientAccountId: true },
      });
      const byDigits = new Map(existing.map((row) => [row.phoneDigits, row.clientAccountId]));
      let changed = 0;
      for (const phoneDigits of variants) {
        if (!byDigits.has(phoneDigits)) {
          await this.prisma.whatsappOptOut.create({ data: { phoneDigits, clientAccountId: null } });
          changed++;
        } else if (byDigits.get(phoneDigits) != null) {
          await this.prisma.whatsappOptOut.update({
            where: { phoneDigits },
            data: { clientAccountId: null },
          });
          changed++;
        }
      }
      if (changed > 0) await this.confirm(from, out);
      return changed > 0 ? 1 : 0;
    }
    const back = marketingOptInReply(text);
    if (back) {
      const removed = await this.prisma.whatsappOptOut.deleteMany({
        where: { phoneDigits: { in: variants } },
      });
      if (removed.count > 0) await this.confirm(from, back);
      return removed.count > 0 ? 1 : 0;
    }
    return 0;
  }

  private async confirm(to: string, text: string) {
    try {
      await this.whatsapp?.sendSessionText(to, text);
    } catch (err) {
      this.logger.error('Não foi possível confirmar o descadastro no WhatsApp', err as Error);
    }
  }
}
