import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { S3Service } from '../aws/s3.service';
import { Role } from '../auth/interfaces/roles';
import { PLANO_STATUS } from '../common/contants';
import { BarbershopService } from './barbershop.service';

export interface AccountDeletionPreview {
  /** Unidades que somem junto (a pessoa é dona da rede ou da unidade) */
  barbershops: string[];
  /** Clientes com assinatura de serviço ativa nessas unidades (serão canceladas) */
  activeClientSubscriptions: number;
  /** Conta com senha confirma com a senha; login social, digitando o e-mail */
  requiresPassword: boolean;
  /** Admin do sistema não se exclui por aqui (outro admin faz) */
  blocked: boolean;
}

/**
 * Exclusão da conta pelo próprio titular (LGPD) — dono, gerente ou barbeiro.
 *
 * - Dono: as redes e unidades dele são apagadas junto (clientes, agenda,
 *   vendas…), depois de cancelar no Stripe as assinaturas dos clientes.
 * - Os dados pessoais do usuário são apagados (sessões, histórico de login,
 *   códigos, notificações, e-mails enviados, convites, foto, cliente no
 *   Stripe) e a linha do User fica anônima — não dá pra apagar de verdade
 *   porque faturas e pagamentos do plano (obrigação fiscal) e registros de
 *   caixa de outras empresas (funcionário) apontam pra ela.
 * - Funcionário: o perfil de barbeiro na unidade continua (é registro da
 *   empresa), só desligado da conta.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly s3Service: S3Service,
    private readonly barbershopService: BarbershopService,
  ) {}

  private async loadUser(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    if (!user) throw new UnauthorizedException('Conta não encontrada.');
    return user;
  }

  private async ownedBarbershops(userId: number) {
    const networks = await this.prisma.network.findMany({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    const networkIds = networks.map((n) => n.id);
    const shops = await this.prisma.barbershop.findMany({
      where: { OR: [{ networkId: { in: networkIds } }, { ownerUserId: userId }] },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return { networkIds, shops };
  }

  async preview(userId: number): Promise<AccountDeletionPreview> {
    const user = await this.loadUser(userId);
    const { shops } = await this.ownedBarbershops(userId);
    const activeClientSubscriptions = shops.length
      ? await this.prisma.clientSubscription.count({
          where: { barbershopId: { in: shops.map((s) => s.id) }, status: { not: 'CANCELED' } },
        })
      : 0;
    return {
      barbershops: shops.map((s) => s.name),
      activeClientSubscriptions,
      requiresPassword: user.provider === 'local',
      blocked: user.role?.name === Role.SYSTEM_ADMIN,
    };
  }

  async deleteAccount(userId: number, confirm: { password?: string; email?: string }) {
    const user = await this.loadUser(userId);
    if (user.role?.name === Role.SYSTEM_ADMIN) {
      throw new ForbiddenException(
        'Admin do sistema não pode excluir a própria conta. Peça a outro admin.',
      );
    }
    if (user.provider === 'local') {
      const ok = !!confirm.password && (await bcrypt.compare(confirm.password, user.password));
      // 400, não 401: o front trata 401 como sessão vencida e desloga
      if (!ok) throw new BadRequestException('Senha incorreta.');
    } else if ((confirm.email ?? '').trim().toLowerCase() !== user.email.toLowerCase()) {
      throw new BadRequestException('Digite o e-mail da conta pra confirmar.');
    }

    const { networkIds, shops } = await this.ownedBarbershops(userId);
    const shopIds = shops.map((s) => s.id);

    // Cobranças primeiro (Stripe): se algo falhar aqui, nada foi apagado e
    // dá pra tentar de novo — cobrança seguindo depois da exclusão seria o
    // pior cenário
    await this.barbershopService.cancelClientSubscriptionsOfBarbershops(shopIds);
    await this.barbershopService.cancelChairRentsOfBarbershops(shopIds);
    const activePlans = await this.prisma.subscription.findMany({
      where: { userId, status: PLANO_STATUS.ACTIVE },
    });
    for (const plan of activePlans) {
      if (plan.stripeSubscriptionId) {
        await this.stripeService.cancelSubscription(plan.stripeSubscriptionId).catch((e: any) => {
          if (e?.code !== 'resource_missing') throw e;
        });
      }
    }
    if (user.stripeCustomerId) {
      await this.stripeService.deleteCustomer(user.stripeCustomerId).catch((e: any) => {
        if (e?.code !== 'resource_missing') throw e;
      });
    }
    if (user.photoKey) {
      // Arquivo que ficar pra trás não impede a exclusão
      await this.s3Service.deleteObject(user.photoKey).catch((e) => {
        this.logger.warn(`Foto do usuário ${userId} não foi apagada do S3: ${e}`);
      });
    }

    const now = new Date();
    await this.prisma.$transaction([
      // Negócio do dono (cascade leva clientes, agenda, vendas, equipe…)
      this.prisma.barbershop.deleteMany({ where: { id: { in: shopIds } } }),
      this.prisma.network.deleteMany({ where: { id: { in: networkIds } } }),
      // Plano: cobrança encerrada, registro fica (fiscal)
      this.prisma.subscription.updateMany({
        where: { userId, status: PLANO_STATUS.ACTIVE },
        data: { status: PLANO_STATUS.INACTIVE, cancelationDate: now },
      }),
      // Dados pessoais
      this.prisma.address.deleteMany({ where: { userId } }),
      this.prisma.activeSession.deleteMany({ where: { userId } }),
      this.prisma.loginHistory.deleteMany({ where: { userId } }),
      this.prisma.verificationCode.deleteMany({ where: { userId } }),
      this.prisma.passwordResetToken.deleteMany({ where: { userId } }),
      this.prisma.invalidatedToken.deleteMany({ where: { userId } }),
      this.prisma.linkedSocialAccount.deleteMany({ where: { userId } }),
      this.prisma.userNotification.deleteMany({ where: { userId } }),
      this.prisma.notificationPreference.deleteMany({ where: { userId } }),
      this.prisma.emailLogger.deleteMany({ where: { userId } }),
      // Convites que a pessoa mandou têm o e-mail de terceiros
      this.prisma.friendInvite.deleteMany({ where: { inviterId: userId } }),
      this.prisma.friendInvite.updateMany({
        where: { acceptedByUserId: userId },
        data: { acceptedByUserId: null },
      }),
      this.prisma.employeeInvite.deleteMany({ where: { inviterId: userId } }),
      this.prisma.employeeInvite.updateMany({
        where: { acceptedByUserId: userId },
        data: { acceptedByUserId: null },
      }),
      // Funcionário: perfil de barbeiro fica na empresa, sem a conta
      this.prisma.barber.updateMany({
        where: { userId },
        data: { userId: null, professionalId: null },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          // E-mail liberado pra um cadastro novo; senha impossível de acertar
          email: `excluido-${userId}@conta-excluida.invalid`,
          provider: 'deleted',
          password: await bcrypt.hash(randomBytes(32).toString('hex'), 10),
          fullName: 'Conta excluída',
          idDocNumber: '',
          phone: '',
          gender: '',
          birthdate: new Date(0),
          photoKey: null,
          stripeCustomerId: null,
          twoFactorEnabled: false,
          isActive: false,
          deleted_at: now,
        },
      }),
    ]);
    this.logger.log(
      `Usuário ${userId} excluiu a própria conta (${shopIds.length} unidade(s) apagada(s))`,
    );
  }
}
