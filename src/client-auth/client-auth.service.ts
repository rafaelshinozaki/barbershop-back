import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { Response } from 'express';
import { PrismaService } from '@/prisma/prisma.service';
import { RedisService } from '@/redis/redis.service';
import { SignupCodes } from '../auth/signup-code';
import { EmailService } from '@/email/email.service';
import { StripeService } from '@/stripe/stripe.service';
import { normalizeLang } from '@/email/language';
import { appointmentReviewUrl } from '../barbershop/appointment-link';
import { claimFichaReviews } from '../barbershop/review-account';
import { ClientAccountDTO } from './dto/client-account.dto';
import { AccountLinkService } from './account-link.service';
import { assertNotSuspended } from './suspension';
import { clientClaims } from '../auth/session-claims';
import { pickSocialLink } from '../auth/social-link';
import { personName, signupPhone } from '../common/person';
import { TERMS_REQUIRED_MESSAGE, TERMS_VERSION } from '../common/terms';
import { dropPushSubscriptions } from '../push/push.service';
import { supportEmail } from '../common/app-urls';
import {
  normalizePhoneToE164,
  phoneDigitVariants,
  whatsappSenderVariants,
} from '../common/phone.util';
import { clientSessionAlive, openClientSession } from './client-session';

export const CLIENT_TOKEN_PURPOSE = {
  VERIFY_EMAIL: 'VERIFY_EMAIL',
  RESET_PASSWORD: 'RESET_PASSWORD',
  // Exclusão da conta pelo link do e-mail (a conta suspensa não entra)
  DELETE_ACCOUNT: 'DELETE_ACCOUNT',
} as const;
type TokenPurpose = (typeof CLIENT_TOKEN_PURPOSE)[keyof typeof CLIENT_TOKEN_PURPOSE];

const VERIFY_EMAIL_TTL_HOURS = 24;
// Mesmo prazo do link de senha do dono (o texto do e-mail fala em "horas")
const RESET_PASSWORD_TTL_HOURS = 2;
// A conta suspensa não entra: o link do e-mail é o caminho da exclusão (LGPD)
const DELETE_ACCOUNT_TTL_HOURS = 24 * 7;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
// Hash de uma senha qualquer, pro login levar o mesmo tempo com e sem conta
const DUMMY_PASSWORD_HASH = '$2a$10$PeSKuJ0PbHqOusQLVmt5vum0Bz05aiX1hAxEcm16nhEuTTbliDMhu';

export type ClientHistoryEntry = {
  id: string;
  type: 'APPOINTMENT' | 'SALE' | 'WALK_IN';
  date: string;
  networkName: string;
  barbershopName: string;
  barbershopSlug?: string;
  detail: string | null;
  status: string;
  total: number | null;
  currency: string | null;
  /** Atendimento: com quem, a nota que o cliente deu, a caixinha e o link de avaliar */
  barberName?: string | null;
  /** Pra "agendar de novo": mesmo profissional e mesmos serviços */
  barberId?: number | null;
  serviceIds?: number[];
  rating?: number | null;
  tip?: number | null;
  reviewUrl?: string | null;
};

function validatePassword(password: string) {
  const hasSpecialCharacter = /[^\w\s]/.test(password);
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasMinLength = password.length >= 8;

  if (!hasSpecialCharacter || !hasUpperCase || !hasLowerCase || !hasNumber || !hasMinLength) {
    throw new BadRequestException(
      'A senha deve ter ao menos 8 caracteres, incluindo maiúscula, minúscula, número e caractere especial.',
    );
  }
}

function toDTO(account: {
  id: number;
  email: string;
  name: string;
  phone: string | null;
  avatarUrl: string | null;
  emailVerifiedAt: Date | null;
  password: string | null;
  userId?: number | null;
}): ClientAccountDTO {
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    phone: account.phone,
    avatarUrl: account.avatarUrl,
    emailVerified: !!account.emailVerifiedAt,
    // Ligada à conta da equipe: entra com a senha dela
    hasPassword: !!account.password || !!account.userId,
    linkedToStaff: !!account.userId,
  };
}

export const CLIENT_SOCIAL_UNLINKED_MESSAGE =
  'Este login social foi desconectado da conta. Entre com a senha (ou outro login) e ligue de novo pela sua conta.';

export const STAFF_TWO_FACTOR_CLIENT_LOGIN_MESSAGE =
  'Esta conta usa verificação em duas etapas. Entre pela área da equipe e abra a área do cliente por lá.';

/**
 * Senha da equipe com verificação em duas etapas: o login do cliente não pede
 * o código, então não entra por aqui (item 484). A conta abre a área do
 * cliente pela área da equipe, depois do código.
 */
function assertNoStaffTwoFactor(staff: { twoFactorEnabled: boolean }) {
  if (staff.twoFactorEnabled)
    throw new UnauthorizedException(STAFF_TWO_FACTOR_CLIENT_LOGIN_MESSAGE);
}

@Injectable()
export class ClientAuthService {
  private readonly logger = new Logger(ClientAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly stripeService: StripeService,
    private readonly accountLink: AccountLinkService,
    // Guarda o código que confirma o e-mail no cadastro
    @Optional() private readonly redis?: RedisService,
  ) {}

  // Liga as fichas (Customer) órfãs de qualquer negócio da plataforma com
  // este e-mail à conta — é isso que dá o histórico "cross-negócio". Só com
  // o e-mail CONFIRMADO: antes ligava pelo e-mail/telefone digitado no
  // cadastro, e bastava cadastrar o e-mail de outra pessoa pra ver onde, quando
  // e quanto ela gastou. Telefone não liga nada (não há como confirmar).
  /**
   * Liga à conta as fichas com o mesmo e-mail confirmado. O e-mail da ficha
   * foi digitado pela equipe (ou veio da página) sem confirmação: um erro de
   * digitação entregava a ficha de outra pessoa a quem tem o endereço. Por
   * isso o telefone da conta também tem de ser o da ficha (item 251).
   */
  private async linkVerifiedCustomers(account: {
    id: number;
    email: string;
    emailVerifiedAt: Date | null;
    phone?: string | null;
  }) {
    if (!account.emailVerifiedAt) return;
    const accountPhones = new Set(phoneDigitVariants(account.phone));
    if (!accountPhones.size) return;
    const candidates = await this.prisma.customer.findMany({
      where: {
        clientAccountId: null,
        deletedAt: null,
        email: { equals: account.email, mode: 'insensitive' },
      },
      select: { id: true, phone: true },
    });
    const ids = candidates
      .filter((c) => phoneDigitVariants(c.phone).some((v) => v.length >= 8 && accountPhones.has(v)))
      .map((c) => c.id);
    if (!ids.length) return;
    await this.prisma.customer.updateMany({
      where: { id: { in: ids }, clientAccountId: null },
      data: { clientAccountId: account.id },
    });
    await claimFichaReviews(this.prisma, account.id, ids);
  }

  /** Cria um link de uso único (só o hash fica no banco) e devolve o token. */
  private async createToken(clientAccountId: number, purpose: TokenPurpose, ttlHours: number) {
    // Um link válido por vez: pedir outro invalida os anteriores
    await this.prisma.clientAccountToken.updateMany({
      where: { clientAccountId, purpose, usedAt: null },
      data: { usedAt: new Date() },
    });
    const token = randomBytes(32).toString('base64url');
    await this.prisma.clientAccountToken.create({
      data: {
        clientAccountId,
        purpose,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + ttlHours * 3600_000),
      },
    });
    return token;
  }

  /** Consome o token (uma vez só); inválido, usado ou vencido → erro. */
  private async consumeToken(token: string, purpose: TokenPurpose) {
    const record = await this.prisma.clientAccountToken.findUnique({
      where: { tokenHash: hashToken(token || '') },
      include: { clientAccount: true },
    });
    const invalid = new BadRequestException('Link inválido ou vencido. Peça um novo.');
    if (!record || record.purpose !== purpose || record.usedAt || record.expiresAt < new Date()) {
      throw invalid;
    }
    // Marca como usado só se ninguém usou antes (duas abas ao mesmo tempo)
    const { count } = await this.prisma.clientAccountToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (count === 0) throw invalid;
    return record.clientAccount;
  }

  private frontendUrl() {
    return this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
  }

  /** Envia o link de confirmação; falha de envio não derruba quem chamou. */
  async sendVerificationEmail(account: {
    id: number;
    email: string;
    name: string;
    language: string | null;
    emailVerifiedAt: Date | null;
  }) {
    if (account.emailVerifiedAt) return;
    const token = await this.createToken(
      account.id,
      CLIENT_TOKEN_PURPOSE.VERIFY_EMAIL,
      VERIFY_EMAIL_TTL_HOURS,
    );
    try {
      await this.emailService.sendCustomerEmail(
        null,
        'verify_email',
        {
          FullName: account.name,
          AppName: 'Barbershop',
          VerifyURL: `${this.frontendUrl()}/client/verify-email?token=${token}`,
          SupportEmail: supportEmail(),
          Year: new Date().getFullYear(),
        },
        { pt: 'Confirme seu e-mail', en: 'Confirm your email', es: 'Confirma tu correo' },
        'client-verify-email',
        account.email,
        normalizeLang(account.language),
      );
    } catch (error) {
      this.logger.error(`Falha ao enviar confirmação de e-mail do cliente ${account.id}: ${error}`);
    }
  }

  /**
   * Conta de cliente recém-criada a partir da conta da equipe: com o e-mail
   * já confirmado, liga as fichas na hora; sem, manda o link de confirmação
   * (o histórico das barbearias só aparece depois de confirmar)
   */
  async welcomeLinkedAccount(account: {
    id: number;
    email: string;
    name: string;
    language: string | null;
    emailVerifiedAt: Date | null;
    phone: string | null;
  }) {
    if (account.emailVerifiedAt) await this.linkVerifiedCustomers(account);
    else await this.sendVerificationEmail(account);
  }

  async resendVerificationEmail(clientAccountId: number) {
    const account = await this.prisma.clientAccount.findUnique({ where: { id: clientAccountId } });
    if (!account) throw new UnauthorizedException('Conta não encontrada.');
    await this.sendVerificationEmail(account);
  }

  async verifyEmail(token: string) {
    const account = await this.consumeToken(token, CLIENT_TOKEN_PURPOSE.VERIFY_EMAIL);
    const verified = account.emailVerifiedAt
      ? account
      : await this.prisma.clientAccount.update({
          where: { id: account.id },
          data: { emailVerifiedAt: new Date() },
        });
    await this.linkVerifiedCustomers(verified);
    return verified;
  }

  /**
   * Esqueci a senha: responde igual exista ou não a conta (não dá pra usar
   * pra descobrir quem tem cadastro). Conta só com login social também
   * recebe — o link serve pra ela criar uma senha.
   */
  async requestPasswordReset(email: string) {
    const account = await this.prisma.clientAccount.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!account) {
      this.logger.warn('Redefinição de senha de cliente pedida pra e-mail sem conta');
      return;
    }
    // O link é criado aqui (na ordem dos pedidos: o novo invalida o anterior);
    // só o envio fica em segundo plano — esperar o provedor de e-mail quando a
    // conta existe deixava a resposta mais lenta (dava pra descobrir quem tem
    // conta pelo tempo)
    const token = await this.createToken(
      account.id,
      CLIENT_TOKEN_PURPOSE.RESET_PASSWORD,
      RESET_PASSWORD_TTL_HOURS,
    );
    void this.sendPasswordResetEmail(account, token);
  }

  private async sendPasswordResetEmail(
    account: {
      id: number;
      name: string;
      email: string;
      language: string | null;
    },
    token: string,
  ) {
    try {
      await this.emailService.sendCustomerEmail(
        null,
        'password_reset',
        {
          FullName: account.name,
          AppName: 'Barbershop',
          ResetURL: `${this.frontendUrl()}/client/reset-password?token=${token}`,
          ExpirationHours: RESET_PASSWORD_TTL_HOURS,
          SupportEmail: supportEmail(),
          Year: new Date().getFullYear(),
        },
        { pt: 'Redefinição de senha', en: 'Password reset', es: 'Restablecimiento de contraseña' },
        'client-password-reset',
        account.email,
        normalizeLang(account.language),
      );
    } catch (error) {
      this.logger.error(`Falha ao enviar redefinição de senha do cliente ${account.id}: ${error}`);
    }
  }

  /**
   * Troca a senha pelo link do e-mail. O link prova que a pessoa tem acesso
   * ao e-mail, então também confirma o e-mail — e derruba as sessões abertas
   * (quem tinha cadastrado o e-mail de outra pessoa perde o acesso).
   */
  async resetPassword(token: string, newPassword: string) {
    validatePassword(newPassword);
    const account = await this.consumeToken(token, CLIENT_TOKEN_PURPOSE.RESET_PASSWORD);
    const passwordHash = await bcrypt.hash(newPassword, 10);
    // Ligada à conta da equipe: a senha nova é a dela (vale nas duas telas),
    // e as sessões da equipe também caem
    const staff = await this.accountLink.linkedStaff(account.userId);
    if (staff) {
      await this.prisma.user.update({ where: { id: staff.id }, data: { password: passwordHash } });
      await this.prisma.activeSession.deleteMany({ where: { userId: staff.id } });
      await this.prisma.passwordResetToken.updateMany({
        where: { userId: staff.id, used: false },
        data: { used: true },
      });
    }
    const updated = await this.prisma.clientAccount.update({
      where: { id: account.id },
      data: {
        password: staff ? null : passwordHash,
        emailVerifiedAt: account.emailVerifiedAt ?? new Date(),
        sessionVersion: { increment: 1 },
      },
    });
    // Senha redefinida: os aparelhos derrubados param de receber os avisos
    await dropPushSubscriptions(this.prisma, { clientAccountIds: [account.id] });
    await this.prisma.clientAccountToken.updateMany({
      where: { clientAccountId: account.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    await this.linkVerifiedCustomers(updated);
    return updated;
  }

  async signup(
    email: string,
    password: string,
    name: string,
    phone?: string,
    language?: string,
    emailCode?: string,
    acceptedTerms?: boolean,
  ) {
    const normalizedEmail = email.trim().toLowerCase();
    // A conta só é criada com o código enviado ao e-mail (requestSignupCode),
    // conferido antes de dizer se o e-mail já tem conta. Antes, qualquer um
    // criava a conta com o e-mail de outra pessoa (a confirmação vinha
    // depois, por link, com a conta já ocupando o e-mail)
    validatePassword(password);
    const displayName = personName(name);
    const codes = new SignupCodes(this.redis, this.emailService);
    await codes.check(normalizedEmail, emailCode);
    if (acceptedTerms !== true) throw new BadRequestException(TERMS_REQUIRED_MESSAGE);

    const existing = await this.prisma.clientAccount.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      throw new ConflictException('Já existe uma conta com este email.');
    }

    // Quem já é da equipe e cadastra a mesma senha: nasce ligada (a senha é a prova)
    const staff = await this.accountLink.staffByEmail(normalizedEmail);
    const sameAsStaff =
      !!staff && (await this.accountLink.staffPasswordMatches(staff, password, { count: false }));
    const passwordHash = await bcrypt.hash(password, 10);
    await codes.consume(normalizedEmail);
    const account = await this.prisma.clientAccount.create({
      data: {
        email: normalizedEmail,
        // E-mail confirmado pelo código
        emailVerifiedAt: new Date(),
        password: sameAsStaff ? null : passwordHash,
        name: displayName,
        phone: phone?.trim() ? signupPhone(phone) : null,
        termsAcceptedAt: new Date(),
        termsVersion: TERMS_VERSION,
        language: language ? normalizeLang(language) : null,
        ...(sameAsStaff && staff ? { userId: staff.id, linkedAt: new Date() } : {}),
      },
    });

    // E-mail confirmado: as fichas com este e-mail já entram no histórico
    await this.linkVerifiedCustomers(account);

    return account;
  }

  /**
   * Login na área do cliente. Ligada à conta da equipe: vale a senha dela.
   * Sem conta de cliente mas com conta da equipe (mesma senha): cria a de
   * cliente já ligada. Com as duas soltas e a mesma senha nas duas: liga.
   */
  async validateCredentials(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const found = await this.prisma.clientAccount.findUnique({
      where: { email: normalizedEmail },
    });
    const invalid = () => new UnauthorizedException('Email ou senha inválidos.');
    let account = found;

    if (!account) {
      const staff = await this.accountLink.staffByEmail(normalizedEmail);
      if (!staff || !(await this.accountLink.staffPasswordMatches(staff, password))) {
        // Mesmo custo de uma senha errada: a resposta rápida denunciaria que o
        // e-mail não tem conta
        if (!staff) await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
        throw invalid();
      }
      assertNoStaffTwoFactor(staff);
      account = await this.prisma.clientAccount.create({
        data: {
          email: normalizedEmail,
          name: staff.fullName,
          phone: staff.phone || null,
          userId: staff.id,
          linkedAt: new Date(),
          // E-mail da equipe confirmado vale aqui (item 349)
          emailVerifiedAt: staff.emailVerifiedAt ?? null,
        },
      });
      await this.welcomeLinkedAccount(account);
      return account;
    }

    if (account.userId) {
      const staff = await this.accountLink.linkedStaff(account.userId);
      if (!staff || !(await this.accountLink.staffPasswordMatches(staff, password))) {
        if (!staff) await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
        throw invalid();
      }
      assertNoStaffTwoFactor(staff);
    } else {
      if (!account.password) {
        throw new UnauthorizedException(
          'Esta conta usa login social. Entre com Google, Facebook ou Apple.',
        );
      }
      const matches = await bcrypt.compare(password, account.password);
      if (!matches) throw invalid();
      // A mesma senha na conta da equipe com este e-mail: prova que é a mesma pessoa
      const staff = await this.accountLink.staffByEmail(normalizedEmail);
      if (
        staff &&
        (await this.accountLink.staffPasswordMatches(staff, password, { count: false }))
      ) {
        const taken = await this.prisma.clientAccount.findFirst({
          where: { userId: staff.id },
          select: { id: true },
        });
        if (!taken) account = await this.accountLink.link(account.id, staff);
      }
    }

    // Senha certa, conta suspensa: diz o motivo em vez de "senha inválida"
    assertNotSuspended(account);

    // Fichas criadas desde o último login (se o e-mail já está confirmado)
    await this.linkVerifiedCustomers(account);

    return account;
  }

  // Login/cadastro social (Google/Facebook/Apple) sem sessão ativa — mesma
  // lógica de "achar ou criar" da conta de staff (ver UserService), adaptada
  // para ClientAccount: se o provider+email já está linkado, entra direto;
  // se já existe uma conta com esse email (senha ou outro provider), conecta
  // este método a ela em vez de criar uma segunda conta; senão cria nova.
  async findOrCreateSocialAccount(
    email: string,
    name: string,
    provider: string,
    providerUserId?: string | null,
    acceptedTerms = false,
  ) {
    const normalizedEmail = email.trim().toLowerCase();

    // A pessoa no provedor (id dela lá) primeiro. O e-mail só casa com
    // vínculo antigo, sem id (itens 271 e 293).
    const byId = providerUserId
      ? await this.prisma.clientLinkedSocialAccount.findFirst({
          where: { provider, providerUserId },
        })
      : null;
    const byEmail = byId
      ? null
      : await this.prisma.clientLinkedSocialAccount.findUnique({
          where: { provider_providerEmail: { provider, providerEmail: normalizedEmail } },
        });
    const existingLink = pickSocialLink(byId, byEmail, providerUserId);
    if (existingLink && providerUserId && !existingLink.providerUserId) {
      await this.prisma.clientLinkedSocialAccount
        .update({ where: { id: existingLink.id }, data: { providerUserId } })
        .catch(() => undefined);
    }

    let account = existingLink
      ? await this.prisma.clientAccount.findUnique({ where: { id: existingLink.clientAccountId } })
      : await this.prisma.clientAccount.findFirst({
          where: { email: normalizedEmail },
          orderBy: { createdAt: 'asc' },
        });

    // O provedor confirmou o e-mail. Se a conta existente com esse e-mail
    // ainda não estava confirmada, a senha dela pode ter sido criada por
    // outra pessoa (cadastro com o e-mail alheio): apaga a senha e derruba as
    // sessões, e o dono de verdade fica com a conta.
    // A pessoa desconectou este provedor: o mesmo e-mail não religa sozinho
    // (item 485). Ela entra de outro jeito e liga de novo pela conta
    if (account && !existingLink && account.socialUnlinkedProviders.includes(provider)) {
      throw new UnauthorizedException(CLIENT_SOCIAL_UNLINKED_MESSAGE);
    }

    if (account && !account.emailVerifiedAt && account.email === normalizedEmail) {
      account = await this.prisma.clientAccount.update({
        where: { id: account.id },
        data: { emailVerifiedAt: new Date(), password: null, sessionVersion: { increment: 1 } },
      });
      await dropPushSubscriptions(this.prisma, { clientAccountIds: [account.id] });
    }

    if (account && !existingLink) {
      await this.prisma.clientLinkedSocialAccount
        .create({
          data: {
            clientAccountId: account.id,
            provider,
            providerEmail: normalizedEmail,
            providerUserId,
          },
        })
        .catch(() => {
          // Vínculo já criado por outra requisição simultânea — pode ignorar
        });
    }

    if (!account) {
      if (!acceptedTerms) throw new BadRequestException(TERMS_REQUIRED_MESSAGE);
      account = await this.prisma.clientAccount.create({
        data: {
          email: normalizedEmail,
          name: personName(name || normalizedEmail.split('@')[0]),
          password: null,
          emailVerifiedAt: new Date(),
          termsAcceptedAt: new Date(),
          termsVersion: TERMS_VERSION,
        },
      });
      await this.prisma.clientLinkedSocialAccount.create({
        data: {
          clientAccountId: account.id,
          provider,
          providerEmail: normalizedEmail,
          providerUserId,
        },
      });
    }

    await this.linkVerifiedCustomers(account);
    return account;
  }

  // ============ CAMPANHAS: O QUE A PESSOA QUER RECEBER ============

  /**
   * Campanhas na área do cliente (item 275): por e-mail, uma opção por
   * barbearia (rede) onde a pessoa tem ficha; no WhatsApp, uma só, porque o
   * número de envio é um só da plataforma.
   */
  async marketingPreferences(clientAccountId: number) {
    const account = await this.prisma.clientAccount.findUnique({
      where: { id: clientAccountId },
      select: { phone: true },
    });
    const fichas = await this.prisma.customer.findMany({
      where: { clientAccountId, deletedAt: null },
      select: {
        networkId: true,
        marketingOptOut: true,
        network: {
          select: {
            name: true,
            barbershops: { take: 1, orderBy: { id: 'asc' }, select: { name: true } },
          },
        },
      },
    });
    const byNetwork = new Map<
      number,
      { networkId: number; networkName: string; emailOptOut: boolean }
    >();
    for (const f of fichas) {
      const current = byNetwork.get(f.networkId);
      byNetwork.set(f.networkId, {
        networkId: f.networkId,
        networkName: f.network?.name || f.network?.barbershops[0]?.name || '',
        emailOptOut: (current?.emailOptOut ?? false) || f.marketingOptOut,
      });
    }
    const variants = this.whatsappVariants(account?.phone);
    const rows = variants.length
      ? await this.prisma.whatsappOptOut.findMany({
          where: { phoneDigits: { in: variants } },
          select: { clientAccountId: true },
        })
      : [];
    // Saída pelo WhatsApp ou por outra conta: a tela não mostra como escolha
    // desta conta (o telefone não é confirmado). Só VOLTAR desfaz.
    const whatsappReplyOnly = rows.some((row) => row.clientAccountId !== clientAccountId);
    const whatsappOptOut =
      !whatsappReplyOnly && rows.some((row) => row.clientAccountId === clientAccountId);
    return {
      hasPhone: variants.length > 0,
      whatsappOptOut,
      whatsappReplyOnly,
      networks: [...byNetwork.values()].sort((a, b) => a.networkName.localeCompare(b.networkName)),
    };
  }

  /** Sai (ou volta) das campanhas por e-mail de uma barbearia */
  async setNetworkEmailOptOut(clientAccountId: number, networkId: number, optOut: boolean) {
    const fichas = await this.prisma.customer.findMany({
      where: { clientAccountId, networkId, deletedAt: null },
      select: { id: true, email: true },
    });
    if (!fichas.length) throw new NotFoundException('Barbearia não encontrada');
    const emails = [...new Set(fichas.map((f) => f.email?.trim()).filter((e): e is string => !!e))];
    // As outras fichas da rede com o mesmo e-mail seguem a escolha (como o
    // link do descadastro)
    await this.prisma.customer.updateMany({
      where: {
        networkId,
        deletedAt: null,
        OR: [
          { clientAccountId },
          ...emails.map((email) => ({ email: { equals: email, mode: 'insensitive' as const } })),
        ],
      },
      data: { marketingOptOut: optOut },
    });
    return this.marketingPreferences(clientAccountId);
  }

  /** Sai (ou volta) das campanhas pelo WhatsApp, pelo telefone da conta */
  async setWhatsappOptOut(clientAccountId: number, optOut: boolean) {
    const account = await this.prisma.clientAccount.findUnique({
      where: { id: clientAccountId },
      select: { phone: true },
    });
    const variants = this.whatsappVariants(account?.phone);
    if (!variants.length) {
      throw new BadRequestException(
        'Cadastre o seu telefone na conta para escolher pelo WhatsApp.',
      );
    }
    if (optOut) {
      const existing = await this.prisma.whatsappOptOut.findMany({
        where: { phoneDigits: { in: variants } },
        select: { phoneDigits: true },
      });
      const taken = new Set(existing.map((row) => row.phoneDigits));
      const fresh = variants.filter((phoneDigits) => !taken.has(phoneDigits));
      if (fresh.length) {
        await this.prisma.whatsappOptOut.createMany({
          data: fresh.map((phoneDigits) => ({ phoneDigits, clientAccountId })),
          skipDuplicates: true,
        });
      }
    } else {
      await this.prisma.whatsappOptOut.deleteMany({
        where: { phoneDigits: { in: variants }, clientAccountId },
      });
    }
    return this.marketingPreferences(clientAccountId);
  }

  /** Todas as formas do número (com e sem DDI, com e sem o nono dígito) */
  private whatsappVariants(phone?: string | null): string[] {
    const e164 = normalizePhoneToE164(phone);
    return e164 ? whatsappSenderVariants(e164) : [];
  }

  async getLinkedSocialAccounts(clientAccountId: number) {
    return this.prisma.clientLinkedSocialAccount.findMany({
      where: { clientAccountId },
      select: { provider: true, providerEmail: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Desconectar anota o provedor: o login por ele não religa pelo e-mail (item 485) */
  async unlinkSocialAccount(clientAccountId: number, provider: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.clientLinkedSocialAccount.deleteMany({ where: { clientAccountId, provider } });
      const account = await tx.clientAccount.findUnique({
        where: { id: clientAccountId },
        select: { socialUnlinkedProviders: true },
      });
      if (account && !account.socialUnlinkedProviders.includes(provider)) {
        await tx.clientAccount.update({
          where: { id: clientAccountId },
          data: { socialUnlinkedProviders: { push: provider } },
        });
      }
    });
  }

  // Chamado quando o cliente JÁ está logado e clica em "conectar" um novo
  // método a partir da página de conta.
  async linkSocialAccountToClient(
    clientAccountId: number,
    email: string,
    provider: string,
    providerUserId?: string | null,
  ): Promise<{
    ok: boolean;
    reason?: 'already_linked_elsewhere' | 'email_belongs_to_another_account';
  }> {
    const normalizedEmail = email.trim().toLowerCase();
    const id = providerUserId?.trim() || null;
    // O mesmo id do provedor em outra conta é outra pessoa (item 298).
    if (id) {
      const byId = await this.prisma.clientLinkedSocialAccount.findFirst({
        where: { provider, providerUserId: id },
      });
      if (byId && byId.clientAccountId !== clientAccountId) {
        return { ok: false, reason: 'already_linked_elsewhere' };
      }
    }
    const existingLink = await this.prisma.clientLinkedSocialAccount.findUnique({
      where: { provider_providerEmail: { provider, providerEmail: normalizedEmail } },
    });
    if (existingLink && existingLink.clientAccountId !== clientAccountId) {
      return { ok: false, reason: 'already_linked_elsewhere' };
    }
    if (existingLink?.providerUserId && id && existingLink.providerUserId !== id) {
      return { ok: false, reason: 'already_linked_elsewhere' };
    }
    const own = await this.prisma.clientLinkedSocialAccount.findUnique({
      where: { clientAccountId_provider: { clientAccountId, provider } },
    });
    if (own?.providerUserId && id && own.providerUserId !== id) {
      return { ok: false, reason: 'already_linked_elsewhere' };
    }

    const otherAccountWithEmail = await this.prisma.clientAccount.findFirst({
      where: { email: normalizedEmail, NOT: { id: clientAccountId } },
    });
    if (otherAccountWithEmail) {
      return { ok: false, reason: 'email_belongs_to_another_account' };
    }

    await this.prisma.clientLinkedSocialAccount.upsert({
      where: { clientAccountId_provider: { clientAccountId, provider } },
      create: {
        clientAccountId,
        provider,
        providerEmail: normalizedEmail,
        providerUserId: id,
      },
      update: { providerEmail: normalizedEmail, ...(id ? { providerUserId: id } : {}) },
    });
    // Ligou de novo, logada: o provedor volta a valer no login
    const account = await this.prisma.clientAccount.findUnique({
      where: { id: clientAccountId },
      select: { socialUnlinkedProviders: true },
    });
    if (account?.socialUnlinkedProviders.includes(provider)) {
      await this.prisma.clientAccount.update({
        where: { id: clientAccountId },
        data: {
          socialUnlinkedProviders: account.socialUnlinkedProviders.filter((p) => p !== provider),
        },
      });
    }
    return { ok: true };
  }

  /**
   * Link de uso único pra excluir a conta sem entrar. A suspensão derruba o
   * login; o e-mail é a prova de que a pessoa é a dona.
   */
  async createAccountDeletionUrl(clientAccountId: number) {
    const token = await this.createToken(
      clientAccountId,
      CLIENT_TOKEN_PURPOSE.DELETE_ACCOUNT,
      DELETE_ACCOUNT_TTL_HOURS,
    );
    return `${this.frontendUrl()}/client/delete-account?token=${token}`;
  }

  /** Consome o link e apaga a conta. Abrir o e-mail não apaga: só este método. */
  async deleteAccountByToken(token: string) {
    const account = await this.consumeToken(token, CLIENT_TOKEN_PURPOSE.DELETE_ACCOUNT);
    if (account.deletedAt) throw new BadRequestException('Link inválido ou vencido. Peça um novo.');
    await this.deleteAccount(account.id, {}, { viaLink: true });
  }

  /**
   * Exclusão da conta pelo próprio cliente (LGPD). No app, confirma com a
   * senha (ou, em conta só de login social, digitando o e-mail). Pelo link
   * do e-mail, o token já confirma. Cancela as assinaturas de serviço no
   * Stripe na hora e apaga o cliente lá (cartões salvos); apaga avaliações,
   * favoritos e logins sociais e desliga as fichas das barbearias. A linha
   * da conta fica, anônima, só pra não levar junto os pagamentos que as
   * barbearias receberam (registro fiscal delas).
   */
  async deleteAccount(
    clientAccountId: number,
    confirm: { password?: string; email?: string },
    opts?: { viaLink?: boolean },
  ) {
    const account = await this.prisma.clientAccount.findUnique({
      where: { id: clientAccountId },
      include: { subscriptions: { where: { status: { not: 'CANCELED' } } } },
    });
    if (!account || account.deletedAt) throw new UnauthorizedException('Conta não encontrada.');

    // O link do e-mail já prova a posse. No app, confirma com a senha
    // (ou, em conta só de login social, digitando o e-mail).
    if (!opts?.viaLink) {
      // Ligada à conta da equipe: confirma com a senha dela (a conta da equipe fica)
      const staff = await this.accountLink.linkedStaff(account.userId);
      const passwordHash = staff?.password ?? account.password;
      if (passwordHash) {
        const ok = !!confirm.password && (await bcrypt.compare(confirm.password, passwordHash));
        // 400, não 401: o front trata 401 como sessão vencida e desloga
        if (!ok) throw new BadRequestException('Senha incorreta.');
      } else if ((confirm.email ?? '').trim().toLowerCase() !== account.email) {
        throw new BadRequestException('Digite o e-mail da conta pra confirmar.');
      }
    }

    // Stripe primeiro: se falhar, nada foi apagado e dá pra tentar de novo
    // (cobrança continuando depois da exclusão seria o pior cenário)
    for (const sub of account.subscriptions) {
      try {
        await this.stripeService.cancelSubscription(sub.stripeSubscriptionId);
      } catch (error: any) {
        // Já cancelada/inexistente no Stripe não impede a exclusão
        if (error?.code !== 'resource_missing') throw error;
      }
    }
    if (account.stripeCustomerId) {
      await this.stripeService.deleteCustomer(account.stripeCustomerId).catch((error: any) => {
        if (error?.code !== 'resource_missing') throw error;
      });
    }

    const now = new Date();
    // Conversas dos atendimentos da pessoa (os dois lados saem juntos)
    const customerIds = (
      await this.prisma.customer.findMany({ where: { clientAccountId }, select: { id: true } })
    ).map((c) => c.id);
    await this.prisma.$transaction([
      // Antes de tudo: apagar avaliações e pedidos de suporte não grava
      // histórico (o assunto do pedido é texto livre, com dado pessoal)
      this.prisma.$executeRaw`SELECT set_config('app.change_log_off', 'on', true)`,
      this.prisma.chatThread.deleteMany({ where: { customerId: { in: customerIds } } }),
      // Lista de espera das fichas da conta (e as online com o e-mail dela):
      // sai da fila e o e-mail informado é apagado (item 193)
      this.prisma.waitlistEntry.updateMany({
        where: {
          status: { in: ['WAITING', 'NOTIFIED'] },
          OR: [
            { customerId: { in: customerIds } },
            { contactEmail: { equals: account.email, mode: 'insensitive' } },
          ],
        },
        data: { status: 'CANCELLED', offeredStartAt: null },
      }),
      this.prisma.waitlistEntry.updateMany({
        where: {
          OR: [
            { customerId: { in: customerIds } },
            { contactEmail: { equals: account.email, mode: 'insensitive' } },
          ],
        },
        data: { contactEmail: null },
      }),
      this.prisma.clientSubscription.updateMany({
        where: { clientAccountId, status: { not: 'CANCELED' } },
        data: { status: 'CANCELED', canceledAt: now, cancelAtPeriodEnd: false },
      }),
      this.prisma.review.deleteMany({ where: { clientAccountId } }),
      // As que deixou pelo link do e-mail (ligadas às fichas da conta)
      this.prisma.review.deleteMany({ where: { customer: { clientAccountId } } }),
      // Avaliação do profissional: o texto sai e a ligação com a pessoa também;
      // a nota fica na média dele sem dar pra saber de quem era
      this.prisma.professionalReview.updateMany({
        where: { customer: { clientAccountId } },
        data: { comment: null, customerId: null },
      }),
      // Nota de conduta do cliente sai junto com a conta
      this.prisma.customerRating.deleteMany({ where: { customer: { clientAccountId } } }),
      this.prisma.clientFavorite.deleteMany({ where: { clientAccountId } }),
      this.prisma.clientFavoriteBarber.deleteMany({ where: { clientAccountId } }),
      this.prisma.clientLinkedSocialAccount.deleteMany({ where: { clientAccountId } }),
      this.prisma.clientAccountToken.deleteMany({ where: { clientAccountId } }),
      this.prisma.supportTicket.deleteMany({ where: { clientAccountId } }),
      this.prisma.pushSubscription.deleteMany({ where: { clientAccountId } }),
      this.prisma.customer.updateMany({
        where: { clientAccountId },
        data: { clientAccountId: null },
      }),
      // Histórico das unidades: o que o cliente fez fica, sem o nome
      this.prisma.changeLog.updateMany({
        where: { actorType: 'client', actorId: clientAccountId },
        data: { actorName: null },
      }),
      // O histórico da própria conta tem nome e e-mail antigos (e esta
      // exclusão não grava um novo)
      this.prisma.changeLog.deleteMany({
        where: { entityType: 'ClientAccount', entityId: String(clientAccountId) },
      }),
      this.prisma.clientAccount.update({
        where: { id: clientAccountId },
        data: {
          // E-mail liberado (dá pra criar conta nova com ele) e nada que
          // identifique a pessoa
          email: `excluida-${clientAccountId}@conta-excluida.invalid`,
          name: 'Conta excluída',
          phone: null,
          avatarUrl: null,
          password: null,
          stripeCustomerId: null,
          language: null,
          emailVerifiedAt: null,
          deletedAt: now,
          // A conta da equipe continua; só a ligação sai
          userId: null,
          linkedAt: null,
          sessionVersion: { increment: 1 },
        },
      }),
    ]);
    this.logger.log(`Conta de cliente ${clientAccountId} excluída pelo titular`);
  }

  /**
   * Cliente logado (cookie ClientAuthentication), sem exigir login: quem não
   * tem conta segue pelo link do e-mail. Cookie de sessão encerrada não vale.
   */
  async optionalClientAccountId(req: any): Promise<number | undefined> {
    const token = req?.cookies?.ClientAuthentication;
    if (!token) return undefined;
    try {
      const decoded = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
      const claims = clientClaims(decoded);
      if (!claims) return undefined;
      const account = await this.prisma.clientAccount.findUnique({
        where: { id: claims.clientAccountId },
        select: { sessionVersion: true, deletedAt: true, suspendedAt: true },
      });
      return account &&
        !account.deletedAt &&
        !account.suspendedAt &&
        claims.v === account.sessionVersion &&
        (await clientSessionAlive(this.prisma, claims.clientAccountId, claims.sid))
        ? claims.clientAccountId
        : undefined;
    } catch {
      return undefined;
    }
  }

  /** Abre a sessão do cliente (30 dias, renovada enquanto usa; item 272) */
  async issueCookie(account: { id: number; email: string; sessionVersion: number }, res: Response) {
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    await openClientSession(this.prisma, this.jwtService, res, account, isProduction);
  }

  /** "Sair": encerra só esta sessão (o token copiado deixa de valer) */
  async endSession(req: any, res: Response) {
    const token = req?.cookies?.ClientAuthentication;
    if (token) {
      try {
        const decoded = this.jwtService.verify(token, {
          secret: this.configService.get<string>('JWT_SECRET'),
        }) as { sid?: string };
        if (decoded?.sid) {
          await this.prisma.clientSession.deleteMany({ where: { sid: decoded.sid } });
        }
      } catch {
        // Token já inválido: só apaga o cookie
      }
    }
    this.clearCookie(res);
  }

  clearCookie(res: Response) {
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    res.clearCookie('ClientAuthentication', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
    });
  }

  async getById(clientAccountId: number) {
    const account = await this.prisma.clientAccount.findUnique({ where: { id: clientAccountId } });
    if (!account || account.deletedAt) throw new UnauthorizedException('Conta não encontrada.');
    return toDTO(account);
  }

  /** O cliente muda o próprio nome e telefone (o e-mail não muda por aqui) */
  async updateProfile(clientAccountId: number, name: string, phone?: string | null) {
    const account = await this.prisma.clientAccount.findUnique({ where: { id: clientAccountId } });
    if (!account || account.deletedAt) throw new UnauthorizedException('Conta não encontrada.');
    const updated = await this.prisma.clientAccount.update({
      where: { id: clientAccountId },
      data: {
        name: personName(name),
        phone: phone?.trim() ? signupPhone(phone) : null,
      },
    });
    // Telefone novo pode ser o que faltava para ligar as fichas (item 251)
    if ((updated.phone ?? '') !== (account.phone ?? '')) {
      await this.linkVerifiedCustomers(updated);
    }
    return toDTO(updated);
  }

  async listFavorites(clientAccountId: number) {
    const favorites = await this.prisma.clientFavorite.findMany({
      where: { clientAccountId },
      include: { network: true },
      orderBy: { createdAt: 'desc' },
    });
    return favorites.map((f) => f.network);
  }

  async addFavorite(clientAccountId: number, networkId: number) {
    const network = await this.prisma.network.findFirst({
      where: {
        id: networkId,
        platformSuspendedAt: null,
        barbershops: { some: { isActive: true, closedAt: null, platformSuspendedAt: null } },
      },
      select: { id: true },
    });
    if (!network) throw new NotFoundException('Rede não encontrada');
    await this.prisma.clientFavorite.upsert({
      where: { clientAccountId_networkId: { clientAccountId, networkId } },
      create: { clientAccountId, networkId },
      update: {},
    });
    return this.listFavorites(clientAccountId);
  }

  async removeFavorite(clientAccountId: number, networkId: number) {
    await this.prisma.clientFavorite.deleteMany({ where: { clientAccountId, networkId } });
    return this.listFavorites(clientAccountId);
  }

  /**
   * Profissionais favoritos (na unidade em que atendem). "available" diz se
   * ainda dá pra agendar com ele ali: ativo, atende clientes e unidade ativa.
   */
  async listFavoriteBarbers(clientAccountId: number) {
    const rows = await this.prisma.clientFavoriteBarber.findMany({
      where: { clientAccountId },
      orderBy: { createdAt: 'desc' },
      include: {
        barber: {
          select: {
            id: true,
            name: true,
            isActive: true,
            staffType: true,
            takesAppointments: true,
            barbershop: { select: { name: true, slug: true, isActive: true } },
          },
        },
      },
    });
    return rows.map(({ barber }) => ({
      barberId: barber.id,
      name: barber.name,
      barbershopName: barber.barbershop.name,
      barbershopSlug: barber.barbershop.slug,
      available:
        barber.isActive &&
        barber.barbershop.isActive &&
        (barber.takesAppointments ?? barber.staffType !== 'reception'),
    }));
  }

  async addFavoriteBarber(clientAccountId: number, barberId: number) {
    const barber = await this.prisma.barber.findFirst({
      where: { id: barberId, isActive: true, barbershop: { isActive: true } },
      select: { id: true },
    });
    if (!barber) throw new NotFoundException('Profissional não encontrado');
    await this.prisma.clientFavoriteBarber.upsert({
      where: { clientAccountId_barberId: { clientAccountId, barberId } },
      create: { clientAccountId, barberId },
      update: {},
    });
    return this.listFavoriteBarbers(clientAccountId);
  }

  async removeFavoriteBarber(clientAccountId: number, barberId: number) {
    await this.prisma.clientFavoriteBarber.deleteMany({ where: { clientAccountId, barberId } });
    return this.listFavoriteBarbers(clientAccountId);
  }

  async searchNetworks(query: string) {
    const q = query.trim();
    if (q.length < 2) return [];
    return this.prisma.network.findMany({
      where: {
        name: { contains: q, mode: 'insensitive' },
        platformSuspendedAt: null,
        barbershops: { some: { isActive: true, closedAt: null, platformSuspendedAt: null } },
      },
      take: 15,
      orderBy: { name: 'asc' },
    });
  }

  async getHistory(clientAccountId: number): Promise<ClientHistoryEntry[]> {
    const customers = await this.prisma.customer.findMany({
      where: { clientAccountId },
      select: { id: true, network: { select: { name: true } } },
    });
    if (customers.length === 0) return [];

    const customerIds = customers.map((c) => c.id);
    const networkNameByCustomer = new Map(
      customers.map((c) => [c.id, c.network?.name ?? 'Negócio']),
    );

    const [appointments, sales, walkIns] = await Promise.all([
      // Só o que já passou: os próximos ficam em "Próximos horários" (antes
      // apareciam de novo no topo do histórico, com "Agendar de novo")
      this.prisma.appointment.findMany({
        where: { customerId: { in: customerIds }, startAt: { lt: new Date() } },
        include: {
          // Cada unidade tem a própria moeda (a da rede pode ser outra)
          barbershop: { select: { name: true, slug: true, currency: true } },
          services: { include: { service: { select: { name: true } } } },
          barber: { select: { name: true } },
          professionalReview: { select: { rating: true } },
          tips: { select: { amount: true } },
        },
        orderBy: { startAt: 'desc' },
        take: 50,
      }),
      this.prisma.sale.findMany({
        where: { customerId: { in: customerIds }, paymentStatus: 'PAID' },
        include: { barbershop: { select: { name: true, currency: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.walkIn.findMany({
        where: { customerId: { in: customerIds } },
        include: { barbershop: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    const entries: ClientHistoryEntry[] = [];

    appointments.forEach((a) => {
      const serviceNames = a.services
        .map((s) => s.service?.name)
        .filter(Boolean)
        .join(', ');
      entries.push({
        id: `apt-${a.id}`,
        type: 'APPOINTMENT',
        date: a.startAt.toISOString(),
        networkName: networkNameByCustomer.get(a.customerId) ?? 'Negócio',
        barbershopName: a.barbershop.name,
        barbershopSlug: a.barbershop.slug,
        detail: serviceNames || null,
        status: a.status,
        total: null,
        currency: a.barbershop.currency,
        barberName: a.barber?.name ?? null,
        barberId: a.barberId,
        serviceIds: a.services.map((s) => s.serviceId),
        rating: a.professionalReview?.rating ?? null,
        tip: a.tips.length ? a.tips.reduce((sum, t) => sum + Number(t.amount), 0) : null,
        reviewUrl:
          a.status === 'COMPLETED' ? appointmentReviewUrl(a.id, undefined, a.linkVersion) : null,
      });
    });

    sales.forEach((s) => {
      entries.push({
        id: `sale-${s.id}`,
        type: 'SALE',
        date: s.createdAt.toISOString(),
        networkName: s.customerId
          ? networkNameByCustomer.get(s.customerId) ?? 'Negócio'
          : 'Negócio',
        barbershopName: s.barbershop.name,
        detail: null,
        status: s.paymentStatus,
        total: Number(s.total),
        currency: s.barbershop.currency,
      });
    });

    walkIns.forEach((w) => {
      entries.push({
        id: `walkin-${w.id}`,
        type: 'WALK_IN',
        date: w.createdAt.toISOString(),
        networkName: w.customerId
          ? networkNameByCustomer.get(w.customerId) ?? 'Negócio'
          : 'Negócio',
        barbershopName: w.barbershop.name,
        detail: null,
        status: w.status,
        total: null,
        currency: null,
      });
    });

    return entries
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 50);
  }
}
