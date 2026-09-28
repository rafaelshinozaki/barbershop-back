import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { createHmac } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../aws/s3.service';
import { PushService } from '../push/push.service';
import { NotificationType } from '../notifications/dto/create-notification.dto';
import { reviewerLabel } from './professional-review.service';

export const REPORT_TARGETS = [
  'photo',
  'professional_review',
  'professional_profile',
  'barbershop',
] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];
/**
 * Conversa do atendimento: denunciada só por quem participa (pelo chat, não
 * pelo reportContent público — senão qualquer um faria o admin ler conversa
 * alheia). Denunciada, a guarda segura o texto até a moderação decidir.
 */
export type ModeratedTarget = ReportTarget | 'chat_thread';
const MODERATED_TARGETS: ModeratedTarget[] = [...REPORT_TARGETS, 'chat_thread'];
/** Enquanto a denúncia está aberta, a conversa não sai pela guarda */
const HOLD_UNTIL = new Date('2100-01-01T00:00:00Z');
/** Mensagens mostradas ao admin (as últimas) */
const CHAT_EXCERPT = 30;

export const REPORT_REASONS = [
  'offensive',
  'spam',
  'fake',
  'inappropriate_image',
  'impersonation',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export type ModerationAction = 'hide' | 'dismiss' | 'restore';
const MAX_DETAILS = 500;
const QUEUE_REPORTS = 500;

/** Chave de quem denunciou: HMAC do IP (não guarda o IP) */
export function reporterKey(ip: string, secret = process.env.JWT_SECRET || 'content-report') {
  return createHmac('sha256', secret).update(ip).digest('hex');
}

/**
 * Moderação do conteúdo público: qualquer visitante denuncia uma foto da
 * galeria, uma avaliação de profissional, um perfil de profissional ou a
 * página da unidade; o admin da plataforma decide numa fila.
 *
 * Ocultar: a foto sai da galeria, a avaliação sai da página e da nota, o
 * perfil sai do ar (página e busca) e a unidade sai da vitrine (busca e
 * sitemap; o link direto continua, pra quem já é cliente agendar).
 * O perfil do cliente não entra aqui: ele não é público.
 */
@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    @Optional() private readonly push?: PushService,
  ) {}

  async report(
    input: { targetType: string; targetId: number; reason: string; details?: string | null },
    ip: string,
  ) {
    if (!REPORT_TARGETS.includes(input.targetType as ReportTarget)) {
      throw new BadRequestException('Tipo de conteúdo inválido');
    }
    if (!REPORT_REASONS.includes(input.reason as ReportReason)) {
      throw new BadRequestException('Motivo inválido');
    }
    const details = input.details?.trim() || null;
    if (details && details.length > MAX_DETAILS) {
      throw new BadRequestException(`Detalhes com no máximo ${MAX_DETAILS} caracteres`);
    }
    const targetType = input.targetType as ReportTarget;
    // Só dá pra denunciar o que está no ar
    const target = await this.state(targetType, input.targetId);
    if (!target || target.hidden) throw new NotFoundException('Conteúdo não encontrado');

    const key = reporterKey(ip);
    // A mesma pessoa denunciando de novo o mesmo item: não duplica
    const existing = await this.prisma.contentReport.findFirst({
      where: { targetType, targetId: input.targetId, reporterKey: key, status: 'open' },
    });
    if (existing) return true;
    await this.prisma.contentReport.create({
      data: {
        targetType,
        targetId: input.targetId,
        reason: input.reason,
        details,
        reporterKey: key,
      },
    });
    return true;
  }

  /** Existe e está oculto? (null = não existe ou não é público) */
  private async state(type: ReportTarget, id: number): Promise<{ hidden: boolean } | null> {
    switch (type) {
      case 'photo': {
        const p = await this.prisma.barbershopPhoto.findUnique({
          where: { id },
          select: { hiddenAt: true, barbershop: { select: { isActive: true } } },
        });
        return p && p.barbershop.isActive ? { hidden: p.hiddenAt != null } : null;
      }
      case 'professional_review': {
        const r = await this.prisma.professionalReview.findUnique({
          where: { id },
          select: { hiddenAt: true },
        });
        return r ? { hidden: r.hiddenAt != null } : null;
      }
      case 'professional_profile': {
        const p = await this.prisma.professional.findUnique({
          where: { id },
          select: { suspendedAt: true, visibility: true, slug: true },
        });
        return p && p.slug && p.visibility !== 'hidden' ? { hidden: p.suspendedAt != null } : null;
      }
      case 'barbershop': {
        const b = await this.prisma.barbershop.findUnique({
          where: { id },
          select: { searchHiddenAt: true, isActive: true },
        });
        return b && b.isActive ? { hidden: b.searchHiddenAt != null } : null;
      }
    }
  }

  /**
   * Fila do admin: um item por conteúdo denunciado, com quantas denúncias,
   * os motivos e os detalhes. Entra o que tem denúncia em aberto e o que
   * está oculto (pra poder restaurar).
   */
  async queue() {
    const reports = await this.prisma.contentReport.findMany({
      orderBy: { createdAt: 'desc' },
      take: QUEUE_REPORTS,
    });
    const groups = new Map<string, typeof reports>();
    for (const r of reports) {
      const key = `${r.targetType}:${r.targetId}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    const items = await Promise.all(
      [...groups.values()].map(async (list) => {
        const { targetType, targetId } = list[0];
        const summary = await this.summary(targetType as ModeratedTarget, targetId);
        if (!summary) return null;
        const open = list.filter((r) => r.status === 'open');
        if (!open.length && !summary.hidden) return null;
        const reasons = new Map<string, number>();
        for (const r of open.length ? open : list) {
          reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
        }
        return {
          targetType,
          targetId,
          ...summary,
          openReports: open.length,
          reasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })),
          details: (open.length ? open : list)
            .map((r) => r.details)
            .filter((d): d is string => !!d)
            .slice(0, 5),
          lastReportedAt: list[0].createdAt,
        };
      }),
    );
    return items
      .filter((i): i is NonNullable<typeof i> => i != null)
      .sort((a, b) =>
        a.openReports && !b.openReports
          ? -1
          : !a.openReports && b.openReports
          ? 1
          : b.lastReportedAt.getTime() - a.lastReportedAt.getTime(),
      );
  }

  /** O que o admin vê do conteúdo: título, texto, imagem e o link público */
  private async summary(type: ModeratedTarget, id: number) {
    switch (type) {
      case 'photo': {
        const p = await this.prisma.barbershopPhoto.findUnique({
          where: { id },
          include: { barbershop: { select: { name: true, slug: true } } },
        });
        if (!p) return null;
        return {
          title: p.barbershop.name,
          text: p.caption,
          imageUrl: await this.s3.getDownloadUrl(p.key),
          link: `/u/${p.barbershop.slug}`,
          hidden: p.hiddenAt != null,
        };
      }
      case 'professional_review': {
        const r = await this.prisma.professionalReview.findUnique({
          where: { id },
          include: {
            customer: { select: { name: true } },
            barber: { select: { name: true } },
            professional: { select: { slug: true } },
            barbershop: { select: { slug: true } },
          },
        });
        if (!r) return null;
        return {
          title: `${r.barber.name} · ${'★'.repeat(r.rating)} · ${reviewerLabel(r.customer?.name)}`,
          text: r.comment,
          imageUrl: null,
          link: r.professional?.slug ? `/p/${r.professional.slug}` : `/u/${r.barbershop.slug}`,
          hidden: r.hiddenAt != null,
        };
      }
      case 'professional_profile': {
        const p = await this.prisma.professional.findUnique({
          where: { id },
          include: { user: { select: { fullName: true } } },
        });
        if (!p) return null;
        return {
          title: p.user.fullName,
          text: null,
          imageUrl: null,
          link: p.slug ? `/p/${p.slug}` : null,
          hidden: p.suspendedAt != null,
        };
      }
      case 'barbershop': {
        const b = await this.prisma.barbershop.findUnique({
          where: { id },
          select: { name: true, slug: true, description: true, searchHiddenAt: true },
        });
        if (!b) return null;
        return {
          title: b.name,
          text: b.description,
          imageUrl: null,
          link: `/u/${b.slug}`,
          hidden: b.searchHiddenAt != null,
        };
      }
      case 'chat_thread': {
        const t = await this.prisma.chatThread.findUnique({
          where: { id },
          include: {
            messages: { orderBy: { createdAt: 'desc' }, take: CHAT_EXCERPT },
            appointment: {
              select: {
                barbershop: { select: { name: true } },
                barber: { select: { name: true } },
                customer: { select: { name: true } },
              },
            },
          },
        });
        if (!t) return null;
        const staffName =
          t.kind === 'unit' ? t.appointment.barbershop.name : t.appointment.barber.name;
        const clientName = t.appointment.customer.name;
        return {
          title: `${clientName} ↔ ${staffName}`,
          text: [...t.messages]
            .reverse()
            .map((m) => `[${m.senderSide === 'client' ? clientName : staffName}] ${m.body}`)
            .join('\n'),
          imageUrl: null,
          link: null,
          hidden: t.closedAt != null,
        };
      }
      default:
        return null;
    }
  }

  /**
   * hide: oculta e encerra as denúncias em aberto como atendidas.
   * dismiss: mantém no ar e descarta as denúncias em aberto.
   * restore: volta a mostrar o que foi ocultado.
   */
  async resolve(adminUserId: number, targetType: string, targetId: number, action: string) {
    if (!MODERATED_TARGETS.includes(targetType as ModeratedTarget)) {
      throw new BadRequestException('Tipo de conteúdo inválido');
    }
    if (!['hide', 'dismiss', 'restore'].includes(action)) {
      throw new BadRequestException('Ação inválida');
    }
    const type = targetType as ModeratedTarget;
    if (!(await this.summary(type, targetId))) {
      throw new NotFoundException('Conteúdo não encontrado');
    }
    if (action === 'hide' || action === 'restore') {
      await this.setHidden(type, targetId, action === 'hide' ? new Date() : null);
      await this.notifyOwner(type, targetId, action);
    }
    if (action !== 'restore') {
      await this.prisma.contentReport.updateMany({
        where: { targetType: type, targetId, status: 'open' },
        data: {
          status: action === 'hide' ? 'actioned' : 'dismissed',
          resolvedAt: new Date(),
          resolvedByUserId: adminUserId,
        },
      });
      // Denúncia decidida: a conversa volta a seguir a guarda normal
      if (type === 'chat_thread') {
        await this.prisma.chatThread.update({
          where: { id: targetId },
          data: { retainUntil: null },
        });
      }
    }
    return true;
  }

  /** Denúncia de conversa, feita por quem participa (o ChatService confere) */
  async reportChatThread(
    threadId: number,
    input: { reason: string; details?: string | null },
    reporter: string,
  ) {
    if (!REPORT_REASONS.includes(input.reason as ReportReason)) {
      throw new BadRequestException('Motivo inválido');
    }
    const details = input.details?.trim() || null;
    if (details && details.length > MAX_DETAILS) {
      throw new BadRequestException(`Detalhes com no máximo ${MAX_DETAILS} caracteres`);
    }
    const key = reporterKey(reporter);
    const existing = await this.prisma.contentReport.findFirst({
      where: { targetType: 'chat_thread', targetId: threadId, reporterKey: key, status: 'open' },
    });
    if (!existing) {
      await this.prisma.contentReport.create({
        data: {
          targetType: 'chat_thread',
          targetId: threadId,
          reason: input.reason,
          details,
          reporterKey: key,
        },
      });
    }
    // Segura o texto até a moderação decidir (a guarda de 12 meses não apaga)
    await this.prisma.chatThread.update({
      where: { id: threadId },
      data: { retainUntil: HOLD_UNTIL },
    });
    return true;
  }

  /**
   * Avisa o dono (sininho e celular) quando a moderação oculta ou devolve
   * algo dele: foto da galeria e página da unidade vão para o dono e os
   * gerentes; o perfil, para o próprio profissional. Avaliação e conversa
   * não têm um "dono" a avisar (a avaliação é do cliente).
   */
  private async notifyOwner(type: ModeratedTarget, id: number, action: 'hide' | 'restore') {
    const hide = action === 'hide';
    let userIds: number[] = [];
    let title = '';
    let message = '';
    let actionUrl = '';
    if (type === 'photo' || type === 'barbershop') {
      const barbershopId =
        type === 'photo'
          ? (
              await this.prisma.barbershopPhoto.findUnique({
                where: { id },
                select: { barbershopId: true },
              })
            )?.barbershopId
          : id;
      if (!barbershopId) return;
      const shop = await this.prisma.barbershop.findUnique({
        where: { id: barbershopId },
        select: {
          name: true,
          ownerUserId: true,
          network: { select: { ownerUserId: true } },
          barbers: {
            where: { isActive: true, staffType: 'manager', userId: { not: null } },
            select: { userId: true },
          },
        },
      });
      if (!shop) return;
      userIds = [
        shop.ownerUserId,
        shop.network?.ownerUserId,
        ...shop.barbers.map((b) => b.userId),
      ].filter((u): u is number => typeof u === 'number');
      actionUrl = `/barbershops/${barbershopId}/public-page`;
      if (type === 'photo') {
        title = hide ? 'Foto ocultada pela moderação' : 'Foto de volta na galeria';
        message = hide
          ? `Uma foto da galeria de ${shop.name} foi ocultada após denúncia. Se achar que foi engano, fale com o suporte.`
          : `A foto da galeria de ${shop.name} voltou a aparecer.`;
      } else {
        title = hide ? 'Unidade fora da busca' : 'Unidade de volta na busca';
        message = hide
          ? `${shop.name} saiu da busca e do sitemap após denúncia; o link direto continua. Se achar que foi engano, fale com o suporte.`
          : `${shop.name} voltou a aparecer na busca.`;
      }
    } else if (type === 'professional_profile') {
      const professional = await this.prisma.professional.findUnique({
        where: { id },
        select: { userId: true },
      });
      if (!professional) return;
      userIds = [professional.userId];
      actionUrl = '/profile-privacy';
      title = hide ? 'Perfil público suspenso' : 'Perfil público de volta';
      message = hide
        ? 'Sua página pública saiu do ar após denúncia. Se achar que foi engano, fale com o suporte.'
        : 'Sua página pública voltou ao ar.';
    } else {
      return;
    }
    userIds = [...new Set(userIds)];
    if (!userIds.length) return;
    try {
      await this.prisma.userNotification.createMany({
        data: userIds.map((userId) => ({
          userId,
          title,
          message,
          type: NotificationType.INFO,
          actionUrl,
        })),
      });
      await this.push?.sendToUsers(userIds, () => ({
        title,
        body: message,
        url: actionUrl,
        tag: 'moderation',
      }));
    } catch (err) {
      this.logger.warn(`Aviso de moderação não enviado: ${err}`);
    }
  }

  private async setHidden(type: ModeratedTarget, id: number, at: Date | null) {
    switch (type) {
      case 'photo':
        await this.prisma.barbershopPhoto.update({ where: { id }, data: { hiddenAt: at } });
        return;
      case 'professional_review':
        await this.prisma.professionalReview.update({ where: { id }, data: { hiddenAt: at } });
        return;
      case 'professional_profile':
        await this.prisma.professional.update({ where: { id }, data: { suspendedAt: at } });
        return;
      case 'barbershop':
        await this.prisma.barbershop.update({ where: { id }, data: { searchHiddenAt: at } });
        return;
      case 'chat_thread':
        // "Ocultar" uma conversa é encerrá-la: fica visível, sem mensagem nova
        await this.prisma.chatThread.update({ where: { id }, data: { closedAt: at } });
        return;
    }
  }
}
