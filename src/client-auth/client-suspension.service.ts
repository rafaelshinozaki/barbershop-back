import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/email/email.service';
import { normalizeLang } from '@/email/language';
import { supportEmail } from '../common/app-urls';
import { literalSearch } from '../common/search-text';
import { BarbershopService } from '../barbershop/barbershop.service';
import { ClientAuthService } from './client-auth.service';

export type ClubSuspensionOutcome = 'none' | 'period_end' | 'refunded' | 'kept';

const MAX_REASON = 500;

/**
 * Suspensão da conta de cliente pelo admin da plataforma (fraude, abuso,
 * ordem judicial). Suspensa, não entra e as sessões caem na hora; os dados
 * continuam (suspender não é excluir) e a pessoa recebe um e-mail com o
 * motivo e o caminho do suporte. Reativar devolve o acesso.
 */
@Injectable()
export class ClientSuspensionService {
  private readonly logger = new Logger(ClientSuspensionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    @Optional()
    @Inject(forwardRef(() => BarbershopService))
    private readonly shops?: BarbershopService,
    @Optional()
    @Inject(forwardRef(() => ClientAuthService))
    private readonly clients?: ClientAuthService,
  ) {}

  /** Busca de contas pro backoffice (e-mail ou nome), mais recentes primeiro */
  async search(query?: string | null) {
    const q = literalSearch(query);
    const accounts = await this.prisma.clientAccount.findMany({
      where: {
        deletedAt: null,
        ...(query?.trim()
          ? q
            ? {
                OR: [
                  { email: { contains: q, mode: 'insensitive' } },
                  { name: { contains: q, mode: 'insensitive' } },
                ],
              }
            : { id: -1 }
          : {}),
      },
      orderBy: [{ suspendedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 50,
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        emailVerifiedAt: true,
        userId: true,
        suspendedAt: true,
        suspendedReason: true,
        _count: { select: { customers: true } },
      },
    });
    return accounts.map(({ _count, userId, ...a }) => ({
      ...a,
      linkedToStaff: userId != null,
      customerRecords: _count.customers,
    }));
  }

  /** O que a tela mostra antes de suspender: clube ainda cobrando, e o estorno. */
  async preview(clientAccountId: number) {
    const account = await this.prisma.clientAccount.findUnique({ where: { id: clientAccountId } });
    if (!account || account.deletedAt) throw new NotFoundException('Conta não encontrada');
    const subscriptions = this.shops ? await this.shops.accountClubPreview(clientAccountId) : [];
    return { subscriptions };
  }

  async setSuspended(
    adminUserId: number,
    clientAccountId: number,
    suspended: boolean,
    reason?: string | null,
    options?: { cancelSubscriptions?: boolean; refundUnused?: boolean },
  ) {
    const account = await this.prisma.clientAccount.findUnique({ where: { id: clientAccountId } });
    if (!account || account.deletedAt) throw new NotFoundException('Conta não encontrada');
    const text = reason?.trim().slice(0, MAX_REASON) || null;
    if (!suspended) {
      await this.prisma.clientAccount.update({
        where: { id: clientAccountId },
        data: { suspendedAt: null, suspendedReason: null, suspendedByUserId: null },
      });
      this.logger.log(`Conta de cliente ${clientAccountId} reativada pelo admin ${adminUserId}`);
      return true;
    }
    const first = !account.suspendedAt;
    // Cancela antes de gravar a suspensão: se o Stripe falhar, a conta continua
    // entrando e dá pra tentar de novo. O padrão é parar a cobrança.
    const club = first
      ? await this.settleClub(clientAccountId, {
          cancelSubscriptions: options?.cancelSubscriptions !== false,
          refundUnused: options?.refundUnused === true,
        })
      : 'none';
    await this.prisma.clientAccount.update({
      where: { id: clientAccountId },
      data: {
        suspendedAt: account.suspendedAt ?? new Date(),
        suspendedReason: text,
        suspendedByUserId: adminUserId,
        // As sessões abertas caem na hora
        sessionVersion: { increment: 1 },
      },
    });
    await this.prisma.pushSubscription.deleteMany({ where: { clientAccountId } });
    this.logger.log(`Conta de cliente ${clientAccountId} suspensa pelo admin ${adminUserId}`);
    if (first) await this.emailSuspended(clientAccountId, club);
    return true;
  }

  /**
   * Suspensão gravada pela API do backoffice (o banco já mudou). Cancela o
   * clube, se foi pedido, e manda o e-mail. Sem o campo, também cancela no
   * fim do período: o comando antigo só avisava e a cobrança seguia.
   */
  async handleExternalSuspension(
    clientAccountId: number,
    options?: { cancelSubscriptions?: boolean; refundUnused?: boolean },
  ) {
    const club = await this.settleClub(clientAccountId, {
      cancelSubscriptions: options?.cancelSubscriptions !== false,
      refundUnused: options?.refundUnused === true,
    });
    await this.emailSuspended(clientAccountId, club);
  }

  private async settleClub(
    clientAccountId: number,
    options: { cancelSubscriptions: boolean; refundUnused: boolean },
  ): Promise<ClubSuspensionOutcome> {
    if (!this.shops) return 'none';
    const subscriptions = await this.shops.accountClubPreview(clientAccountId);
    if (subscriptions.length === 0) return 'none';
    if (!options.cancelSubscriptions) return 'kept';
    await this.shops.cancelAccountClub(clientAccountId, options.refundUnused);
    return options.refundUnused ? 'refunded' : 'period_end';
  }

  /**
   * Avisa a pessoa da suspensão, com o motivo e o caminho do suporte. Também
   * é o comando client.suspended_email (suspensão gravada pela API do
   * backoffice). Conta que voltou a valer ou não existe: nada a avisar.
   */
  async emailSuspended(clientAccountId: number, club: ClubSuspensionOutcome = 'none') {
    const account = await this.prisma.clientAccount.findUnique({ where: { id: clientAccountId } });
    if (!account?.suspendedAt || account.deletedAt) return;
    const front = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    const deleteUrl = this.clients
      ? await this.clients.createAccountDeletionUrl(clientAccountId).catch((error: unknown) => {
          this.logger.warn(`Link de exclusão não gerado (conta ${clientAccountId}): ${error}`);
          return null;
        })
      : null;
    await this.email
      .sendCustomerEmail(
        null,
        'account_suspended',
        {
          FullName: account.name.split(' ')[0],
          Reason: account.suspendedReason,
          SupportURL: `${front}/support`,
          AppName: 'Barbershop',
          SupportEmail: supportEmail(),
          Year: new Date().getFullYear(),
          ClubPeriodEnd: club === 'period_end',
          ClubRefunded: club === 'refunded',
          ClubKept: club === 'kept',
          DeleteURL: deleteUrl,
        },
        {
          pt: 'Sua conta foi suspensa',
          en: 'Your account was suspended',
          es: 'Tu cuenta fue suspendida',
        },
        'account-suspended',
        account.email,
        normalizeLang(account.language),
      )
      .catch((error: unknown) =>
        this.logger.warn(`Aviso de suspensão não enviado (conta ${clientAccountId}): ${error}`),
      );
  }
}
