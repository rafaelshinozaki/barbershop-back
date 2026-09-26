import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { RealtimeService } from '../realtime/realtime.service';
import { ActivityNotificationsService } from '../notifications/activity-notifications.service';
import { langForCountry } from '../email/language';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { BarbershopService, parseEngagementPeriod } from './barbershop.service';
import * as bcrypt from 'bcryptjs';
import { isStaffType, StaffType, staffRoleLabel, takesAppointments } from './staff-roles';

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
}

@Injectable()
export class EmployeeInviteService {
  private readonly logger = new Logger(EmployeeInviteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly config: ConfigService,
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

    const email = input.email.toLowerCase().trim();
    if (!email) {
      throw new BadRequestException('Email é obrigatório para enviar o convite');
    }

    // Profissional que já tem conta (trabalha em outra unidade, é freelancer
    // ou dono de outra barbearia) aceita o convite com a conta dele
    const existingUser = await this.prisma.user.findFirst({ where: { email } });
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
    if (existingInvite) {
      throw new BadRequestException('Já existe um convite pendente para este email nesta unidade');
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
   * Valida token do convite (endpoint público).
   */
  async validateInvite(inviteToken: string) {
    const invite = await this.prisma.employeeInvite.findUnique({
      where: { inviteToken },
      include: {
        inviter: { select: { fullName: true } },
        barbershop: { select: { name: true, address: true } },
        barber: { select: { staffType: true, accessStartsAt: true, accessEndsAt: true } },
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

    const existingAccount = await this.prisma.user.findFirst({
      where: { email: invite.email },
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
      // Já tem conta: entra com ela pra aceitar (não cria outra)
      existingAccount: !!existingAccount,
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

    const existingUser = await this.prisma.user.findFirst({
      where: { email: invite.email, provider: 'local' },
    });

    // Mesma checagem de documento duplicado do signup principal (ver
    // UserService.createUser) — esse fluxo cria o usuário por um caminho
    // separado e não tinha a proteção. Escopada por país e ignorada quando
    // vazia, pelos mesmos motivos.
    const documentNumber = data.idDocNumber?.trim();
    let documentAlreadyExists = false;
    if (documentNumber) {
      const documentCountry = data.address?.country;
      const existingDocument = await this.prisma.user.findFirst({
        where: {
          idDocNumber: documentNumber,
          provider: 'local',
          ...(documentCountry ? { address: { country: documentCountry } } : {}),
        },
      });
      documentAlreadyExists = !!existingDocument;
    }

    if (existingUser || documentAlreadyExists) {
      throw new BadRequestException('Já existe uma conta com estes dados');
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);
    const role = await this.prisma.role.findFirst({
      where: { name: invite.role },
    });
    if (!role) {
      throw new BadRequestException(`Função ${invite.role} não encontrada`);
    }

    const birthdate = data.birthdate ? new Date(data.birthdate) : new Date('1990-01-01');
    const gender = data.gender === 'female' ? 'female' : 'male';

    const newUser = await this.prisma.user.create({
      data: {
        email: invite.email,
        password: hashedPassword,
        fullName: data.fullName.trim(),
        idDocNumber: data.idDocNumber
          .replace(/\D/g, '')
          .replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'),
        phone: data.phone.trim(),
        gender,
        birthdate,
        readTerms: true,
        membership: 'FREE',
        isActive: true,
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
      await this.prisma.address.create({
        data: {
          userId: newUser.id,
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

    await this.prisma.userSystemConfig.create({
      data: {
        userId: newUser.id,
        theme: 'light',
        accentColor: 'bronze',
        grayColor: 'gray',
        radius: 'medium',
        scaling: '100%',
        panelBackground: 'translucent',
        language: 'pt',
      },
    });

    await this.prisma.notificationPreference.create({
      data: {
        userId: newUser.id,
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

    await this.prisma.barber.update({
      where: { id: invite.barberId },
      data: { userId: newUser.id },
    });

    await this.prisma.employeeInvite.update({
      where: { id: invite.id },
      data: { status: 'ACCEPTED', acceptedByUserId: newUser.id },
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
        data: { userId: null },
      });
      const active = await tx.barber.findFirst({
        where: { barbershopId: invite.barbershopId, userId, isActive: true },
      });
      if (active) {
        throw new BadRequestException('Você já está na equipe desta unidade');
      }
      await tx.barber.update({ where: { id: invite.barberId }, data: { userId } });
      await tx.employeeInvite.update({
        where: { id: invite.id },
        data: { status: 'ACCEPTED', acceptedByUserId: userId },
      });
    });
    this.realtime.notify(invite.barbershopId, 'BARBER', 'UPDATED');
    void this.activity.memberJoined(invite.barberId, userId);
    return { success: true, barbershopId: invite.barbershopId };
  }

  private async sendEmployeeInviteEmail(invite: any) {
    const frontendUrl = this.config.get<string>('FRONTEND_URL') || 'http://localhost:5173';
    const inviteUrl = `${frontendUrl}/accept-employee-invite/${invite.inviteToken}`;
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
