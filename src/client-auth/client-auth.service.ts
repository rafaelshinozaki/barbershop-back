import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { Response } from 'express';
import { PrismaService } from '@/prisma/prisma.service';
import { ClientAccountDTO } from './dto/client-account.dto';

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
}): ClientAccountDTO {
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    phone: account.phone,
    avatarUrl: account.avatarUrl,
  };
}

@Injectable()
export class ClientAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  // Liga (best-effort) Customers órfãos — de qualquer negócio da plataforma —
  // que batem por email ou telefone a esta conta. É isso que dá o histórico
  // "cross-negócio": cada Customer continua pertencendo à sua Network, só a
  // conta do cliente une os registros na hora de consultar.
  private async linkExistingCustomers(clientAccountId: number, email: string, phone?: string | null) {
    await this.prisma.customer.updateMany({
      where: {
        clientAccountId: null,
        OR: [{ email }, ...(phone ? [{ phone }] : [])],
      },
      data: { clientAccountId },
    });
  }

  async signup(email: string, password: string, name: string, phone?: string) {
    const normalizedEmail = email.trim().toLowerCase();
    validatePassword(password);

    const existing = await this.prisma.clientAccount.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      throw new ConflictException('Já existe uma conta com este email.');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const account = await this.prisma.clientAccount.create({
      data: { email: normalizedEmail, password: passwordHash, name: name.trim(), phone: phone?.trim() || null },
    });

    await this.linkExistingCustomers(account.id, normalizedEmail, account.phone);

    return account;
  }

  async validateCredentials(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const account = await this.prisma.clientAccount.findUnique({ where: { email: normalizedEmail } });
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

    await this.linkExistingCustomers(account.id, account.email, account.phone);

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

    if (account && !existingLink) {
      await this.prisma.clientLinkedSocialAccount
        .create({ data: { clientAccountId: account.id, provider, providerEmail: normalizedEmail } })
        .catch(() => {});
    }

    if (!account) {
      account = await this.prisma.clientAccount.create({
        data: { email: normalizedEmail, name: name || normalizedEmail.split('@')[0], password: null },
      });
      await this.prisma.clientLinkedSocialAccount.create({
        data: { clientAccountId: account.id, provider, providerEmail: normalizedEmail },
      });
    }

    await this.linkExistingCustomers(account.id, normalizedEmail, account.phone);
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
    await this.prisma.clientLinkedSocialAccount.deleteMany({ where: { clientAccountId, provider } });
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

  issueCookie(account: { id: number; email: string }, res: Response) {
    const token = this.jwtService.sign({ clientAccountId: account.id, email: account.email });
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
    if (!account) throw new UnauthorizedException('Conta não encontrada.');
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
    const networkNameByCustomer = new Map(customers.map((c) => [c.id, c.network?.name ?? 'Negócio']));
    const currencyByCustomer = new Map(customers.map((c) => [c.id, c.network?.currency ?? 'BRL']));

    const [appointments, sales, walkIns] = await Promise.all([
      this.prisma.appointment.findMany({
        where: { customerId: { in: customerIds } },
        include: { barbershop: { select: { name: true } }, services: { include: { service: { select: { name: true } } } } },
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
      const serviceNames = a.services.map((s) => s.service?.name).filter(Boolean).join(', ');
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
        networkName: s.customerId ? (networkNameByCustomer.get(s.customerId) ?? 'Negócio') : 'Negócio',
        barbershopName: s.barbershop.name,
        detail: null,
        status: s.paymentStatus,
        total: Number(s.total),
        currency: s.customerId ? (currencyByCustomer.get(s.customerId) ?? 'BRL') : 'BRL',
      });
    });

    walkIns.forEach((w) => {
      entries.push({
        id: `walkin-${w.id}`,
        type: 'WALK_IN',
        date: w.createdAt.toISOString(),
        networkName: w.customerId ? (networkNameByCustomer.get(w.customerId) ?? 'Negócio') : 'Negócio',
        barbershopName: w.barbershop.name,
        detail: null,
        status: w.status,
        total: null,
        currency: null,
      });
    });

    return entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 50);
  }
}
