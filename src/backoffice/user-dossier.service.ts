import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Ficha da pessoa no backoffice (só leitura): uma conta da plataforma
 * inteira num lugar, para a equipe ajudar sem entrar "como" ela. Conta,
 * cargo e unidades, sessões abertas, últimos logins e pedidos de suporte;
 * plano e cobranças só para quem tem o Financeiro. Sem IP completo, ficha de
 * saúde nem conversa.
 */
@Injectable()
export class UserDossierService {
  constructor(private readonly prisma: PrismaService) {}

  async detail(userId: number, opts: { finance: boolean }) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deleted_at: null },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        isActive: true,
        createdAt: true,
        twoFactorEnabled: true,
        provider: true,
        membership: true,
        proUntil: true,
        role: { select: { name: true } },
      },
    });
    if (!user) throw new NotFoundException('Conta não encontrada');

    const [owned, memberships, sessions, logins, tickets, client] = await Promise.all([
      this.prisma.barbershop.findMany({
        where: { ownerUserId: userId },
        select: { id: true, name: true, city: true, isActive: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.barber.findMany({
        where: { userId },
        select: {
          staffType: true,
          isActive: true,
          accessEndsAt: true,
          barbershop: { select: { id: true, name: true, city: true, isActive: true } },
        },
      }),
      this.prisma.activeSession.findMany({
        where: { userId },
        select: {
          id: true,
          deviceType: true,
          browser: true,
          os: true,
          location: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.loginHistory.findMany({
        where: { userId },
        select: {
          id: true,
          deviceType: true,
          browser: true,
          os: true,
          location: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 15,
      }),
      this.prisma.supportTicket.findMany({
        where: { userId },
        select: { id: true, subject: true, status: true, category: true, lastActivityAt: true },
        orderBy: { lastActivityAt: 'desc' },
        take: 10,
      }),
      this.prisma.clientAccount.findFirst({
        where: { userId, deletedAt: null },
        select: { id: true, suspendedAt: true },
      }),
    ]);

    const units = [
      ...owned.map((b) => ({ ...b, relation: 'owner', staffType: null, accessEndsAt: null })),
      ...memberships
        .filter((m) => !owned.some((o) => o.id === m.barbershop.id))
        .map((m) => ({
          ...m.barbershop,
          isActive: m.barbershop.isActive && m.isActive,
          relation: 'team',
          staffType: m.staffType,
          accessEndsAt: m.accessEndsAt,
        })),
    ];

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      role: user.role?.name ?? '',
      isActive: user.isActive,
      createdAt: user.createdAt,
      twoFactorEnabled: user.twoFactorEnabled,
      provider: user.provider,
      units,
      sessions,
      logins,
      supportTickets: tickets,
      clientAccountId: client?.id ?? null,
      clientSuspended: client?.suspendedAt != null,
      finance: opts.finance ? await this.finance(userId, user) : null,
    };
  }

  private async finance(userId: number, user: { membership: string; proUntil: Date | null }) {
    const subs = await this.prisma.subscription.findMany({
      where: { userId },
      select: {
        id: true,
        status: true,
        startSubDate: true,
        currentPeriodEnd: true,
        cancelationDate: true,
        plan: { select: { name: true } },
        payments: {
          select: { id: true, amount: true, status: true, paymentDate: true },
          orderBy: { paymentDate: 'desc' },
          take: 10,
        },
      },
      orderBy: { startSubDate: 'desc' },
      take: 5,
    });
    const current = subs.find((s) => s.status !== 'canceled') ?? subs[0];
    return {
      membership: user.membership,
      proUntil: user.proUntil,
      planName: current?.plan?.name ?? null,
      subscriptionStatus: current?.status ?? null,
      currentPeriodEnd: current?.currentPeriodEnd ?? null,
      payments: subs
        .flatMap((s) => s.payments)
        .sort((a, b) => b.paymentDate.getTime() - a.paymentDate.getTime())
        .slice(0, 10)
        .map((p) => ({ ...p, amount: Number(p.amount) })),
    };
  }
}
