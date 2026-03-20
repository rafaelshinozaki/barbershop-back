import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { BarbershopService } from './barbershop.service';
import * as bcrypt from 'bcryptjs';
import { Role } from '../auth/interfaces/roles';

export type EmployeeRole = 'BarbershopEmployee' | 'BarbershopManager';
export type StaffType = 'barber' | 'manager';

export interface CreateEmployeeInviteInput {
  barbershopId: number;
  email: string;
  name: string;
  phone: string;
  role: EmployeeRole;
  specialization?: string;
  hireDate?: string;
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
  ) {}

  /**
   * Cria convite de funcionário: Barber + EmployeeInvite + envio de email.
   */
  async createInvite(userId: number, input: CreateEmployeeInviteInput) {
    await this.barbershopService.verifyBarbershopAccess(userId, input.barbershopId);

    const email = input.email.toLowerCase().trim();
    if (!email) {
      throw new BadRequestException('Email é obrigatório para enviar o convite');
    }

    const existingUser = await this.prisma.user.findFirst({
      where: { email, provider: 'local' },
    });
    if (existingUser) {
      throw new BadRequestException('Já existe um usuário com este email. Funcionários devem usar um email ainda não cadastrado.');
    }

    const existingInvite = await this.prisma.employeeInvite.findFirst({
      where: {
        email,
        barbershopId: input.barbershopId,
        status: 'PENDING',
      },
    });
    if (existingInvite) {
      throw new BadRequestException('Já existe um convite pendente para este email nesta barbearia');
    }

    const phone = input.phone.trim();
    const existingBarberByPhone = await this.prisma.barber.findFirst({
      where: { barbershopId: input.barbershopId, phone, isActive: true },
    });
    if (existingBarberByPhone) {
      throw new BadRequestException('Já existe um funcionário com este telefone nesta barbearia');
    }

    const existingBarberByEmail = await this.prisma.barber.findFirst({
      where: { barbershopId: input.barbershopId, email, isActive: true },
    });
    if (existingBarberByEmail) {
      throw new BadRequestException('Já existe um funcionário com este email nesta barbearia');
    }

    const staffType: StaffType = input.role === 'BarbershopManager' ? 'manager' : 'barber';
    const inviteToken = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const barber = await this.prisma.barber.create({
      data: {
        barbershopId: input.barbershopId,
        name: input.name.trim(),
        phone,
        email,
        specialization: input.specialization?.trim() || (staffType === 'barber' ? undefined : 'Gerente'),
        hireDate: input.hireDate ? new Date(input.hireDate) : undefined,
        staffType,
      },
    });

    const invite = await this.prisma.employeeInvite.create({
      data: {
        inviterId: userId,
        barbershopId: input.barbershopId,
        barberId: barber.id,
        email,
        inviteToken,
        role: input.role,
        expiresAt,
      },
      include: {
        inviter: { select: { fullName: true } },
        barbershop: { select: { name: true } },
      },
    });

    await this.sendEmployeeInviteEmail(invite);
    return { barber, invite };
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

    return {
      valid: true,
      email: invite.email,
      barbershopName: invite.barbershop.name,
      inviterName: invite.inviter.fullName,
      role: invite.role,
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
    if (existingUser) {
      throw new BadRequestException('Já existe uma conta com este email');
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
        idDocNumber: data.idDocNumber.replace(/\D/g, '').replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'),
        phone: data.phone.trim(),
        gender,
        birthdate,
        company: invite.barbershop.name,
        professionalSegment: 'barbershop',
        knowledgeApp: 'barbershop',
        readTerms: true,
        membership: 'FREE',
        isActive: true,
        roleId: role.id,
        trialStartDate: new Date(),
        trialEndDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });

    if (data.address && data.address.zipcode && data.address.street && data.address.city && data.address.neighborhood && data.address.state && data.address.country) {
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
        language: 'pt',
      },
    });

    await this.prisma.emailNotification.create({
      data: {
        userId: newUser.id,
        news: true,
        promotions: true,
        instability: true,
        security: true,
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

    return {
      success: true,
      userId: newUser.id,
      email: newUser.email,
      message: 'Conta criada com sucesso. Faça login para acessar.',
    };
  }

  private async sendEmployeeInviteEmail(invite: any) {
    const frontendUrl = this.config.get<string>('FRONTEND_URL') || 'http://localhost:5173';
    const inviteUrl = `${frontendUrl}/accept-employee-invite/${invite.inviteToken}`;
    const roleLabel = invite.role === 'BarbershopManager' ? 'Gerente' : 'Barbeiro';

    await this.emailService.sendTemplateEmail(
      invite.inviterId,
      'employee_invite',
      {
        InviterName: invite.inviter.fullName,
        BarbershopName: invite.barbershop.name,
        RoleLabel: roleLabel,
        InviteUrl: inviteUrl,
        AppName: 'RELABLE',
      },
      `Convite para ser ${roleLabel} na ${invite.barbershop.name}`,
      `Employee invite to ${invite.email}`,
      invite.email,
    );
  }
}
