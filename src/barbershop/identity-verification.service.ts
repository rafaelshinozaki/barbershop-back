import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';

export type IdentityProvider = 'stripe' | 'fake';
export type IdentityStatus =
  | 'pending'
  | 'processing'
  | 'verified'
  | 'requires_input'
  | 'canceled'
  | 'name_mismatch';

/** Sessões por pessoa em 24h (cada verificação concluída é cobrada pelo Stripe) */
const MAX_SESSIONS_PER_DAY = 3;

/** O que interessa de uma sessão do Stripe Identity (ou do fornecedor falso) */
export type IdentitySession = {
  id: string;
  status: string;
  last_error?: { code?: string | null } | null;
  verified_outputs?: { first_name?: string | null; last_name?: string | null } | null;
};

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/**
 * O nome do documento é o da conta? Primeiro nome igual e o último
 * sobrenome do documento no nome da conta (a conta pode ter menos
 * sobrenomes que o documento, mas não outra pessoa).
 */
export function documentNameMatches(
  accountName: string,
  doc: { first_name?: string | null; last_name?: string | null } | null | undefined,
) {
  const account = normalize(accountName);
  const first = normalize(doc?.first_name ?? '');
  const last = normalize(doc?.last_name ?? '');
  if (!account.length || !first.length || !last.length) return false;
  return account[0] === first[0] && account.slice(1).includes(last[last.length - 1]);
}

/**
 * Verificação de identidade do profissional que atende a domicílio (H4):
 * documento com foto e selfie ao vivo no Stripe Identity. Só quem ligou
 * "Atendo a domicílio" verifica, e o domicílio só aparece no perfil depois
 * de verificado. Aqui fica só o resultado e o id da sessão; as imagens
 * ficam no Stripe e são apagadas na exclusão da conta.
 *
 * Fora de produção o padrão é um fornecedor falso (pra desenvolvimento e
 * testes); em produção é sempre o Stripe.
 */
@Injectable()
export class IdentityVerificationService {
  private readonly logger = new Logger(IdentityVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly config: ConfigService,
  ) {}

  provider(): IdentityProvider {
    if (this.config.get<string>('NODE_ENV') === 'production') return 'stripe';
    return this.config.get<string>('IDENTITY_PROVIDER') === 'stripe' ? 'stripe' : 'fake';
  }

  private frontendUrl() {
    return (this.config.get<string>('FRONTEND_URL') || 'http://localhost:5173').replace(/\/$/, '');
  }

  async status(userId: number) {
    const [user, professional, last] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { identityVerifiedAt: true } }),
      this.prisma.professional.findUnique({
        where: { userId },
        select: { offersHomeService: true },
      }),
      this.prisma.identityVerification.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      offersHomeService: !!professional?.offersHomeService,
      verified: !!user?.identityVerifiedAt,
      verifiedAt: user?.identityVerifiedAt ?? null,
      status: (last?.status as IdentityStatus | undefined) ?? null,
      lastErrorCode: last?.lastErrorCode ?? null,
    };
  }

  /** Abre uma sessão e devolve o link da página de verificação */
  async start(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, identityVerifiedAt: true, professional: true },
    });
    if (!user) throw new NotFoundException('Conta não encontrada');
    if (!user.professional?.offersHomeService) {
      throw new BadRequestException(
        'A verificação de identidade é para quem atende a domicílio: ligue "Atendo a domicílio" no perfil antes.',
      );
    }
    if (user.identityVerifiedAt)
      throw new BadRequestException('Sua identidade já está verificada.');
    const recent = await this.prisma.identityVerification.count({
      where: { userId, createdAt: { gte: new Date(Date.now() - 86_400_000) } },
    });
    if (recent >= MAX_SESSIONS_PER_DAY) {
      throw new BadRequestException('Muitas tentativas hoje. Tente de novo amanhã.');
    }

    const provider = this.provider();
    let sessionId: string;
    let url: string;
    if (provider === 'stripe') {
      const session = await this.stripe.createIdentitySession({
        userId,
        email: user.email,
        returnUrl: `${this.frontendUrl()}/profile-privacy?identity=return`,
      });
      sessionId = session.id;
      url = session.url ?? '';
    } else {
      sessionId = `fake_${randomBytes(12).toString('hex')}`;
      url = `${this.frontendUrl()}/identity/fake?session=${sessionId}`;
    }
    await this.prisma.identityVerification.create({
      data: { userId, provider, sessionId, status: 'pending' },
    });
    return { url };
  }

  /** Webhook do Stripe (identity.verification_session.*): busca a sessão e aplica */
  async handleStripeSession(sessionId: string) {
    const record = await this.prisma.identityVerification.findUnique({ where: { sessionId } });
    if (!record) {
      this.logger.warn(`Sessão de identidade desconhecida: ${sessionId}`);
      return;
    }
    const session = await this.stripe.retrieveIdentitySession(sessionId);
    await this.apply(session as unknown as IdentitySession);
  }

  /**
   * Aplica o estado da sessão. Verificado só com o nome do documento batendo
   * com o da conta: senão alguém se verificaria com o documento (e a selfie)
   * de outra pessoa.
   */
  async apply(session: IdentitySession) {
    const record = await this.prisma.identityVerification.findUnique({
      where: { sessionId: session.id },
      include: { user: { select: { id: true, fullName: true } } },
    });
    if (!record) return;
    // Reenvio do mesmo evento depois de decidido: nada muda
    if (record.status === 'verified' || record.status === 'name_mismatch') return;

    const known: Record<string, IdentityStatus> = {
      processing: 'processing',
      requires_input: 'requires_input',
      canceled: 'canceled',
      verified: 'verified',
    };
    let status = known[session.status];
    if (!status) return;
    const now = new Date();
    if (
      status === 'verified' &&
      !documentNameMatches(record.user.fullName, session.verified_outputs)
    ) {
      status = 'name_mismatch';
    }
    await this.prisma.identityVerification.update({
      where: { id: record.id },
      data: {
        status,
        lastErrorCode: status === 'requires_input' ? session.last_error?.code ?? null : null,
        verifiedAt: status === 'verified' ? now : null,
      },
    });
    if (status === 'verified') {
      await this.prisma.user.update({
        where: { id: record.userId },
        data: { identityVerifiedAt: now },
      });
    }
  }

  /** Fornecedor falso (só fora de produção): o teste escolhe o resultado */
  async completeFake(userId: number, sessionId: string, outcome: string) {
    if (this.provider() !== 'fake') throw new BadRequestException('Indisponível.');
    const record = await this.prisma.identityVerification.findUnique({
      where: { sessionId },
      include: { user: { select: { fullName: true } } },
    });
    if (!record || record.userId !== userId || record.provider !== 'fake') {
      throw new NotFoundException('Sessão não encontrada');
    }
    if (!['verified', 'requires_input', 'other_person'].includes(outcome)) {
      throw new BadRequestException('Resultado inválido');
    }
    const [first, ...rest] = record.user.fullName.split(' ');
    await this.apply({
      id: sessionId,
      status: outcome === 'requires_input' ? 'requires_input' : 'verified',
      last_error: outcome === 'requires_input' ? { code: 'document_unverified_other' } : null,
      // "Outra pessoa": documento válido com outro nome
      verified_outputs:
        outcome === 'other_person'
          ? { first_name: 'Fulano', last_name: 'Deoutro' }
          : { first_name: first, last_name: rest.join(' ') || first },
    });
    return true;
  }

  /** Exclusão da conta: apaga no Stripe o que foi enviado e os registros daqui */
  async forgetUser(userId: number) {
    const sessions = await this.prisma.identityVerification.findMany({
      where: { userId, provider: 'stripe' },
      select: { sessionId: true },
    });
    for (const { sessionId } of sessions) {
      await this.stripe.redactIdentitySession(sessionId).catch((error: any) => {
        this.logger.error(`Falha ao apagar a sessão de identidade ${sessionId}: ${error?.message}`);
      });
    }
    await this.prisma.identityVerification.deleteMany({ where: { userId } });
  }
}
