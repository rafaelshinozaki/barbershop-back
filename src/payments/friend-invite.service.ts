import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { CouponsService } from './coupons.service';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';

const INVITES_PER_DAY = 5;
const MAX_REWARDS = 12;

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
      select: {
        email: true,
        provider: true,
        isActive: true,
        clientAccount: { select: { emailVerifiedAt: true } },
      },
    });
    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    const emailConfirmed = user.provider !== 'local' || user.clientAccount?.emailVerifiedAt != null;
    if (!user.isActive || !emailConfirmed) {
      throw new BadRequestException('Confirme seu e-mail antes de convidar alguém.');
    }

    if (user.email.toLowerCase() === friendEmail.toLowerCase()) {
      throw new BadRequestException('Você não pode convidar a si mesmo');
    }

    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const [sentToday, rewards] = await Promise.all([
      this.prisma.friendInvite.count({
        where: { inviterId: userId, createdAt: { gte: startOfDay } },
      }),
      this.prisma.friendInvite.count({
        where: { inviterId: userId, status: 'ACCEPTED' },
      }),
    ]);
    if (sentToday >= INVITES_PER_DAY) {
      throw new BadRequestException('Você já enviou o limite de convites de hoje.');
    }
    if (rewards >= MAX_REWARDS) {
      throw new BadRequestException('Você já atingiu o limite de meses grátis por convite.');
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
    if (!acceptingUser) {
      throw new NotFoundException('Usuário não encontrado');
    }

    if (acceptingUser.email.toLowerCase() !== invite.friendEmail.toLowerCase()) {
      throw new BadRequestException('Este convite não é para você');
    }

    // Verificar se o usuário que está aceitando é um novo usuário (conta criada após o convite)
    const inviteCreatedAt = invite.createdAt;
    const userCreatedAt = acceptingUser.createdAt;

    // Se a conta do usuário foi criada antes do convite, rejeitar o convite
    if (userCreatedAt < inviteCreatedAt) {
      const rejected = await this.prisma.friendInvite.updateMany({
        where: { id: invite.id, status: 'PENDING' },
        data: { status: 'REJECTED', acceptedByUserId },
      });
      if (rejected.count !== 1) {
        throw new BadRequestException('Convite já foi processado');
      }
      const updatedInvite = await this.prisma.friendInvite.findUniqueOrThrow({
        where: { id: invite.id },
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

    const inviteView = {
      inviter: { select: { id: true, fullName: true, email: true } },
      acceptedByUser: { select: { id: true, fullName: true, email: true } },
      inviterCoupon: { select: { id: true, code: true, name: true, value: true, type: true } },
      friendCoupon: { select: { id: true, code: true, name: true, value: true, type: true } },
    } as const;

    // O status sai de PENDING antes dos cupons. Dois cliques: só o primeiro
    // cria cupom. A trava serializa os aceites do mesmo indicador, senão o
    // teto de meses conta duas vezes ao mesmo tempo.
    const updatedInvite = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'friend-invite:' + invite.inviterId}))`;
      const rewards = await tx.friendInvite.count({
        where: { inviterId: invite.inviterId, status: 'ACCEPTED' },
      });
      const claimed = await tx.friendInvite.updateMany({
        where: { id: invite.id, status: 'PENDING' },
        data: { status: 'ACCEPTED', acceptedByUserId },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('Convite já foi processado');
      }
      if (rewards >= MAX_REWARDS) {
        return tx.friendInvite.findUniqueOrThrow({ where: { id: invite.id }, include: inviteView });
      }
      const inviterCoupon = await this.createFriendInviteCoupon(
        tx,
        invite.inviter.id,
        'INVITER',
        invite.id,
      );
      const friendCoupon = await this.createFriendInviteCoupon(tx, acceptedByUserId, 'FRIEND', invite.id);
      return tx.friendInvite.update({
        where: { id: invite.id },
        data: { inviterCouponId: inviterCoupon.id, friendCouponId: friendCoupon.id },
        include: inviteView,
      });
    });

    const hasBenefits = updatedInvite.inviterCouponId != null;
    await this.sendInviteAcceptedEmails(updatedInvite, hasBenefits);

    return {
      success: true,
      message: hasBenefits
        ? 'Convite aceito com sucesso! Ambos ganharam 1 mês grátis.'
        : 'Convite aceito. O limite de meses grátis de quem convidou já foi atingido.',
      invite: updatedInvite,
      hasBenefits,
    };
  }

  /**
   * Cria um cupom para convite de amigo
   */
  private async createFriendInviteCoupon(
    db: Prisma.TransactionClient,
    userId: number,
    type: 'INVITER' | 'FRIEND',
    inviteId: number,
  ) {
    const couponCode = `FRIEND_${type}_${inviteId}_${randomBytes(4).toString('hex').toUpperCase()}`;

    const coupon = await db.coupon.create({
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
        applicablePlans: null, // Aplicável a todos os planos
      },
    });
    await db.userCoupon.create({ data: { userId, couponId: coupon.id } });
    return coupon;
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
        AppName: 'Barbershop',
      },
      {
        pt: 'Convite especial - Ganhe 1 mês grátis no Barbershop',
        en: 'Special invitation - Get 1 month free on Barbershop',
        es: 'Invitación especial - Gana 1 mes gratis en Barbershop',
      },
      `Friend invite sent to ${invite.friendEmail}`,
      invite.friendEmail,
    );
  }

  /**
   * Envia emails de confirmação quando o convite é aceito
   */
  private async sendInviteAcceptedEmails(invite: any, hasBenefits = true) {
    if (hasBenefits) {
      // Email para quem enviou o convite (com benefícios)
      await this.emailService.sendTemplateEmail(
        invite.inviterId,
        'friend_invite_accepted_inviter',
        {
          InviterName: invite.inviter.fullName,
          FriendName: invite.acceptedByUser.fullName,
          CouponCode: invite.inviterCoupon.code,
          AppName: 'Barbershop',
        },
        {
          pt: 'Seu convite foi aceito! - 1 mês grátis',
          en: 'Your invitation was accepted! - 1 month free',
          es: '¡Tu invitación fue aceptada! - 1 mes gratis',
        },
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
          AppName: 'Barbershop',
        },
        {
          pt: 'Convite aceito! - 1 mês grátis',
          en: 'Invitation accepted! - 1 month free',
          es: '¡Invitación aceptada! - 1 mes gratis',
        },
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
          AppName: 'Barbershop',
        },
        {
          pt: 'Seu convite foi aceito!',
          en: 'Your invitation was accepted!',
          es: '¡Tu invitación fue aceptada!',
        },
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
          AppName: 'Barbershop',
        },
        { pt: 'Convite aceito!', en: 'Invitation accepted!', es: '¡Invitación aceptada!' },
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
        AppName: 'Barbershop',
      },
      {
        pt: 'Convite não pode ser usado',
        en: 'Invitation could not be used',
        es: 'La invitación no se pudo usar',
      },
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
        AppName: 'Barbershop',
      },
      {
        pt: 'Convite não pode ser usado',
        en: 'Invitation could not be used',
        es: 'La invitación no se pudo usar',
      },
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
