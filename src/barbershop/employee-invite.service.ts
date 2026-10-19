import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { WORK_MINIMUM_AGE, completedYears } from '../common/work-age';
import { RealtimeService } from '../realtime/realtime.service';
import { ActivityNotificationsService } from '../notifications/activity-notifications.service';
import { langForCountry } from '../email/language';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { BarbershopService, parseEngagementPeriod } from './barbershop.service';
import * as bcrypt from 'bcryptjs';
import { isStaffType, StaffType, staffRoleLabel, takesAppointments } from './staff-roles';
import { linkBarberToProfessional } from './professional';
import { normalizeEmail } from '../common/email';
import { canonicalIdDoc } from '../common/id-doc';
import { idDocTaken } from '../common/id-doc-lookup';
import { assertSoloSinglePerson } from './solo';

export type EmployeeRole = 'BarbershopEmployee' | 'BarbershopManager';

export interface CreateEmployeeInviteInput {
  barbershopId: number;
  email: string;
  name: string;
  phone: string;
  role: EmployeeRole;
  /** Cargo na unidade: basic | barber | reception | manager (padrão: pelo role) */
  staffType?: StaffType;
  /** Atende clientes (vazio = pelo cargo: recepção não, os demais sim) */
  takesAppointments?: boolean | null;
  specialization?: string;
  hireDate?: string;
  /** Vínculo temporário (freelancer): início e fim, ISO. Vazio = sem limite */
  accessStartsAt?: string | null;
  accessEndsAt?: string | null;
}

export interface AcceptEmployeeInviteAddress {
  zipcode: string;
  street: string;
  city: string;
  neighborhood: string;
  state: string;
  country: string;
  complement1?: string;
  complement2?: string;
}

export interface AcceptEmployeeInviteInput {
  fullName: string;
  idDocNumber: string;
  phone: string;
  password: string;
  birthdate: string;
  gender: string;
  address?: AcceptEmployeeInviteAddress;
  /** Chave do link que chegou no e-mail convidado (prova que a pessoa recebeu) */
  emailKey?: string;
}

export const INVITE_EMAIL_KEY_MESSAGE =
  'Abra o convite pelo link que chegou no e-mail convidado. Se não chegou, peça o reenvio nesta tela.';
export const INVITE_EXISTING_ACCOUNT_MESSAGE =
  'Já existe uma conta com este e-mail. Entre com ela para aceitar o convite.';
export const INVITE_EMAIL_RECENT_MESSAGE =
  'O e-mail do convite acabou de ser enviado. Confira a caixa de entrada e o spam.';
const EMAIL_RESEND_GAP_MS = 60_000;
const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

@Injectable()
export class EmployeeInviteService {
  private readonly logger = new Logger(EmployeeInviteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly config: ConfigService,
    // barbershop.service → job-opening.service → este arquivo → barbershop.service
    @Inject(forwardRef(() => BarbershopService))
    private readonly barbershopService: BarbershopService,
    private readonly realtime: RealtimeService,
    private readonly activity: ActivityNotificationsService,
  ) {}

  /**
   * Cria convite de funcionário: Barber + EmployeeInvite + envio de email.
   */
  async createInvite(userId: number, input: CreateEmployeeInviteInput) {
    // Dono e gerente convidam a equipe, gerentes inclusive (como no Booksy)
    await this.barbershopService.ensureAccess(userId, input.barbershopId, 'manager');
    await assertSoloSinglePerson(this.prisma, input.barbershopId);

    const email = normalizeEmail(input.email);
    if (!email) {
      throw new BadRequestException('Email é obrigatório para enviar o convite');
    }

    // Profissional que já tem conta (trabalha em outra unidade, é freelancer
    // ou dono de outra barbearia) aceita o convite com a conta dele
    const existingUser = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    if (existingUser) {
      const alreadyInTeam = await this.prisma.barber.findFirst({
        where: { barbershopId: input.barbershopId, userId: existingUser.id, isActive: true },
      });
      if (alreadyInTeam) {
        throw new BadRequestException('Essa pessoa já está na equipe desta unidade');
      }
    }
    const period = parseEngagementPeriod(input.accessStartsAt, input.accessEndsAt);

    const existingInvite = await this.prisma.employeeInvite.findFirst({
      where: {
        email,
        barbershopId: input.barbershopId,
        status: 'PENDING',
      },
    });
    if (existingInvite && existingInvite.expiresAt >= new Date()) {
      throw new BadRequestException('Já existe um convite pendente para este email nesta unidade');
    }
    // Vencido não trava um convite novo. O cadastro nasceu só do convite
    // e ninguém aceitou, então sai da equipe ativa.
    if (existingInvite) {
      await this.prisma.$transaction([
        this.prisma.employeeInvite.update({
          where: { id: existingInvite.id },
          data: { status: 'EXPIRED' },
        }),
        this.prisma.barber.updateMany({
          where: { id: existingInvite.barberId, userId: null },
          data: { isActive: false },
        }),
      ]);
    }

    const phone = input.phone.trim();
    const existingBarberByPhone = await this.prisma.barber.findFirst({
      where: { barbershopId: input.barbershopId, phone, isActive: true },
    });
    if (existingBarberByPhone) {
      throw new BadRequestException('Já existe um funcionário com este telefone nesta unidade');
    }

    const existingBarberByEmail = await this.prisma.barber.findFirst({
      where: { barbershopId: input.barbershopId, email, isActive: true },
    });
    if (existingBarberByEmail) {
      throw new BadRequestException('Já existe um funcionário com este email nesta unidade');
    }

    if (input.staffType !== undefined && !isStaffType(input.staffType)) {
      throw new BadRequestException('Cargo inválido');
    }
    const staffType: StaffType =
      input.role === 'BarbershopManager' ? 'manager' : input.staffType ?? 'barber';
    // Gerente tem conta de gerente; os outros cargos, de funcionário
    const role: EmployeeRole = staffType === 'manager' ? 'BarbershopManager' : 'BarbershopEmployee';
    // Só ocupa vaga do plano quem vai atender (recepção/gerente sem agenda não)
    if (takesAppointments({ takesAppointments: input.takesAppointments, staffType })) {
      await this.barbershopService.ensureBarberLimitNotExceeded(input.barbershopId);
    }
    const inviteToken = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const barber = await this.prisma.barber.create({
      data: {
        barbershopId: input.barbershopId,
        name: input.name.trim(),
        phone,
        email,
        specialization:
          input.specialization?.trim() ||
          (staffType === 'manager'
            ? 'Gerente'
            : staffType === 'reception'
            ? 'Recepção'
            : undefined),
        hireDate: input.hireDate ? new Date(input.hireDate) : undefined,
        staffType,
        takesAppointments: input.takesAppointments ?? null,
        ...period,
      },
    });
    // Funcionário convidado já entra na equipe (card "Funcionários")
    this.realtime.notify(input.barbershopId, 'BARBER', 'CREATED');

    const invite = await this.prisma.employeeInvite.create({
      data: {
        inviterId: userId,
        barbershopId: input.barbershopId,
        barberId: barber.id,
        email,
        inviteToken,
        role,
        expiresAt,
      },
      include: {
        inviter: { select: { fullName: true } },
        barbershop: { select: { name: true, country: true } },
        barber: { select: { staffType: true } },
      },
    });

    // E-mail é best-effort: se o provedor falhar, o convite continua valendo
    // (antes a requisição dava erro com o convite já criado, e tentar de novo
    // esbarrava em "já existe um convite pendente"). A tela oferece o link.
    let emailSent = true;
    try {
      await this.sendEmployeeInviteEmail(invite);
    } catch (error) {
      emailSent = false;
      this.logger.error(`Convite ${invite.id}: e-mail não enviado`, error as Error);
    }
    return { barber, invite, emailSent };
  }

  /**
   * Reenvia o convite pendente da mesma pessoa: novo link e mais 30 dias.
   * Vale também quando o prazo já acabou.
   */
  async resendInvite(userId: number, barbershopId: number, barberId: number) {
    await this.barbershopService.ensureAccess(userId, barbershopId, 'manager');
    const invite = await this.prisma.employeeInvite.findFirst({
      where: { barberId, barbershopId, status: 'PENDING' },
      include: { barber: { select: { isActive: true } } },
    });
    if (!invite || !invite.barber?.isActive) {
      throw new BadRequestException('Não há convite pendente para reenviar.');
    }
    return this.reissue(invite.id, userId);
  }

  /**
   * Equipe da plataforma: reenvia um convite pendente sem ser gerente da
   * unidade. Quem convidou pode já ter saído, então não passa pela checagem
   * de acesso dele, e o convite continua no nome de quem convidou.
   */
  async resendByStaff(inviteId: number) {
    const invite = await this.prisma.employeeInvite.findFirst({
      where: { id: inviteId, status: 'PENDING' },
      include: { barber: { select: { isActive: true } } },
    });
    if (!invite || !invite.barber?.isActive) {
      throw new BadRequestException('Não há convite pendente para reenviar.');
    }
    return this.reissue(invite.id);
  }

  /** Novo link, mais 30 dias e o e-mail de novo. Sem inviterId, fica quem convidou. */
  private async reissue(inviteId: number, inviterId?: number) {
    const inviteToken = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    const updated = await this.prisma.employeeInvite.update({
      where: { id: inviteId },
      data: { inviteToken, expiresAt, ...(inviterId != null ? { inviterId } : {}) },
      include: {
        inviter: { select: { fullName: true } },
        barbershop: { select: { name: true, country: true } },
        barber: { select: { staffType: true } },
      },
    });
    let emailSent = true;
    try {
      await this.sendEmployeeInviteEmail(updated);
    } catch (error) {
      emailSent = false;
      this.logger.error(`Convite ${updated.id}: reenvio não saiu`, error as Error);
    }
    return { invite: updated, emailSent };
  }

  /**
   * Valida token do convite (endpoint público).
   */
  async validateInvite(inviteToken: string, emailKey?: string) {
    const invite = await this.prisma.employeeInvite.findUnique({
      where: { inviteToken },
      include: {
        inviter: { select: { fullName: true } },
        barbershop: { select: { name: true, address: true } },
        barber: {
          select: { staffType: true, accessStartsAt: true, accessEndsAt: true, isActive: true },
        },
      },
    });

    if (!invite) {
      throw new NotFoundException('Convite não encontrado');
    }
    if (invite.status !== 'PENDING') {
      throw new BadRequestException('Este convite já foi utilizado');
    }
    if (invite.expiresAt < new Date()) {
      throw new BadRequestException('Este convite expirou');
    }
    if (!invite.barber?.isActive) {
      throw new BadRequestException('Este convite não está mais disponível');
    }

    const existingAccount = await this.prisma.user.findFirst({
      where: { email: { equals: normalizeEmail(invite.email), mode: 'insensitive' } },
      select: { id: true },
    });
    return {
      valid: true,
      email: invite.email,
      barbershopName: invite.barbershop.name,
      inviterName: invite.inviter.fullName,
      role: invite.role,
      staffType: invite.barber?.staffType ?? null,
      accessStartsAt: invite.barber?.accessStartsAt ?? null,
      accessEndsAt: invite.barber?.accessEndsAt ?? null,
      minimumAge: WORK_MINIMUM_AGE,
      // Já tem conta: entra com ela pra aceitar (não cria outra)
      existingAccount: !!existingAccount,
      // Veio pelo link do e-mail (pode criar a conta); senão, a tela pede o reenvio
      emailConfirmed: this.emailKeyMatches(invite.emailKeyHash, emailKey),
    };
  }

  /**
   * Aceita convite e cria usuário (endpoint público, sem cartão/pagamento).
   */
  async acceptInvite(inviteToken: string, data: AcceptEmployeeInviteInput) {
    const invite = await this.prisma.employeeInvite.findUnique({
      where: { inviteToken },
      include: {
        barber: true,
        barbershop: true,
        inviter: { select: { id: true } },
      },
    });

    if (!invite) {
      throw new NotFoundException('Convite não encontrado');
    }
    if (invite.status !== 'PENDING') {
      throw new BadRequestException('Este convite já foi utilizado');
    }
    if (invite.expiresAt < new Date()) {
      throw new BadRequestException('Este convite expirou');
    }
    if (!invite.barber?.isActive) {
      throw new BadRequestException('Este convite não está mais disponível');
    }

    // Quem abriu o link compartilhado pelo gerente não provou ser dono do e-mail
    if (!this.emailKeyMatches(invite.emailKeyHash, data.emailKey)) {
      throw new BadRequestException(INVITE_EMAIL_KEY_MESSAGE);
    }

    // Conta com esse e-mail em qualquer forma de entrada (senha ou Google):
    // aceita com ela, não cria outra
    const existingUser = await this.prisma.user.findFirst({
      where: { email: { equals: normalizeEmail(invite.email), mode: 'insensitive' } },
      select: { id: true },
    });
    if (existingUser) {
      throw new BadRequestException(INVITE_EXISTING_ACCOUNT_MESSAGE);
    }

    // Mesma checagem de documento duplicado do signup principal (ver
    // UserService.createUser). O número salvo pode estar mascarado (CPF) e o
    // formulário manda os dígitos: compara pelos dígitos, no país informado.
    const documentCountry = data.address?.country ?? invite.barbershop.country;
    const documentNumber = canonicalIdDoc(data.idDocNumber, documentCountry);
    const documentAlreadyExists = documentNumber
      ? await idDocTaken(this.prisma, documentNumber, documentCountry)
      : false;

    if (documentAlreadyExists) {
      throw new BadRequestException('Já existe uma conta com estes dados');
    }

    const birthdateText = data.birthdate?.trim() ?? '';
    if (!birthdateText) {
      throw new BadRequestException('Data de nascimento é obrigatória');
    }
    const age = completedYears(birthdateText);
    if (age == null || age < 0) {
      throw new BadRequestException('Data de nascimento inválida');
    }
    if (age < WORK_MINIMUM_AGE) {
      throw new BadRequestException('Para trabalhar é preciso ter 16 anos.');
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);
    const role = await this.prisma.role.findFirst({
      where: { name: invite.role },
    });
    if (!role) {
      throw new BadRequestException(`Função ${invite.role} não encontrada`);
    }

    const birthdate = new Date(birthdateText);
    const gender = data.gender === 'female' ? 'female' : 'male';

    const language = langForCountry(invite.barbershop.country);
    const newUser = await this.prisma.$transaction(async (tx) => {
      const seat = await tx.barber.findUnique({
        where: { id: invite.barberId },
        select: { isActive: true },
      });
      if (!seat?.isActive) {
        throw new BadRequestException('Este convite não está mais disponível');
      }
      const user = await tx.user.create({
        data: {
          email: normalizeEmail(invite.email),
          password: hashedPassword,
          fullName: data.fullName.trim(),
          idDocNumber: documentNumber,
          phone: data.phone.trim(),
          gender,
          birthdate,
          readTerms: true,
          membership: 'FREE',
          isActive: true,
          // A chave do link só chega no e-mail convidado
          emailVerifiedAt: new Date(),
          roleId: role.id,
          trialStartDate: new Date(),
          trialEndDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        },
      });

      if (
        data.address &&
        data.address.zipcode &&
        data.address.street &&
        data.address.city &&
        data.address.neighborhood &&
        data.address.state &&
        data.address.country
      ) {
        await tx.address.create({
          data: {
            userId: user.id,
            zipcode: data.address.zipcode.replace(/\D/g, ''),
            street: data.address.street.trim(),
            city: data.address.city.trim(),
            neighborhood: data.address.neighborhood.trim(),
            state: data.address.state.trim(),
            country: data.address.country.trim(),
            complement1: data.address.complement1?.trim() || null,
            complement2: data.address.complement2?.trim() || null,
          },
        });
      }

      await tx.userSystemConfig.create({
        data: {
          userId: user.id,
          theme: 'light',
          accentColor: 'bronze',
          grayColor: 'gray',
          radius: 'medium',
          scaling: '100%',
          panelBackground: 'translucent',
          language,
        },
      });

      await tx.notificationPreference.create({
        data: {
          userId: user.id,
          newsEmail: true,
          newsInApp: true,
          promotionsEmail: true,
          promotionsInApp: true,
          instabilityEmail: true,
          instabilityInApp: true,
          securityEmail: true,
          securityInApp: true,
        },
      });

      await linkBarberToProfessional(tx, invite.barberId, user.id);
      const claimed = await tx.employeeInvite.updateMany({
        where: { id: invite.id, status: 'PENDING' },
        data: { status: 'ACCEPTED', acceptedByUserId: user.id },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('Este convite já foi utilizado');
      }
      return user;
    });
    void this.activity.memberJoined(invite.barberId, newUser.id);

    return {
      success: true,
      userId: newUser.id,
      email: newUser.email,
      message: 'Conta criada com sucesso. Faça login para acessar.',
    };
  }

  /**
   * Aceita o convite com a conta que a pessoa já tem (logada): entra na
   * equipe de mais uma unidade, sem criar outra conta. O e-mail da conta
   * tem que ser o do convite.
   */
  async acceptInviteAsUser(inviteToken: string, userId: number) {
    const invite = await this.prisma.employeeInvite.findUnique({ where: { inviteToken } });
    if (!invite) throw new NotFoundException('Convite não encontrado');
    if (invite.status !== 'PENDING') {
      throw new BadRequestException('Este convite já foi utilizado');
    }
    if (invite.expiresAt < new Date()) {
      throw new BadRequestException('Este convite expirou');
    }
    const seat = await this.prisma.barber.findUnique({
      where: { id: invite.barberId },
      select: { isActive: true },
    });
    if (!seat?.isActive) {
      throw new BadRequestException('Este convite não está mais disponível');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.email.toLowerCase() !== invite.email.toLowerCase()) {
      throw new BadRequestException(
        'Este convite foi enviado para outro e-mail. Entre com a conta desse e-mail para aceitar.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Quem já passou por esta unidade e saiu tem o vínculo antigo (desligado):
      // ele fica como histórico (vendas, comissões) e o novo passa a valer
      await tx.barber.updateMany({
        where: {
          barbershopId: invite.barbershopId,
          userId,
          id: { not: invite.barberId },
          isActive: false,
        },
        data: { userId: null, professionalId: null },
      });
      const active = await tx.barber.findFirst({
        where: { barbershopId: invite.barbershopId, userId, isActive: true },
      });
      if (active) {
        throw new BadRequestException('Você já está na equipe desta unidade');
      }
      const stillActive = await tx.barber.findUnique({
        where: { id: invite.barberId },
        select: { isActive: true },
      });
      if (!stillActive?.isActive) {
        throw new BadRequestException('Este convite não está mais disponível');
      }
      await linkBarberToProfessional(tx, invite.barberId, userId);
      const claimed = await tx.employeeInvite.updateMany({
        where: { id: invite.id, status: 'PENDING' },
        data: { status: 'ACCEPTED', acceptedByUserId: userId },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('Este convite já foi utilizado');
      }
      // Abriu o link que chegou no e-mail da conta: e-mail confirmado
      await tx.user.updateMany({
        where: { id: userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: new Date() },
      });
    });
    this.realtime.notify(invite.barbershopId, 'BARBER', 'UPDATED');
    void this.activity.memberJoined(invite.barberId, userId);
    return { success: true, barbershopId: invite.barbershopId };
  }

  private emailKeyMatches(hash: string | null, key?: string | null) {
    return !!hash && !!key && hashKey(key) === hash;
  }

  /**
   * Reenvia o e-mail do convite pela tela do aceite (quem abriu o link
   * compartilhado sem a chave): nova chave, mesmo link, uma vez por minuto
   */
  async resendInviteEmail(inviteToken: string) {
    const invite = await this.prisma.employeeInvite.findUnique({
      where: { inviteToken },
      include: {
        inviter: { select: { fullName: true } },
        barbershop: { select: { name: true, country: true } },
        barber: { select: { staffType: true, isActive: true } },
      },
    });
    if (!invite || invite.status !== 'PENDING' || invite.expiresAt < new Date()) {
      throw new NotFoundException('Convite não encontrado');
    }
    if (!invite.barber?.isActive) {
      throw new BadRequestException('Este convite não está mais disponível');
    }
    if (
      invite.emailKeySentAt &&
      Date.now() - invite.emailKeySentAt.getTime() < EMAIL_RESEND_GAP_MS
    ) {
      throw new BadRequestException(INVITE_EMAIL_RECENT_MESSAGE);
    }
    await this.sendEmployeeInviteEmail(invite);
    return { sent: true };
  }

  /** Cada envio leva uma chave nova no link (só no e-mail) e guarda o hash dela */
  private async sendEmployeeInviteEmail(invite: any) {
    const frontendUrl = this.config.get<string>('FRONTEND_URL') || 'http://localhost:5173';
    const emailKey = randomBytes(24).toString('hex');
    await this.prisma.employeeInvite.update({
      where: { id: invite.id },
      data: { emailKeyHash: hashKey(emailKey), emailKeySentAt: new Date() },
    });
    const inviteUrl = `${frontendUrl}/accept-employee-invite/${invite.inviteToken}?k=${emailKey}`;
    // O convidado ainda não tem conta nem idioma salvo: usa a língua do
    // país da unidade (quem vai trabalhar numa unidade do México lê
    // espanhol, mesmo que o dono use o app em português)
    const label = staffRoleLabel(
      invite.barber?.staffType ?? (invite.role === 'BarbershopManager' ? 'manager' : 'barber'),
    );
    const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
    const roleLabel = { pt: cap(label.pt), en: cap(label.en), es: cap(label.es) };
    const shopName = invite.barbershop.name;

    await this.emailService.sendCustomerEmail(
      invite.inviterId,
      'employee_invite',
      {
        InviterName: invite.inviter.fullName,
        BarbershopName: shopName,
        RoleLabel: roleLabel,
        InviteUrl: inviteUrl,
        AppName: 'Barbershop',
      },
      {
        pt: `Convite para ser ${roleLabel.pt} na ${shopName}`,
        en: `Invitation to join ${shopName} as ${roleLabel.en}`,
        es: `Invitación para ser ${roleLabel.es} en ${shopName}`,
      },
      `Employee invite to ${invite.email}`,
      invite.email,
      langForCountry(invite.barbershop.country),
    );
  }
}
