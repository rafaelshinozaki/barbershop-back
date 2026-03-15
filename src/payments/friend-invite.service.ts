import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { CouponsService } from './coupons.service';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';

@Injectable()
export class FriendInviteService {
  private readonly logger = new Logger(FriendInviteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly couponsService: CouponsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Cria um novo convite de amigo
   */
  async createInvite(userId: number, friendEmail: string, sentVia?: string) {
    // Verificar se o usuário já convidou este email
    const existingInvite = await this.prisma.friendInvite.findFirst({
      where: {
        inviterId: userId,
        friendEmail: friendEmail.toLowerCase(),
        status: { in: ['PENDING', 'ACCEPTED'] },
      },
    });

    if (existingInvite) {
      throw new BadRequestException('Você já convidou este email');
    }

    // Verificar se o email não é do próprio usuário
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (user.email.toLowerCase() === friendEmail.toLowerCase()) {
      throw new BadRequestException('Você não pode convidar a si mesmo');
    }

    // Gerar token único
    const inviteToken = randomBytes(32).toString('hex');

    // Data de expiração (30 dias)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    // Criar o convite
    const invite = await this.prisma.friendInvite.create({
      data: {
        inviterId: userId,
        friendEmail: friendEmail.toLowerCase(),
        inviteToken,
        expiresAt,
        sentVia: sentVia || 'EMAIL',
      },
      include: {
        inviter: {
          select: {
            fullName: true,
            email: true,
          },
        },
      },
    });

    // Enviar email de convite
    await this.sendInviteEmail(invite);

    return invite;
  }

  /**
   * Lista convites enviados por um usuário
   */
  async getSentInvites(userId: number) {
    return this.prisma.friendInvite.findMany({
      where: {
        inviterId: userId,
      },
      include: {
        acceptedByUser: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        inviterCoupon: {
          select: {
            id: true,
            code: true,
            name: true,
            value: true,
            type: true,
          },
        },
        friendCoupon: {
          select: {
            id: true,
            code: true,
            name: true,
            value: true,
            type: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Processa o aceite de um convite
   */
  async acceptInvite(inviteToken: string, acceptedByUserId: number) {
    const invite = await this.prisma.friendInvite.findUnique({
      where: { inviteToken },
      include: {
        inviter: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        acceptedByUser: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    if (!invite) {
      throw new NotFoundException('Convite não encontrado');
    }

    if (invite.status !== 'PENDING') {
      throw new BadRequestException('Convite já foi processado');
    }

    if (invite.expiresAt < new Date()) {
      throw new BadRequestException('Convite expirado');
    }

    if (invite.inviterId === acceptedByUserId) {
      throw new BadRequestException('Você não pode aceitar seu próprio convite');
    }

    // Verificar se o usuário que está aceitando tem o email correto
    const acceptingUser = await this.prisma.user.findUnique({
      where: { id: acceptedByUserId },
      select: { email: true, createdAt: true },
    });

    if (acceptingUser.email.toLowerCase() !== invite.friendEmail.toLowerCase()) {
      throw new BadRequestException('Este convite não é para você');
    }

    // Verificar se o usuário que está aceitando é um novo usuário (conta criada após o convite)
    const inviteCreatedAt = invite.createdAt;
    const userCreatedAt = acceptingUser.createdAt;

    // Se a conta do usuário foi criada antes do convite, rejeitar o convite
    if (userCreatedAt < inviteCreatedAt) {
      // Atualizar o convite como rejeitado
      const updatedInvite = await this.prisma.friendInvite.update({
        where: { id: invite.id },
        data: {
          status: 'REJECTED',
          acceptedByUserId,
          // Não gerar cupons para usuários existentes
        },
        include: {
          inviter: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
          acceptedByUser: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
        },
      });

      // Enviar email informando que o convite foi rejeitado
      await this.sendInviteRejectedEmails(updatedInvite);

      return {
        success: false,
        message:
          'Este convite não pode ser usado por usuários que já possuem uma conta. Apenas novos usuários podem aceitar convites.',
        invite: updatedInvite,
        hasBenefits: false,
      };
    }

    // Gerar cupons apenas para novos usuários
    const inviterCoupon = await this.createFriendInviteCoupon(
      invite.inviter.id,
      'INVITER',
      invite.id,
    );

    const friendCoupon = await this.createFriendInviteCoupon(acceptedByUserId, 'FRIEND', invite.id);

    // Atualizar o convite
    const updatedInvite = await this.prisma.friendInvite.update({
      where: { id: invite.id },
      data: {
        status: 'ACCEPTED',
        acceptedByUserId,
        inviterCouponId: inviterCoupon.id,
        friendCouponId: friendCoupon.id,
      },
      include: {
        inviter: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        acceptedByUser: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        inviterCoupon: {
          select: {
            id: true,
            code: true,
            name: true,
            value: true,
            type: true,
          },
        },
        friendCoupon: {
          select: {
            id: true,
            code: true,
            name: true,
            value: true,
            type: true,
          },
        },
      },
    });

    // Enviar emails de confirmação
    await this.sendInviteAcceptedEmails(updatedInvite, true);

    return {
      success: true,
      message: 'Convite aceito com sucesso! Ambos ganharam 1 mês grátis.',
      invite: updatedInvite,
      hasBenefits: true,
    };
  }

  /**
   * Cria um cupom para convite de amigo
   */
  private async createFriendInviteCoupon(
    userId: number,
    type: 'INVITER' | 'FRIEND',
    inviteId: number,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true },
    });

    const couponCode = `FRIEND_${type}_${inviteId}_${randomBytes(4).toString('hex').toUpperCase()}`;

    return this.prisma.coupon.create({
      data: {
        code: couponCode,
        name:
          type === 'INVITER' ? 'Convite Aceito - 1 Mês Grátis' : 'Convite de Amigo - 1 Mês Grátis',
        description:
          type === 'INVITER'
            ? 'Você ganhou 1 mês grátis por ter seu convite aceito!'
            : 'Você ganhou 1 mês grátis por aceitar o convite de um amigo!',
        type: 'FREE_MONTH',
        value: 1, // 1 mês grátis
        maxUses: 1,
        isActive: true,
        validFrom: new Date(),
        validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 ano
        minSubscriptionMonths: 1,
        applicablePlans: null, // Aplicável a todos os planos
      },
    });
  }

  /**
   * Envia email de convite
   */
  private async sendInviteEmail(invite: any) {
    const inviteUrl = `${this.config.get('FRONTEND_URL')}/invite/${invite.inviteToken}`;

    await this.emailService.sendTemplateEmail(
      invite.inviterId,
      'friend_invite',
      {
        InviterName: invite.inviter.fullName,
        InviteUrl: inviteUrl,
        AppName: 'Relable',
      },
      'Convite Especial - Ganhe 1 Mês Grátis no Relable',
      `Friend invite sent to ${invite.friendEmail}`,
      invite.friendEmail,
    );
  }

  /**
   * Envia emails de confirmação quando o convite é aceito
   */
  private async sendInviteAcceptedEmails(invite: any, hasBenefits: boolean = true) {
    if (hasBenefits) {
      // Email para quem enviou o convite (com benefícios)
      await this.emailService.sendTemplateEmail(
        invite.inviterId,
        'friend_invite_accepted_inviter',
        {
          InviterName: invite.inviter.fullName,
          FriendName: invite.acceptedByUser.fullName,
          CouponCode: invite.inviterCoupon.code,
          AppName: 'Relable',
        },
        'Seu convite foi aceito! - 1 Mês Grátis',
        `Friend invite accepted by ${invite.acceptedByUser.email}`,
        invite.inviter.email,
      );

      // Email para quem aceitou o convite (com benefícios)
      await this.emailService.sendTemplateEmail(
        invite.acceptedByUserId,
        'friend_invite_accepted_friend',
        {
          FriendName: invite.acceptedByUser.fullName,
          InviterName: invite.inviter.fullName,
          CouponCode: invite.friendCoupon.code,
          AppName: 'Relable',
        },
        'Convite aceito! - 1 Mês Grátis',
        `Friend invite accepted by ${invite.acceptedByUser.email}`,
        invite.acceptedByUser.email,
      );
    } else {
      // Email para quem enviou o convite (sem benefícios - usuário já existia)
      await this.emailService.sendTemplateEmail(
        invite.inviterId,
        'friend_invite_accepted_inviter_no_benefits',
        {
          InviterName: invite.inviter.fullName,
          FriendName: invite.acceptedByUser.fullName,
          AppName: 'Relable',
        },
        'Seu convite foi aceito!',
        `Friend invite accepted by ${invite.acceptedByUser.email} (existing user)`,
        invite.inviter.email,
      );

      // Email para quem aceitou o convite (sem benefícios - usuário já existia)
      await this.emailService.sendTemplateEmail(
        invite.acceptedByUserId,
        'friend_invite_accepted_friend_no_benefits',
        {
          FriendName: invite.acceptedByUser.fullName,
          InviterName: invite.inviter.fullName,
          AppName: 'Relable',
        },
        'Convite aceito!',
        `Friend invite accepted by ${invite.acceptedByUser.email} (existing user)`,
        invite.acceptedByUser.email,
      );
    }
  }

  /**
   * Envia emails quando um convite é rejeitado (usuário já existia)
   */
  private async sendInviteRejectedEmails(invite: any) {
    // Email para quem enviou o convite (convite rejeitado)
    await this.emailService.sendTemplateEmail(
      invite.inviterId,
      'friend_invite_rejected_inviter',
      {
        InviterName: invite.inviter.fullName,
        FriendName: invite.acceptedByUser.fullName,
        AppName: 'Relable',
      },
      'Convite não pode ser usado',
      `Friend invite rejected by ${invite.acceptedByUser.email} (existing user)`,
      invite.inviter.email,
    );

    // Email para quem tentou aceitar o convite (convite rejeitado)
    await this.emailService.sendTemplateEmail(
      invite.acceptedByUserId,
      'friend_invite_rejected_friend',
      {
        FriendName: invite.acceptedByUser.fullName,
        InviterName: invite.inviter.fullName,
        AppName: 'Relable',
      },
      'Convite não pode ser usado',
      `Friend invite rejected by ${invite.acceptedByUser.email} (existing user)`,
      invite.acceptedByUser.email,
    );
  }

  /**
   * Obtém estatísticas de convites de um usuário
   */
  async getInviteStats(userId: number) {
    const [totalSent, totalAccepted, totalPending] = await Promise.all([
      this.prisma.friendInvite.count({
        where: { inviterId: userId },
      }),
      this.prisma.friendInvite.count({
        where: {
          inviterId: userId,
          status: 'ACCEPTED',
        },
      }),
      this.prisma.friendInvite.count({
        where: {
          inviterId: userId,
          status: 'PENDING',
        },
      }),
    ]);

    return {
      totalSent,
      totalAccepted,
      totalPending,
      acceptanceRate: totalSent > 0 ? (totalAccepted / totalSent) * 100 : 0,
    };
  }

  /**
   * Verifica se um convite é válido
   */
  async validateInvite(inviteToken: string) {
    const invite = await this.prisma.friendInvite.findUnique({
      where: { inviteToken },
      include: {
        inviter: {
          select: {
            fullName: true,
            email: true,
          },
        },
      },
    });

    if (!invite) {
      return { valid: false, reason: 'Convite não encontrado' };
    }

    if (invite.status !== 'PENDING') {
      return { valid: false, reason: 'Convite já foi processado' };
    }

    if (invite.expiresAt < new Date()) {
      return { valid: false, reason: 'Convite expirado' };
    }

    return {
      valid: true,
      invite: {
        id: invite.id,
        friendEmail: invite.friendEmail,
        inviterName: invite.inviter.fullName,
        expiresAt: invite.expiresAt,
      },
    };
  }
}
