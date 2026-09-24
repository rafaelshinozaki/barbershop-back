import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityNotificationsService } from '../notifications/activity-notifications.service';
import { BarbershopService } from './barbershop.service';

export type SharedLocationStatus = 'PENDING' | 'ACTIVE' | 'DECLINED' | 'REMOVED';

const SHOP_SUMMARY = {
  id: true,
  name: true,
  slug: true,
  address: true,
  city: true,
  state: true,
  isActive: true,
} as const;

/**
 * Espaço compartilhado — a "cadeira alugada", como o "Shared Location" do
 * Booksy. A barbearia dona do espaço convida o negócio de um profissional
 * independente (que tem a própria conta, plano, clientes, agenda e
 * recebimentos); ele aceita e passa a aparecer na página pública do espaço.
 * Nenhum lado vê os dados do outro — é só a vitrine e o endereço em comum.
 */
@Injectable()
export class SharedLocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly barbershopService: BarbershopService,
    private readonly activity: ActivityNotificationsService,
  ) {}

  /** O espaço (host) convida o negócio do profissional, pelo link da página dele. */
  async invite(userId: number, hostBarbershopId: number, memberSlugOrLink: string) {
    const host = await this.barbershopService.ensureAccess(userId, hostBarbershopId, 'manager');
    const slug = this.slugFrom(memberSlugOrLink);
    const member = await this.prisma.barbershop.findUnique({ where: { slug } });
    if (!member || !member.isActive) {
      throw new NotFoundException('Não achamos essa barbearia. Confira o link da página dela.');
    }
    if (member.id === host.id) {
      throw new BadRequestException('Esse é o seu próprio espaço');
    }
    if (member.networkId === host.networkId) {
      // Mesmo dono: é unidade da mesma rede, não profissional independente
      throw new BadRequestException(
        'Essa barbearia é da sua própria rede. Para trabalhar nas duas, adicione a pessoa à equipe.',
      );
    }
    const existing = await this.prisma.sharedLocationMember.findUnique({
      where: {
        hostBarbershopId_memberBarbershopId: {
          hostBarbershopId: host.id,
          memberBarbershopId: member.id,
        },
      },
    });
    if (existing && (existing.status === 'ACTIVE' || existing.status === 'PENDING')) {
      throw new BadRequestException(
        existing.status === 'ACTIVE'
          ? 'Esse profissional já atende no seu espaço'
          : 'Já existe um convite pendente para esse profissional',
      );
    }
    const link = existing
      ? await this.prisma.sharedLocationMember.update({
          where: { id: existing.id },
          data: { status: 'PENDING', invitedByUserId: userId, respondedAt: null },
        })
      : await this.prisma.sharedLocationMember.create({
          data: {
            hostBarbershopId: host.id,
            memberBarbershopId: member.id,
            invitedByUserId: userId,
          },
        });
    void this.activity.sharedLocationEvent(
      member.id,
      'invited',
      host.name,
      userId,
      `shared:${link.id}:invited:${link.updatedAt.getTime()}`,
    );
    return this.toView(link.id, host.id);
  }

  /** O profissional (dono/gerente do negócio convidado) aceita ou recusa. */
  async respond(userId: number, linkId: number, accept: boolean) {
    const link = await this.prisma.sharedLocationMember.findUnique({
      where: { id: linkId },
      include: { host: { select: SHOP_SUMMARY }, member: { select: SHOP_SUMMARY } },
    });
    if (!link) throw new NotFoundException('Convite não encontrado');
    await this.barbershopService.ensureAccess(userId, link.memberBarbershopId, 'manager');
    if (link.status !== 'PENDING') {
      throw new BadRequestException('Esse convite já foi respondido');
    }
    await this.prisma.sharedLocationMember.update({
      where: { id: link.id },
      data: { status: accept ? 'ACTIVE' : 'DECLINED', respondedAt: new Date() },
    });
    void this.activity.sharedLocationEvent(
      link.hostBarbershopId,
      accept ? 'accepted' : 'declined',
      link.member.name,
      userId,
      `shared:${link.id}:${accept ? 'accepted' : 'declined'}:${Date.now()}`,
    );
    return this.toView(link.id, link.memberBarbershopId);
  }

  /** Qualquer um dos dois lados encerra (o espaço remove, ou o profissional sai). */
  async end(userId: number, linkId: number, fromBarbershopId: number) {
    const link = await this.prisma.sharedLocationMember.findUnique({
      where: { id: linkId },
      include: { host: { select: SHOP_SUMMARY }, member: { select: SHOP_SUMMARY } },
    });
    if (
      !link ||
      (link.hostBarbershopId !== fromBarbershopId && link.memberBarbershopId !== fromBarbershopId)
    ) {
      throw new NotFoundException('Vínculo não encontrado');
    }
    await this.barbershopService.ensureAccess(userId, fromBarbershopId, 'manager');
    if (link.status !== 'ACTIVE' && link.status !== 'PENDING') {
      throw new BadRequestException('Esse vínculo já foi encerrado');
    }
    await this.prisma.sharedLocationMember.update({
      where: { id: link.id },
      data: { status: 'REMOVED', respondedAt: new Date() },
    });
    const fromHost = link.hostBarbershopId === fromBarbershopId;
    void this.activity.sharedLocationEvent(
      fromHost ? link.memberBarbershopId : link.hostBarbershopId,
      'left',
      fromHost ? link.host.name : link.member.name,
      userId,
      `shared:${link.id}:left:${Date.now()}`,
    );
    return true;
  }

  /**
   * Os vínculos da unidade dos dois lados: profissionais que atendem no espaço
   * dela (asHost) e espaços onde ela atende (asMember), com convites pendentes.
   */
  async list(userId: number, barbershopId: number) {
    await this.barbershopService.ensureAccess(userId, barbershopId, 'manager');
    const [asHost, asMember] = await Promise.all([
      this.prisma.sharedLocationMember.findMany({
        where: { hostBarbershopId: barbershopId, status: { in: ['PENDING', 'ACTIVE'] } },
        include: { member: { select: SHOP_SUMMARY } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.sharedLocationMember.findMany({
        where: { memberBarbershopId: barbershopId, status: { in: ['PENDING', 'ACTIVE'] } },
        include: { host: { select: SHOP_SUMMARY } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      asHost: asHost.map((l) => ({
        id: l.id,
        status: l.status,
        createdAt: l.createdAt,
        shop: l.member,
      })),
      asMember: asMember.map((l) => ({
        id: l.id,
        status: l.status,
        createdAt: l.createdAt,
        shop: l.host,
      })),
    };
  }

  /** Pra página pública: quem atende no espaço, e onde o profissional atende. */
  async publicLinks(barbershopId: number) {
    const [members, hosts] = await Promise.all([
      this.prisma.sharedLocationMember.findMany({
        where: { hostBarbershopId: barbershopId, status: 'ACTIVE', member: { isActive: true } },
        include: { member: { select: SHOP_SUMMARY } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.sharedLocationMember.findMany({
        where: { memberBarbershopId: barbershopId, status: 'ACTIVE', host: { isActive: true } },
        include: { host: { select: SHOP_SUMMARY } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      sharedLocationMembers: members.map((l) => l.member),
      sharedLocationHosts: hosts.map((l) => l.host),
    };
  }

  private async toView(linkId: number, viewerBarbershopId: number) {
    const l = await this.prisma.sharedLocationMember.findUniqueOrThrow({
      where: { id: linkId },
      include: { host: { select: SHOP_SUMMARY }, member: { select: SHOP_SUMMARY } },
    });
    return {
      id: l.id,
      status: l.status,
      createdAt: l.createdAt,
      shop: viewerBarbershopId === l.hostBarbershopId ? l.member : l.host,
    };
  }

  /** Aceita o slug ou o link inteiro da página pública (…/u/<slug>) */
  private slugFrom(value: string): string {
    const v = value.trim().replace(/\/+$/, '');
    const m = v.match(/\/u\/([^/?#]+)/);
    return (m ? m[1] : v.split('/').pop() ?? v).toLowerCase();
  }
}
