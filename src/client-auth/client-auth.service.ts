import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { Response } from 'express';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/email/email.service';
import { StripeService } from '@/stripe/stripe.service';
import { normalizeLang } from '@/email/language';
import { ClientAccountDTO } from './dto/client-account.dto';

export const CLIENT_TOKEN_PURPOSE = {
  VERIFY_EMAIL: 'VERIFY_EMAIL',
  RESET_PASSWORD: 'RESET_PASSWORD',
} as const;
type TokenPurpose = (typeof CLIENT_TOKEN_PURPOSE)[keyof typeof CLIENT_TOKEN_PURPOSE];

const VERIFY_EMAIL_TTL_HOURS = 24;
// Mesmo prazo do link de senha do dono (o texto do e-mail fala em "horas")
const RESET_PASSWORD_TTL_HOURS = 2;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export type ClientHistoryEntry = {
  id: string;
  type: 'APPOINTMENT' | 'SALE' | 'WALK_IN';
  date: string;
  networkName: string;
  barbershopName: string;
  detail: string | null;
  status: string;
  total: number | null;
  currency: string | null;
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
}): ClientAccountDTO {
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    phone: account.phone,
    avatarUrl: account.avatarUrl,
    emailVerified: !!account.emailVerifiedAt,
    hasPassword: !!account.password,
  };
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
  ) {}

  // Liga as fichas (Customer) órfãs de qualquer negócio da plataforma com
  // este e-mail à conta — é isso que dá o histórico "cross-negócio". Só com
  // o e-mail CONFIRMADO: antes ligava pelo e-mail/telefone digitado no
  // cadastro, e bastava cadastrar o e-mail de outra pessoa pra ver onde, quando
  // e quanto ela gastou. Telefone não liga nada (não há como confirmar).
  private async linkVerifiedCustomers(account: {
    id: number;
    email: string;
    emailVerifiedAt: Date | null;
  }) {
    if (!account.emailVerifiedAt) return;
    await this.prisma.customer.updateMany({
      where: { clientAccountId: null, email: { equals: account.email, mode: 'insensitive' } },
      data: { clientAccountId: account.id },
    });
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
          SupportEmail: 'suporte@barbershop.com.br',
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
    const token = await this.createToken(
      account.id,
      CLIENT_TOKEN_PURPOSE.RESET_PASSWORD,
      RESET_PASSWORD_TTL_HOURS,
    );
    try {
      await this.emailService.sendCustomerEmail(
        null,
        'password_reset',
        {
          FullName: account.name,
          AppName: 'Barbershop',
          ResetURL: `${this.frontendUrl()}/client/reset-password?token=${token}`,
          ExpirationHours: RESET_PASSWORD_TTL_HOURS,
          SupportEmail: 'suporte@barbershop.com.br',
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
    const updated = await this.prisma.clientAccount.update({
      where: { id: account.id },
      data: {
        password: await bcrypt.hash(newPassword, 10),
        emailVerifiedAt: account.emailVerifiedAt ?? new Date(),
        sessionVersion: { increment: 1 },
      },
    });
    await this.prisma.clientAccountToken.updateMany({
      where: { clientAccountId: account.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    await this.linkVerifiedCustomers(updated);
    return updated;
  }

  async signup(email: string, password: string, name: string, phone?: string, language?: string) {
    const normalizedEmail = email.trim().toLowerCase();
    validatePassword(password);

    const existing = await this.prisma.clientAccount.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      throw new ConflictException('Já existe uma conta com este email.');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const account = await this.prisma.clientAccount.create({
      data: {
        email: normalizedEmail,
        password: passwordHash,
        name: name.trim(),
        phone: phone?.trim() || null,
        language: language ? normalizeLang(language) : null,
      },
    });

    // Nada é ligado ainda: o histórico aparece depois de confirmar o e-mail
    await this.sendVerificationEmail(account);

    return account;
  }

  async validateCredentials(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const account = await this.prisma.clientAccount.findUnique({
      where: { email: normalizedEmail },
    });
    if (!account) {
      throw new UnauthorizedException('Email ou senha inválidos.');
    }
    if (!account.password) {
      throw new UnauthorizedException(
        'Esta conta usa login social. Entre com Google, Facebook ou Apple.',
      );
    }
    const matches = await bcrypt.compare(password, account.password);
    if (!matches) {
      throw new UnauthorizedException('Email ou senha inválidos.');
    }

    // Fichas criadas desde o último login (se o e-mail já está confirmado)
    await this.linkVerifiedCustomers(account);

    return account;
  }

  // Login/cadastro social (Google/Facebook/Apple) sem sessão ativa — mesma
  // lógica de "achar ou criar" da conta de staff (ver UserService), adaptada
  // para ClientAccount: se o provider+email já está linkado, entra direto;
  // se já existe uma conta com esse email (senha ou outro provider), conecta
  // este método a ela em vez de criar uma segunda conta; senão cria nova.
  async findOrCreateSocialAccount(email: string, name: string, provider: string) {
    const normalizedEmail = email.trim().toLowerCase();

    const existingLink = await this.prisma.clientLinkedSocialAccount.findUnique({
      where: { provider_providerEmail: { provider, providerEmail: normalizedEmail } },
    });

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
    if (account && !account.emailVerifiedAt && account.email === normalizedEmail) {
      account = await this.prisma.clientAccount.update({
        where: { id: account.id },
        data: { emailVerifiedAt: new Date(), password: null, sessionVersion: { increment: 1 } },
      });
    }

    if (account && !existingLink) {
      await this.prisma.clientLinkedSocialAccount
        .create({ data: { clientAccountId: account.id, provider, providerEmail: normalizedEmail } })
        .catch(() => {
          // Vínculo já criado por outra requisição simultânea — pode ignorar
        });
    }

    if (!account) {
      account = await this.prisma.clientAccount.create({
        data: {
          email: normalizedEmail,
          name: name || normalizedEmail.split('@')[0],
          password: null,
          emailVerifiedAt: new Date(),
        },
      });
      await this.prisma.clientLinkedSocialAccount.create({
        data: { clientAccountId: account.id, provider, providerEmail: normalizedEmail },
      });
    }

    await this.linkVerifiedCustomers(account);
    return account;
  }

  async getLinkedSocialAccounts(clientAccountId: number) {
    return this.prisma.clientLinkedSocialAccount.findMany({
      where: { clientAccountId },
      select: { provider: true, providerEmail: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async unlinkSocialAccount(clientAccountId: number, provider: string) {
    await this.prisma.clientLinkedSocialAccount.deleteMany({
      where: { clientAccountId, provider },
    });
  }

  // Chamado quando o cliente JÁ está logado e clica em "conectar" um novo
  // método a partir da página de conta.
  async linkSocialAccountToClient(
    clientAccountId: number,
    email: string,
    provider: string,
  ): Promise<{
    ok: boolean;
    reason?: 'already_linked_elsewhere' | 'email_belongs_to_another_account';
  }> {
    const normalizedEmail = email.trim().toLowerCase();
    const existingLink = await this.prisma.clientLinkedSocialAccount.findUnique({
      where: { provider_providerEmail: { provider, providerEmail: normalizedEmail } },
    });
    if (existingLink) {
      if (existingLink.clientAccountId === clientAccountId) return { ok: true };
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
      create: { clientAccountId, provider, providerEmail: normalizedEmail },
      update: { providerEmail: normalizedEmail },
    });
    return { ok: true };
  }

  /**
   * Exclusão da conta pelo próprio cliente (LGPD). Confirma com a senha (ou,
   * em conta só de login social, digitando o e-mail). Cancela as assinaturas
   * de serviço no Stripe na hora e apaga o cliente lá (cartões salvos);
   * apaga avaliações, favoritos e logins sociais e desliga as fichas das
   * barbearias. A linha da conta fica, anônima, só pra não levar junto os
   * pagamentos que as barbearias receberam (registro fiscal delas).
   */
  async deleteAccount(clientAccountId: number, confirm: { password?: string; email?: string }) {
    const account = await this.prisma.clientAccount.findUnique({
      where: { id: clientAccountId },
      include: { subscriptions: { where: { status: { not: 'CANCELED' } } } },
    });
    if (!account || account.deletedAt) throw new UnauthorizedException('Conta não encontrada.');

    if (account.password) {
      const ok = !!confirm.password && (await bcrypt.compare(confirm.password, account.password));
      // 400, não 401: o front trata 401 como sessão vencida e desloga
      if (!ok) throw new BadRequestException('Senha incorreta.');
    } else if ((confirm.email ?? '').trim().toLowerCase() !== account.email) {
      throw new BadRequestException('Digite o e-mail da conta pra confirmar.');
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
    await this.prisma.$transaction([
      this.prisma.clientSubscription.updateMany({
        where: { clientAccountId, status: { not: 'CANCELED' } },
        data: { status: 'CANCELED', canceledAt: now, cancelAtPeriodEnd: false },
      }),
      this.prisma.review.deleteMany({ where: { clientAccountId } }),
      this.prisma.clientFavorite.deleteMany({ where: { clientAccountId } }),
      this.prisma.clientLinkedSocialAccount.deleteMany({ where: { clientAccountId } }),
      this.prisma.clientAccountToken.deleteMany({ where: { clientAccountId } }),
      this.prisma.customer.updateMany({
        where: { clientAccountId },
        data: { clientAccountId: null },
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
          sessionVersion: { increment: 1 },
        },
      }),
    ]);
    this.logger.log(`Conta de cliente ${clientAccountId} excluída pelo titular`);
  }

  issueCookie(account: { id: number; email: string; sessionVersion: number }, res: Response) {
    const token = this.jwtService.sign({
      clientAccountId: account.id,
      email: account.email,
      v: account.sessionVersion,
    });
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    res.cookie('ClientAuthentication', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
      expires: new Date(Date.now() + Number(this.configService.get('JWT_EXPIRATION')) * 1000),
    });
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

  async listFavorites(clientAccountId: number) {
    const favorites = await this.prisma.clientFavorite.findMany({
      where: { clientAccountId },
      include: { network: true },
      orderBy: { createdAt: 'desc' },
    });
    return favorites.map((f) => f.network);
  }

  async addFavorite(clientAccountId: number, networkId: number) {
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

  async searchNetworks(query: string) {
    const q = query.trim();
    if (q.length < 2) return [];
    return this.prisma.network.findMany({
      where: { name: { contains: q, mode: 'insensitive' } },
      take: 15,
      orderBy: { name: 'asc' },
    });
  }

  async getHistory(clientAccountId: number): Promise<ClientHistoryEntry[]> {
    const customers = await this.prisma.customer.findMany({
      where: { clientAccountId },
      select: { id: true, network: { select: { name: true, currency: true } } },
    });
    if (customers.length === 0) return [];

    const customerIds = customers.map((c) => c.id);
    const networkNameByCustomer = new Map(
      customers.map((c) => [c.id, c.network?.name ?? 'Negócio']),
    );
    const currencyByCustomer = new Map(customers.map((c) => [c.id, c.network?.currency ?? 'BRL']));

    const [appointments, sales, walkIns] = await Promise.all([
      this.prisma.appointment.findMany({
        where: { customerId: { in: customerIds } },
        include: {
          barbershop: { select: { name: true } },
          services: { include: { service: { select: { name: true } } } },
        },
        orderBy: { startAt: 'desc' },
        take: 50,
      }),
      this.prisma.sale.findMany({
        where: { customerId: { in: customerIds }, paymentStatus: 'PAID' },
        include: { barbershop: { select: { name: true } } },
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
        detail: serviceNames || null,
        status: a.status,
        total: null,
        currency: currencyByCustomer.get(a.customerId) ?? null,
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
        currency: s.customerId ? currencyByCustomer.get(s.customerId) ?? 'BRL' : 'BRL',
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
