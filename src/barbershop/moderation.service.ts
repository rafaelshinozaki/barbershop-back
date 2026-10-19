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
  // Avaliação da unidade com a resposta dela (a moderação pode ocultar só a resposta)
  'shop_review',
  // Imagens da página pública: a moderação oculta só a imagem (a unidade envia outra)
  'shop_cover',
  'shop_logo',
  'barber_photo',
  'social_post',
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
/** Imagens da página pública: o dono e os gerentes da unidade são avisados */
const SHOP_IMAGES: ModeratedTarget[] = [
  'photo',
  'shop_cover',
  'shop_logo',
  'barber_photo',
  'social_post',
];
/** Mensagens mostradas ao admin (as últimas) */
const CHAT_EXCERPT = 30;

/** Como o aviso ao dono chama cada imagem da página pública */
const IMAGE_LABEL = {
  shop_cover: 'A capa',
  shop_logo: 'O logo',
  barber_photo: 'A foto de um profissional',
  social_post: 'Um post publicado',
} as const;

export const REPORT_REASONS = [
  'offensive',
  'spam',
  'fake',
  'inappropriate_image',
  'impersonation',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export type ModerationAction = 'hide' | 'hide_reply' | 'dismiss' | 'restore';
const MAX_DETAILS = 500;
const QUEUE_REPORTS = 500;

/** Chave de quem denunciou: HMAC do IP (não guarda o IP) */
export function reporterKey(ip: string, secret = process.env.JWT_SECRET || 'content-report') {
  return createHmac('sha256', secret).update(ip).digest('hex');
}

/**
 * Moderação do conteúdo público: qualquer visitante denuncia uma foto da
 * galeria, a capa, o logo, a foto de um profissional, um post publicado,
 * uma avaliação, um perfil de profissional ou a página da unidade; o admin
 * da plataforma decide numa fila.
 *
 * Ocultar: a foto sai da galeria (a capa, o logo, a foto do profissional e o
 * post saem da página até a unidade enviar outra), a avaliação sai da página e da nota, o
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
      case 'shop_review': {
        const r = await this.prisma.review.findUnique({
          where: { id },
          select: { hiddenAt: true },
        });
        return r ? { hidden: r.hiddenAt != null } : null;
      }
      case 'shop_cover':
      case 'shop_logo': {
        const b = await this.prisma.barbershop.findUnique({
          where: { id },
          select: {
            isActive: true,
            coverKey: true,
            photoKey: true,
            coverHiddenAt: true,
            logoHiddenAt: true,
          },
        });
        if (!b || !b.isActive) return null;
        if (type === 'shop_cover') return b.coverKey ? { hidden: b.coverHiddenAt != null } : null;
        return b.photoKey ? { hidden: b.logoHiddenAt != null } : null;
      }
      case 'barber_photo': {
        const b = await this.prisma.barber.findUnique({
          where: { id },
          select: {
            isActive: true,
            avatarKey: true,
            avatarUrl: true,
            avatarHiddenAt: true,
            barbershop: { select: { isActive: true } },
          },
        });
        return b && b.isActive && b.barbershop.isActive && (b.avatarKey || b.avatarUrl)
          ? { hidden: b.avatarHiddenAt != null }
          : null;
      }
      case 'social_post': {
        const p = await this.prisma.socialPost.findUnique({
          where: { id },
          select: { status: true, hiddenAt: true, barbershop: { select: { isActive: true } } },
        });
        return p && p.status === 'PUBLISHED' && p.barbershop.isActive
          ? { hidden: p.hiddenAt != null }
          : null;
      }
    }
  }

  /**
   * Fila do admin: um item por conteúdo denunciado, com quantas denúncias,
   * os motivos e os detalhes. Entra o que tem denúncia em aberto e o que
   * está oculto (pra poder restaurar).
   */
  async queue() {
    // Abertos primeiro, agrupados no banco: uma denúncia antiga não some
    // atrás das últimas 500. O que já foi ocultado continua na fila pra
    // restaurar, mesmo que a denúncia tenha saído dessa janela.
    const openGroups = await this.prisma.$queryRaw<
      { targetType: string; targetId: number; lastReportedAt: Date }[]
    >`
      SELECT "targetType", "targetId", MAX("createdAt") AS "lastReportedAt"
      FROM "ContentReport"
      WHERE status = 'open'
      GROUP BY "targetType", "targetId"
      ORDER BY MAX("createdAt") DESC
      LIMIT ${QUEUE_REPORTS}
    `;
    const seen = new Set(openGroups.map((g) => `${g.targetType}:${g.targetId}`));
    const hiddenGroups = await this.hiddenTargets(QUEUE_REPORTS);
    const keys = [
      ...openGroups,
      ...hiddenGroups.filter((g) => !seen.has(`${g.targetType}:${g.targetId}`)),
    ].slice(0, QUEUE_REPORTS);
    const reports = keys.length
      ? await this.prisma.contentReport.findMany({
          where: { OR: keys.map((k) => ({ targetType: k.targetType, targetId: k.targetId })) },
          orderBy: { createdAt: 'desc' },
        })
      : [];
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

  /** Itens já ocultados que têm denúncia, pra poder restaurar. */
  private hiddenTargets(take: number) {
    return this.prisma.$queryRaw<{ targetType: string; targetId: number; lastReportedAt: Date }[]>`
      SELECT "targetType", "targetId", "lastReportedAt" FROM (
        SELECT 'photo' AS "targetType", p.id AS "targetId", MAX(r."createdAt") AS "lastReportedAt"
        FROM "BarbershopPhoto" p
        JOIN "ContentReport" r ON r."targetType" = 'photo' AND r."targetId" = p.id
        WHERE p."hiddenAt" IS NOT NULL
        GROUP BY p.id
        UNION ALL
        SELECT 'professional_review', rv.id, MAX(r."createdAt")
        FROM "ProfessionalReview" rv
        JOIN "ContentReport" r ON r."targetType" = 'professional_review' AND r."targetId" = rv.id
        WHERE rv."hiddenAt" IS NOT NULL
        GROUP BY rv.id
        UNION ALL
        SELECT 'professional_profile', pr.id, MAX(r."createdAt")
        FROM "Professional" pr
        JOIN "ContentReport" r ON r."targetType" = 'professional_profile' AND r."targetId" = pr.id
        WHERE pr."suspendedAt" IS NOT NULL
        GROUP BY pr.id
        UNION ALL
        SELECT 'barbershop', b.id, MAX(r."createdAt")
        FROM "Barbershop" b
        JOIN "ContentReport" r ON r."targetType" = 'barbershop' AND r."targetId" = b.id
        WHERE b."searchHiddenAt" IS NOT NULL
        GROUP BY b.id
        UNION ALL
        SELECT 'shop_review', rv.id, MAX(r."createdAt")
        FROM "Review" rv
        JOIN "ContentReport" r ON r."targetType" = 'shop_review' AND r."targetId" = rv.id
        WHERE rv."hiddenAt" IS NOT NULL OR rv."replyHiddenAt" IS NOT NULL
        GROUP BY rv.id
        UNION ALL
        SELECT 'shop_cover', b.id, MAX(r."createdAt")
        FROM "Barbershop" b
        JOIN "ContentReport" r ON r."targetType" = 'shop_cover' AND r."targetId" = b.id
        WHERE b."coverHiddenAt" IS NOT NULL
        GROUP BY b.id
        UNION ALL
        SELECT 'shop_logo', b.id, MAX(r."createdAt")
        FROM "Barbershop" b
        JOIN "ContentReport" r ON r."targetType" = 'shop_logo' AND r."targetId" = b.id
        WHERE b."logoHiddenAt" IS NOT NULL
        GROUP BY b.id
        UNION ALL
        SELECT 'barber_photo', br.id, MAX(r."createdAt")
        FROM "Barber" br
        JOIN "ContentReport" r ON r."targetType" = 'barber_photo' AND r."targetId" = br.id
        WHERE br."avatarHiddenAt" IS NOT NULL
        GROUP BY br.id
        UNION ALL
        SELECT 'social_post', sp.id, MAX(r."createdAt")
        FROM "SocialPost" sp
        JOIN "ContentReport" r ON r."targetType" = 'social_post' AND r."targetId" = sp.id
        WHERE sp."hiddenAt" IS NOT NULL
        GROUP BY sp.id
        UNION ALL
        SELECT 'chat_thread', t.id, MAX(r."createdAt")
        FROM "ChatThread" t
        JOIN "ContentReport" r
          ON r."targetType" = 'chat_thread' AND r."targetId" = t.id AND r.status = 'actioned'
        WHERE t."closedAt" IS NOT NULL
        GROUP BY t.id
      ) hidden
      ORDER BY "lastReportedAt" DESC
      LIMIT ${take}
    `;
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
      case 'shop_review': {
        const r = await this.prisma.review.findUnique({
          where: { id },
          include: {
            barbershop: { select: { name: true, slug: true } },
            customer: { select: { name: true } },
            clientAccount: { select: { name: true } },
          },
        });
        if (!r) return null;
        const reviewer = reviewerLabel(r.clientAccount?.name ?? r.customer?.name);
        return {
          title: `${r.barbershop.name} · ${'★'.repeat(r.rating)} · ${reviewer}`,
          text: [r.comment, r.reply ? `Resposta da unidade: ${r.reply}` : null]
            .filter(Boolean)
            .join('\n'),
          imageUrl: null,
          link: `/u/${r.barbershop.slug}`,
          hidden: r.hiddenAt != null || r.replyHiddenAt != null,
        };
      }
      case 'shop_cover':
      case 'shop_logo': {
        const b = await this.prisma.barbershop.findUnique({
          where: { id },
          select: {
            name: true,
            slug: true,
            coverKey: true,
            photoKey: true,
            coverHiddenAt: true,
            logoHiddenAt: true,
          },
        });
        if (!b) return null;
        const key = type === 'shop_cover' ? b.coverKey : b.photoKey;
        return {
          title: b.name,
          text: null,
          imageUrl: key ? await this.s3.getDownloadUrl(key) : null,
          link: `/u/${b.slug}`,
          hidden: (type === 'shop_cover' ? b.coverHiddenAt : b.logoHiddenAt) != null,
        };
      }
      case 'barber_photo': {
        const b = await this.prisma.barber.findUnique({
          where: { id },
          select: {
            name: true,
            avatarKey: true,
            avatarUrl: true,
            avatarHiddenAt: true,
            barbershop: { select: { name: true, slug: true } },
          },
        });
        if (!b) return null;
        return {
          title: `${b.name} · ${b.barbershop.name}`,
          text: null,
          imageUrl: b.avatarKey ? await this.s3.getDownloadUrl(b.avatarKey) : b.avatarUrl,
          link: `/u/${b.barbershop.slug}`,
          hidden: b.avatarHiddenAt != null,
        };
      }
      case 'social_post': {
        const p = await this.prisma.socialPost.findUnique({
          where: { id },
          select: {
            caption: true,
            imageKey: true,
            hiddenAt: true,
            barbershop: { select: { name: true, slug: true } },
          },
        });
        if (!p) return null;
        return {
          title: p.barbershop.name,
          text: p.caption,
          imageUrl: await this.s3.getDownloadUrl(p.imageKey),
          link: `/u/${p.barbershop.slug}`,
          hidden: p.hiddenAt != null,
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
    if (!['hide', 'hide_reply', 'dismiss', 'restore'].includes(action)) {
      throw new BadRequestException('Ação inválida');
    }
    const type = targetType as ModeratedTarget;
    if (action === 'hide_reply' && type !== 'shop_review') {
      throw new BadRequestException('Ação inválida');
    }
    if (!(await this.summary(type, targetId))) {
      throw new NotFoundException('Conteúdo não encontrado');
    }
    if (action === 'hide_reply') {
      // Só a resposta da unidade sai da página; a avaliação do cliente fica
      await this.prisma.review.update({
        where: { id: targetId },
        data: { replyHiddenAt: new Date() },
      });
    }
    if (action === 'hide' || action === 'restore') {
      await this.setHidden(type, targetId, action === 'hide' ? new Date() : null);
      await this.notifyOwner(type, targetId, action);
    }
    if (action !== 'restore') {
      await this.prisma.contentReport.updateMany({
        where: { targetType: type, targetId, status: 'open' },
        data: {
          status: action === 'hide' || action === 'hide_reply' ? 'actioned' : 'dismissed',
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
   * algo dele: fotos e imagens da página e a própria unidade vão para o dono e os
   * gerentes; o perfil, para o próprio profissional. Avaliação e conversa
   * não têm um "dono" a avisar (a avaliação é do cliente). Também chamado
   * pelo comando da API do backoffice, que agora decide a moderação.
   */
  async notifyOwner(type: ModeratedTarget, id: number, action: 'hide' | 'restore') {
    const hide = action === 'hide';
    let userIds: number[] = [];
    let title = '';
    let message = '';
    let actionUrl = '';
    if (SHOP_IMAGES.includes(type) || type === 'barbershop') {
      const barbershopId = await this.shopOf(type, id);
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
      } else if (type !== 'barbershop') {
        const what = IMAGE_LABEL[type as keyof typeof IMAGE_LABEL];
        title = hide ? 'Imagem ocultada pela moderação' : 'Imagem de volta na página';
        message = hide
          ? `${what} de ${shop.name} saiu da página pública após denúncia. Envie outra imagem ou, se achar que foi engano, fale com o suporte.`
          : `${what} de ${shop.name} voltou a aparecer na página pública.`;
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

  /** Unidade dona do conteúdo (imagens da página pública e a própria unidade) */
  private async shopOf(type: ModeratedTarget, id: number): Promise<number | undefined> {
    switch (type) {
      case 'photo':
        return (
          await this.prisma.barbershopPhoto.findUnique({
            where: { id },
            select: { barbershopId: true },
          })
        )?.barbershopId;
      case 'barber_photo':
        return (
          await this.prisma.barber.findUnique({ where: { id }, select: { barbershopId: true } })
        )?.barbershopId;
      case 'social_post':
        return (
          await this.prisma.socialPost.findUnique({ where: { id }, select: { barbershopId: true } })
        )?.barbershopId;
      default:
        return id;
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
      case 'shop_review':
        // Restaurar volta a avaliação e a resposta
        await this.prisma.review.update({
          where: { id },
          data: at ? { hiddenAt: at } : { hiddenAt: null, replyHiddenAt: null },
        });
        return;
      case 'shop_cover':
        await this.prisma.barbershop.update({ where: { id }, data: { coverHiddenAt: at } });
        return;
      case 'shop_logo':
        await this.prisma.barbershop.update({ where: { id }, data: { logoHiddenAt: at } });
        return;
      case 'barber_photo':
        await this.prisma.barber.update({ where: { id }, data: { avatarHiddenAt: at } });
        return;
      case 'social_post':
        await this.prisma.socialPost.update({ where: { id }, data: { hiddenAt: at } });
        return;
      case 'chat_thread':
        // "Ocultar" uma conversa é encerrá-la: fica visível, sem mensagem nova
        await this.prisma.chatThread.update({ where: { id }, data: { closedAt: at } });
        return;
    }
  }
}
