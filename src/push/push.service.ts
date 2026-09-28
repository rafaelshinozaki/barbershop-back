import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { PrismaService } from '@/prisma/prisma.service';
import { type Lang, normalizeLang } from '@/email/language';

export type PushPayload = {
  title: string;
  body: string;
  /** Aberto ao tocar na notificação (caminho do front ou URL completa) */
  url: string;
  /** Mesma tag substitui a notificação anterior (uma por conversa) */
  tag?: string;
};
export type PushOwner = { userId: number } | { clientAccountId: number };
export type PushSubscriptionInput = { endpoint: string; p256dh: string; auth: string };

type Row = { id: number; endpoint: string; p256dh: string; auth: string; language: string | null };

const MAX_PER_OWNER = 10;

/**
 * Notificação no celular/navegador (Web Push, PWA). Cada aparelho se
 * inscreve com a chave pública VAPID; o texto é montado no idioma do
 * aparelho. Sem VAPID configurado, nada é enviado (e o front não oferece).
 * Inscrição que o serviço de push dá como expirada (404/410) sai na hora.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  private vapid() {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY');
    if (!publicKey || !privateKey) return null;
    return {
      subject: this.config.get<string>('VAPID_SUBJECT') || 'mailto:suporte@barbershop.com.br',
      publicKey,
      privateKey,
    };
  }

  publicKey(): string | null {
    return this.vapid()?.publicKey ?? null;
  }

  async subscribe(
    owner: PushOwner,
    sub: PushSubscriptionInput,
    meta: { userAgent?: string | null; language?: string | null } = {},
  ) {
    const endpoint = sub.endpoint?.trim();
    if (!endpoint || !/^https:\/\//.test(endpoint) || endpoint.length > 1000) {
      throw new BadRequestException('Inscrição inválida');
    }
    if (!sub.p256dh || !sub.auth || sub.p256dh.length > 200 || sub.auth.length > 100) {
      throw new BadRequestException('Inscrição inválida');
    }
    const data = {
      p256dh: sub.p256dh,
      auth: sub.auth,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      language: meta.language ? normalizeLang(meta.language) : null,
      lastUsedAt: new Date(),
      // O aparelho passa a ser só de quem inscreveu agora (troca de conta no mesmo navegador)
      userId: 'userId' in owner ? owner.userId : null,
      clientAccountId: 'clientAccountId' in owner ? owner.clientAccountId : null,
    };
    await this.prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { endpoint, ...data },
      update: data,
    });
    // Limite de aparelhos por conta: os mais antigos saem
    const all = await this.prisma.pushSubscription.findMany({
      where:
        'userId' in owner ? { userId: owner.userId } : { clientAccountId: owner.clientAccountId },
      orderBy: { lastUsedAt: 'desc' },
      select: { id: true },
    });
    if (all.length > MAX_PER_OWNER) {
      await this.prisma.pushSubscription.deleteMany({
        where: { id: { in: all.slice(MAX_PER_OWNER).map((s) => s.id) } },
      });
    }
    return true;
  }

  /** Desligar neste aparelho (ou sair): quem tem o endpoint pode tirar */
  async unsubscribe(endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint } });
    return true;
  }

  async sendToUsers(userIds: number[], build: (lang: Lang) => PushPayload) {
    if (!userIds.length || !this.vapid()) return 0;
    const rows = await this.prisma.pushSubscription.findMany({
      where: { userId: { in: userIds }, user: { isActive: true } },
    });
    return this.deliverAll(rows, build);
  }

  async sendToClient(clientAccountId: number, build: (lang: Lang) => PushPayload) {
    if (!this.vapid()) return 0;
    const rows = await this.prisma.pushSubscription.findMany({
      where: { clientAccountId, clientAccount: { deletedAt: null, suspendedAt: null } },
    });
    return this.deliverAll(rows, build);
  }

  private async deliverAll(rows: Row[], build: (lang: Lang) => PushPayload) {
    const vapid = this.vapid();
    if (!vapid || !rows.length) return 0;
    const gone: number[] = [];
    const ok: number[] = [];
    await Promise.all(
      rows.map(async (row) => {
        try {
          await this.deliver(row, build(normalizeLang(row.language)), vapid);
          ok.push(row.id);
        } catch (error: any) {
          if (error?.statusCode === 404 || error?.statusCode === 410) gone.push(row.id);
          else
            this.logger.warn(
              `Push não enviado (inscrição ${row.id}): ${error?.statusCode ?? error}`,
            );
        }
      }),
    );
    if (gone.length) await this.prisma.pushSubscription.deleteMany({ where: { id: { in: gone } } });
    if (ok.length) {
      await this.prisma.pushSubscription.updateMany({
        where: { id: { in: ok } },
        data: { lastUsedAt: new Date() },
      });
    }
    return ok.length;
  }

  /** Envio de verdade (os testes trocam por um falso) */
  protected async deliver(
    row: Row,
    payload: PushPayload,
    vapid: { subject: string; publicKey: string; privateKey: string },
  ) {
    await webpush.sendNotification(
      { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
      JSON.stringify(payload),
      { vapidDetails: vapid, TTL: 3600, urgency: 'normal' },
    );
  }
}
