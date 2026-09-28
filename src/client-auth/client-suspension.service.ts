import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/email/email.service';
import { normalizeLang } from '@/email/language';

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

  constructor(private readonly prisma: PrismaService, private readonly email: EmailService) {}

  /** Busca de contas pro backoffice (e-mail ou nome), mais recentes primeiro */
  async search(query?: string | null) {
    const q = query?.trim();
    const accounts = await this.prisma.clientAccount.findMany({
      where: {
        deletedAt: null,
        ...(q
          ? {
              OR: [
                { email: { contains: q, mode: 'insensitive' } },
                { name: { contains: q, mode: 'insensitive' } },
              ],
            }
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

  async setSuspended(
    adminUserId: number,
    clientAccountId: number,
    suspended: boolean,
    reason?: string | null,
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
    this.logger.log(`Conta de cliente ${clientAccountId} suspensa pelo admin ${adminUserId}`);
    if (first) {
      const front = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
      await this.email
        .sendCustomerEmail(
          null,
          'account_suspended',
          {
            FullName: account.name.split(' ')[0],
            Reason: text,
            SupportURL: `${front}/support`,
            AppName: 'Barbershop',
            SupportEmail: 'suporte@barbershop.com.br',
            Year: new Date().getFullYear(),
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
    return true;
  }
}
