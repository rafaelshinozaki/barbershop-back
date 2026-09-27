import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../aws/s3.service';
import { reviewerLabel } from './professional-review.service';

export const REPORT_TARGETS = [
  'photo',
  'professional_review',
  'professional_profile',
  'barbershop',
] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

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
  constructor(private readonly prisma: PrismaService, private readonly s3: S3Service) {}

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
        const summary = await this.summary(targetType as ReportTarget, targetId);
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
  private async summary(type: ReportTarget, id: number) {
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
    if (!REPORT_TARGETS.includes(targetType as ReportTarget)) {
      throw new BadRequestException('Tipo de conteúdo inválido');
    }
    if (!['hide', 'dismiss', 'restore'].includes(action)) {
      throw new BadRequestException('Ação inválida');
    }
    const type = targetType as ReportTarget;
    if (!(await this.summary(type, targetId))) {
      throw new NotFoundException('Conteúdo não encontrado');
    }
    if (action === 'hide' || action === 'restore') {
      await this.setHidden(type, targetId, action === 'hide' ? new Date() : null);
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
    }
    return true;
  }

  private async setHidden(type: ReportTarget, id: number, at: Date | null) {
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
    }
  }
}
