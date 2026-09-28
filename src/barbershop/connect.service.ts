import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { BarbershopService } from './barbershop.service';
import { stripeConfigured } from './stripe-configured';
import { currentPricing } from '../pricing/pricing';

export type ConnectProvider = 'stripe' | 'fake';
export type PaymentOwnerType = 'barbershop' | 'professional';

/** O que interessa de uma conta do Stripe (ou do fornecedor falso) */
type AccountState = {
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
  requirements?: { disabled_reason?: string | null } | null;
};

// Parte da plataforma: a taxa vem de "Preços e taxas" (src/pricing/pricing.ts)
export { platformFeeCents } from '../pricing/pricing';

/**
 * "Receber pelo app" (Stripe Connect Express), opcional: a unidade abre a
 * conta de recebimento no Stripe (cadastro e documentos na página do
 * Stripe) e o que o cliente paga pelo app (hoje o sinal online) cai direto
 * nela, com a taxa da plataforma descontada pelo próprio Stripe. Estorno e
 * disputa seguem pelo Stripe. Quem não liga continua como antes: o
 * dinheiro entra na plataforma e o repasse é manual, pelo relatório.
 *
 * O profissional também pode ter a própria conta, pra receber a caixinha
 * que o cliente dá pelo app.
 *
 * Fora de produção, sem Stripe configurado, um fornecedor falso faz o papel
 * do Stripe (desenvolvimento e testes).
 */
@Injectable()
export class ConnectService {
  private readonly logger = new Logger(ConnectService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly barbershops: BarbershopService,
    private readonly config: ConfigService,
  ) {}

  provider(): ConnectProvider {
    if (this.config.get<string>('NODE_ENV') === 'production') return 'stripe';
    return stripeConfigured() ? 'stripe' : 'fake';
  }

  private frontendUrl() {
    return (this.config.get<string>('FRONTEND_URL') || 'http://localhost:5173').replace(/\/$/, '');
  }

  private account(ownerType: PaymentOwnerType, ownerId: number) {
    return this.prisma.paymentAccount.findUnique({
      where: { ownerType_ownerId: { ownerType, ownerId } },
    });
  }

  private view(acc: Awaited<ReturnType<ConnectService['account']>>) {
    return {
      connected: !!acc,
      chargesEnabled: !!acc?.chargesEnabled,
      payoutsEnabled: !!acc?.payoutsEnabled,
      detailsSubmitted: !!acc?.detailsSubmitted,
      disabledReason: acc?.disabledReason ?? null,
      feePercentage: currentPricing().platformFeePercent,
    };
  }

  /** Situação da conta de recebimento da unidade (gerente e dono veem) */
  async barbershopStatus(userId: number, barbershopId: number) {
    await this.barbershops.ensureAccess(userId, barbershopId, 'manager');
    return this.view(await this.account('barbershop', barbershopId));
  }

  /**
   * Abre (ou continua) o cadastro da conta de recebimento da unidade. Só o
   * dono: é pra onde vai o dinheiro. Devolve o link da página do Stripe.
   */
  async startBarbershopOnboarding(userId: number, barbershopId: number) {
    const shop = await this.barbershops.ensureAccess(userId, barbershopId, 'owner');
    return this.startOnboarding('barbershop', barbershopId, userId, {
      country: shop.country,
      businessName: shop.name,
      url: `${this.frontendUrl()}/u/${shop.slug}`,
      // Volta pra página Serviços, onde fica o card "Receber pelo app"
      back: `${this.frontendUrl()}/barbershops/${barbershopId}/services`,
    });
  }

  /** Voltou da página do Stripe: busca a situação lá (sem esperar o webhook) */
  async refreshBarbershop(userId: number, barbershopId: number) {
    await this.barbershops.ensureAccess(userId, barbershopId, 'manager');
    return this.refresh('barbershop', barbershopId);
  }

  /** Painel do Stripe da conta (extrato, repasses, dados bancários). Só o dono. */
  async barbershopDashboardLink(userId: number, barbershopId: number) {
    await this.barbershops.ensureAccess(userId, barbershopId, 'owner');
    return this.dashboardLink('barbershop', barbershopId);
  }

  // ---- profissional (caixinha pelo app) ----

  private async professionalOf(userId: number) {
    const professional = await this.prisma.professional.findUnique({
      where: { userId },
      include: { user: { select: { fullName: true } } },
    });
    if (!professional) {
      throw new BadRequestException('Crie o seu perfil de profissional antes.');
    }
    return professional;
  }

  async professionalStatus(userId: number) {
    const professional = await this.professionalOf(userId);
    return this.view(await this.account('professional', professional.id));
  }

  /** Conta de recebimento do próprio profissional (caixinha pelo app) */
  async startProfessionalOnboarding(userId: number) {
    const professional = await this.professionalOf(userId);
    // País: o da unidade onde atende (a conta do Stripe é por país)
    const link = await this.prisma.barber.findFirst({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { barbershop: { select: { country: true } } },
    });
    return this.startOnboarding('professional', professional.id, userId, {
      country: link?.barbershop.country ?? 'BR',
      businessName: professional.user.fullName,
      url: professional.slug ? `${this.frontendUrl()}/p/${professional.slug}` : undefined,
      back: `${this.frontendUrl()}/profile-privacy`,
    });
  }

  async refreshProfessional(userId: number) {
    const professional = await this.professionalOf(userId);
    return this.refresh('professional', professional.id);
  }

  async professionalDashboardLink(userId: number) {
    const professional = await this.professionalOf(userId);
    return this.dashboardLink('professional', professional.id);
  }

  // ---- comum ----

  private async startOnboarding(
    ownerType: PaymentOwnerType,
    ownerId: number,
    userId: number,
    ctx: { country: string; businessName: string; url?: string; back: string },
  ) {
    let acc = await this.account(ownerType, ownerId);
    const provider = this.provider();
    if (!acc) {
      let stripeAccountId: string;
      if (provider === 'stripe') {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { email: true },
        });
        const created = await this.stripe.createConnectAccount({
          country: (ctx.country || 'BR').toUpperCase(),
          email: user?.email,
          businessName: ctx.businessName,
          url: ctx.url,
          metadata: { ownerType, ownerId: String(ownerId) },
        });
        stripeAccountId = created.id;
      } else {
        stripeAccountId = `acct_fake_${randomBytes(8).toString('hex')}`;
      }
      acc = await this.prisma.paymentAccount.create({
        data: { ownerType, ownerId, provider, stripeAccountId, createdByUserId: userId },
      });
    }
    if (acc.provider === 'stripe') {
      const link = await this.stripe.createAccountOnboardingLink(
        acc.stripeAccountId,
        `${ctx.back}?connect=return`,
        `${ctx.back}?connect=refresh`,
      );
      return { url: link.url };
    }
    return {
      url: `${this.frontendUrl()}/connect/fake?account=${
        acc.stripeAccountId
      }&back=${encodeURIComponent(ctx.back)}`,
    };
  }

  private async refresh(ownerType: PaymentOwnerType, ownerId: number) {
    const acc = await this.account(ownerType, ownerId);
    if (acc?.provider === 'stripe') {
      await this.apply(
        await this.stripe.retrieveConnectAccount(acc.stripeAccountId),
        acc.stripeAccountId,
      );
    }
    return this.view(await this.account(ownerType, ownerId));
  }

  private async dashboardLink(ownerType: PaymentOwnerType, ownerId: number) {
    const acc = await this.account(ownerType, ownerId);
    if (!acc?.detailsSubmitted) {
      throw new BadRequestException('Conclua o cadastro no Stripe antes.');
    }
    if (acc.provider !== 'stripe') return { url: `${this.frontendUrl()}/connect/fake?dashboard=1` };
    const link = await this.stripe.createConnectLoginLink(acc.stripeAccountId);
    return { url: link.url };
  }

  /** Webhook account.updated (ou a volta da página): guarda a situação */
  async apply(account: AccountState, stripeAccountId: string) {
    const updated = await this.prisma.paymentAccount.updateMany({
      where: { stripeAccountId },
      data: {
        chargesEnabled: !!account.charges_enabled,
        payoutsEnabled: !!account.payouts_enabled,
        detailsSubmitted: !!account.details_submitted,
        disabledReason: account.requirements?.disabled_reason ?? null,
      },
    });
    if (updated.count === 0) this.logger.warn(`Conta conectada desconhecida: ${stripeAccountId}`);
  }

  /** Fornecedor falso (só fora de produção): o teste conclui o cadastro */
  async completeFake(userId: number, stripeAccountId: string) {
    if (this.provider() !== 'fake') throw new BadRequestException('Indisponível.');
    const acc = await this.prisma.paymentAccount.findUnique({ where: { stripeAccountId } });
    if (!acc || acc.provider !== 'fake') throw new NotFoundException('Conta não encontrada');
    if (acc.ownerType === 'barbershop') {
      await this.barbershops.ensureAccess(userId, acc.ownerId, 'owner');
    } else {
      const professional = await this.prisma.professional.findUnique({ where: { userId } });
      if (professional?.id !== acc.ownerId) throw new NotFoundException('Conta não encontrada');
    }
    await this.apply(
      { charges_enabled: true, payouts_enabled: true, details_submitted: true },
      stripeAccountId,
    );
    return true;
  }

  /** Pra onde vai o pagamento: a conta conectada, se já recebe */
  async destination(ownerType: PaymentOwnerType, ownerId: number): Promise<string | null> {
    const acc = await this.account(ownerType, ownerId);
    return acc?.chargesEnabled && acc.provider === this.provider() ? acc.stripeAccountId : null;
  }

  barbershopDestination(barbershopId: number) {
    return this.destination('barbershop', barbershopId);
  }
}
