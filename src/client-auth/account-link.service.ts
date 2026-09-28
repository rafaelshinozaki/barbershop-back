import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/email/email.service';
import { normalizeLang } from '@/email/language';
import { assertNotSuspended } from './suspension';

type StaffUser = {
  id: number;
  email: string;
  password: string;
  fullName: string;
  phone: string;
  twoFactorEnabled: boolean;
};

/**
 * A mesma pessoa com conta de cliente e conta da equipe (mesmo e-mail):
 * as duas ficam ligadas e a senha que vale nas duas telas é a da equipe.
 *
 * Só liga com prova dos dois lados: a conta da equipe não confirma e-mail,
 * então "mesmo e-mail" sozinho deixaria alguém criar uma conta da equipe com
 * o e-mail de outra pessoa e herdar a área de cliente dela. A prova é a
 * senha: a mesma nos dois lados liga no login; senhas diferentes ligam
 * quando a pessoa, logada num lado, digita a senha do outro.
 */
@Injectable()
export class AccountLinkService {
  private readonly logger = new Logger(AccountLinkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  /** Conta da equipe ativa (login por senha) com este e-mail */
  staffByEmail(email: string): Promise<StaffUser | null> {
    return this.prisma.user.findFirst({
      where: {
        email: { equals: email.trim(), mode: 'insensitive' },
        provider: 'local',
        isActive: true,
        deleted_at: null,
      },
      select: {
        id: true,
        email: true,
        password: true,
        fullName: true,
        phone: true,
        twoFactorEnabled: true,
      },
    });
  }

  /** A conta da equipe ligada, se ainda estiver ativa */
  linkedStaff(userId: number | null | undefined): Promise<StaffUser | null> {
    if (!userId) return Promise.resolve(null);
    return this.prisma.user.findFirst({
      where: { id: userId, isActive: true, deleted_at: null },
      select: {
        id: true,
        email: true,
        password: true,
        fullName: true,
        phone: true,
        twoFactorEnabled: true,
      },
    });
  }

  /** Conta de cliente (não excluída) com este e-mail */
  clientByEmail(email: string) {
    return this.prisma.clientAccount.findFirst({
      where: { email: email.trim().toLowerCase(), deletedAt: null },
    });
  }

  staffPasswordMatches(staff: { password: string }, password: string) {
    return bcrypt.compare(password, staff.password);
  }

  /**
   * Liga as duas contas. A senha própria da conta de cliente sai (vale a da
   * equipe) e as outras sessões da área do cliente caem (sessionVersion);
   * quem chama emite o cookie de novo. Avisa por e-mail.
   */
  async link(clientAccountId: number, staff: { id: number }) {
    const taken = await this.prisma.clientAccount.findFirst({
      where: { userId: staff.id, NOT: { id: clientAccountId } },
      select: { id: true },
    });
    if (taken) throw new BadRequestException('Esta conta da equipe já está ligada a outra conta.');
    const account = await this.prisma.clientAccount.update({
      where: { id: clientAccountId },
      data: {
        userId: staff.id,
        linkedAt: new Date(),
        password: null,
        sessionVersion: { increment: 1 },
      },
    });
    void this.notifyLinked(account);
    return account;
  }

  private async notifyLinked(account: {
    id: number;
    name: string;
    email: string;
    language: string | null;
  }) {
    try {
      await this.emailService.sendCustomerEmail(
        null,
        'accounts_linked',
        {
          FullName: account.name,
          AppName: 'Barbershop',
          SupportEmail: 'suporte@barbershop.com.br',
          Year: new Date().getFullYear(),
        },
        {
          pt: 'Suas contas foram unidas',
          en: 'Your accounts were joined',
          es: 'Tus cuentas se unieron',
        },
        'accounts-linked',
        account.email,
        normalizeLang(account.language),
      );
    } catch (error) {
      this.logger.error(`Falha ao avisar ligação de contas (cliente ${account.id}): ${error}`);
    }
  }

  /**
   * Situação vista da área do cliente. Só conta que existe uma conta da
   * equipe com o e-mail depois que o e-mail do cliente foi confirmado (senão
   * dava pra criar conta de cliente com qualquer e-mail pra descobrir quem
   * tem conta da equipe).
   */
  async statusForClient(clientAccountId: number) {
    const account = await this.prisma.clientAccount.findUnique({ where: { id: clientAccountId } });
    if (!account) throw new UnauthorizedException('Conta não encontrada.');
    if (account.userId) {
      const staff = await this.linkedStaff(account.userId);
      return { linked: true, canLink: false, canOpenOtherArea: !!staff && !staff.twoFactorEnabled };
    }
    const staff = account.emailVerifiedAt ? await this.staffByEmail(account.email) : null;
    const staffLinked = staff
      ? await this.prisma.clientAccount.findFirst({
          where: { userId: staff.id },
          select: { id: true },
        })
      : null;
    return { linked: false, canLink: !!staff && !staffLinked, canOpenOtherArea: false };
  }

  /** Área do cliente: liga digitando a senha da conta da equipe */
  async linkFromClient(clientAccountId: number, staffPassword: string) {
    const account = await this.prisma.clientAccount.findUnique({ where: { id: clientAccountId } });
    if (!account || account.deletedAt) throw new UnauthorizedException('Conta não encontrada.');
    if (account.userId) return account;
    const staff = await this.staffByEmail(account.email);
    // Mesma resposta pra "não tem conta da equipe" e "senha errada"
    if (!staff || !(await this.staffPasswordMatches(staff, staffPassword ?? ''))) {
      throw new BadRequestException('Senha da conta de profissional incorreta.');
    }
    return this.link(account.id, staff);
  }

  /** Situação vista pela equipe (o e-mail já é o da própria conta logada) */
  async statusForStaff(userId: number) {
    const linked = await this.prisma.clientAccount.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true },
    });
    if (linked) return { linked: true, canLink: false, clientHasPassword: false };
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    const client = user ? await this.clientByEmail(user.email) : null;
    return {
      linked: false,
      canLink: !!client && !client.userId,
      clientHasPassword: !!client?.password,
    };
  }

  /** Equipe: liga digitando a senha da conta de cliente */
  async linkFromStaff(userId: number, clientPassword: string) {
    const staff = await this.linkedStaff(userId);
    if (!staff) throw new UnauthorizedException('Conta não encontrada.');
    const client = await this.clientByEmail(staff.email);
    if (!client || client.userId) {
      throw new BadRequestException('Não há conta de cliente com este e-mail para ligar.');
    }
    if (!client.password) {
      // Conta de cliente só com login social: liga pela área do cliente
      throw new BadRequestException(
        'Sua conta de cliente entra pelo Google, Facebook ou Apple: entre na área do cliente e ligue por lá.',
      );
    }
    if (!(await bcrypt.compare(clientPassword ?? '', client.password))) {
      throw new BadRequestException('Senha da conta de cliente incorreta.');
    }
    return this.link(client.id, staff);
  }

  /**
   * Equipe abrindo a área do cliente. Ligada: entra. Sem conta de cliente:
   * cria uma já ligada (o e-mail ainda precisa ser confirmado pra puxar o
   * histórico das barbearias). Conta de cliente não ligada: liga primeiro.
   */
  async clientAccountForStaff(userId: number) {
    const staff = await this.linkedStaff(userId);
    if (!staff) throw new UnauthorizedException('Conta não encontrada.');
    const linked = await this.prisma.clientAccount.findFirst({
      where: { userId, deletedAt: null },
    });
    if (linked) {
      assertNotSuspended(linked);
      return { account: linked, created: false };
    }
    const existing = await this.clientByEmail(staff.email);
    if (existing) {
      throw new BadRequestException(
        'Você já tem uma conta de cliente com este e-mail: ligue as duas antes.',
      );
    }
    const account = await this.prisma.clientAccount.create({
      data: {
        email: staff.email.trim().toLowerCase(),
        name: staff.fullName,
        phone: staff.phone || null,
        userId: staff.id,
        linkedAt: new Date(),
      },
    });
    return { account, created: true };
  }

  /**
   * Área do cliente abrindo a da equipe: só ligada e sem verificação em duas
   * etapas (a senha da equipe pode não ter sido digitada nesta sessão, e o
   * código do 2FA não pode ser pulado).
   */
  async staffForClient(clientAccountId: number) {
    const account = await this.prisma.clientAccount.findUnique({ where: { id: clientAccountId } });
    const staff = await this.linkedStaff(account?.userId);
    if (!staff)
      throw new BadRequestException('Esta conta de cliente não está ligada a uma conta da equipe.');
    if (staff.twoFactorEnabled) {
      throw new BadRequestException(
        'Sua conta usa verificação em duas etapas: entre pela tela de login.',
      );
    }
    return staff;
  }
}
