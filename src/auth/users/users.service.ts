// src\auth\users\users.service.ts
import {
  Injectable,
  NotFoundException,
  Logger,
  BadRequestException,
  UnauthorizedException,
  HttpException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/email/email.service';
import { UserDTO } from './dto/user.dto';
import { UserSystemConfigDTO } from './dto/userSystemConfig.dto';
import { LoginHistoryDTO } from './dto/login-history.dto';
import { Prisma } from '@prisma/client';
import { Role } from '../interfaces/roles';
import * as bcrypt from 'bcryptjs';
import { faker } from '@faker-js/faker';
import { NewUserSchema } from './models/new-user.schema';
import { CustomErrorMessage } from '@/common/errors';
import { S3Service } from '@/aws/s3.service';
import { SmartLogger } from '@/common/logger.util';
import { v4 as uuidv4 } from 'uuid';
import {
  PLANO_STATUS,
  MEMBERSHIP_STATUS,
  CHANGE_PASSWORD_CODE_EXPIRY_MINUTES,
  TWO_FACTOR_CODE_EXPIRY_MINUTES,
  CHANGE_PASSWORD_MAX_ATTEMPTS,
  LOGIN_MAX_ATTEMPTS,
  LOGIN_BLOCK_MINUTES,
} from '@/common';
import { randomUUID } from 'crypto';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);
  private readonly smartLogger = new SmartLogger('UserService');
  private readonly _defaultSystemConfig = {
    theme: 'light',
    accentColor: 'bronze',
    grayColor: 'gray',
    radius: 'medium',
    scaling: '100%',
    language: 'pt',
  };

  private readonly _defaultEmailNotification = {
    news: true,
    promotions: true,
    instability: true,
    security: true,
  };

  private _temp = new Set<string>();
  private _tempExpiry = new Map<string, number>();
  private _loginCodes = new Map<
    string,
    { email: string; code: string; expiresAt: number; used: boolean }
  >();
  private _loginAttempts = new Map<string, { attempts: number; blockedUntil: number }>();

  constructor(
    private prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly s3Service: S3Service,
    private readonly configService: ConfigService,
  ) {
    // Iniciar limpeza automática de tokens expirados
    this.scheduleTokenCleanup();
  }

  private validatePassword(password: string) {
    const hasSpecialCharacter = (password: string) => /[^\w\s]/.test(password);
    const hasUpperCase = (password: string) => /[A-Z]/.test(password);
    const hasLowerCase = (password: string) => /[a-z]/.test(password);
    const hasNumber = (password: string) => /\d/.test(password);
    const hasMinLength = (password: string) => password.length > 8;

    if (
      !hasSpecialCharacter(password) ||
      !hasUpperCase(password) ||
      !hasLowerCase(password) ||
      !hasNumber(password) ||
      !hasMinLength(password)
    ) {
      throw new BadRequestException('Password does not meet the complexity requirements.');
    }
  }

  private recordFailedLogin(email: string) {
    const now = Date.now();
    let entry = this._loginAttempts.get(email);
    if (!entry || entry.blockedUntil <= now) {
      entry = { attempts: 0, blockedUntil: 0 };
    }
    entry.attempts += 1;
    if (entry.attempts >= LOGIN_MAX_ATTEMPTS) {
      entry.blockedUntil = now + LOGIN_BLOCK_MINUTES * 60 * 1000;
      entry.attempts = 0;
    }
    this._loginAttempts.set(email, entry);
  }

  // Método para agendar limpeza de tokens expirados
  private scheduleTokenCleanup(): void {
    // Limpar tokens expirados a cada 30 minutos
    setInterval(() => {
      this.cleanupExpiredTokens();
    }, 30 * 60 * 1000); // 30 minutos
  }

  // Método para limpar tokens expirados
  private cleanupExpiredTokens(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [tokenKey, expiryTime] of this._tempExpiry.entries()) {
      if (now >= expiryTime) {
        this._temp.delete(tokenKey);
        this._tempExpiry.delete(tokenKey);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.log(`Cleaned ${cleanedCount} expired password reset tokens`);
    }
  }

  async getAllUsers(page = 1, limit = 10) {
    this.logger.log(`Fetching all users with pagination - page: ${page}, limit: ${limit}`);
    const skip = (page - 1) * limit;

    try {
      const users = await this.prisma.user.findMany({
        skip,
        take: limit,
        include: {
          role: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        where: {
          deleted_at: null, // Excluir usuários deletados
        },
      });

      this.logger.log(`Found ${users.length} users`);

      // Transformar o objeto role para string (nome) para compatibilizar com o GraphQL
      const transformedUsers = users.map((user) => ({
        ...user,
        role: user.role?.name || 'User',
        membership: user.membership || 'FREE',
        isActive: user.isActive ?? true,
      }));

      this.logger.log(`Returning ${transformedUsers.length} transformed users`);
      return transformedUsers;
    } catch (error) {
      this.logger.error(`Error fetching users:`, error);
      throw error;
    }
  }

  async createUser(userData: NewUserSchema) {
    this.logger.log(`Creating user with email: ${userData.email}`);

    try {
      // Verificar se o usuário já existe
      const existingUser = await this.prisma.user.findFirst({
        where: { email: userData.email, provider: 'local' },
      });

      if (existingUser) {
        throw new HttpException('User already exists', 400);
      }

      // Hash da senha
      const hashedPassword = await bcrypt.hash(userData.password, 10);

      // Buscar role (padrão User ou roleName quando fornecido, ex: BarbershopOwner)
      const roleName = (userData as any).roleName ?? Role.USER;
      const defaultRole = await this.prisma.role.findFirst({
        where: { name: roleName },
      });

      if (!defaultRole) {
        throw new HttpException(`Role "${roleName}" not found`, 500);
      }

      // Criar usuário
      const newUser = await this.prisma.user.create({
        data: {
          email: userData.email,
          password: hashedPassword,
          fullName: userData.fullName,
          idDocNumber: userData.idDocNumber,
          phone: userData.phone,
          gender: userData.gender,
          birthdate: userData.birthdate,
          company: userData.company,
          jobTitle: userData.jobTitle,
          department: userData.department,
          professionalSegment: userData.professionalSegment,
          knowledgeApp: userData.knowledgeApp,
          readTerms: userData.readTerms,
          membership: MEMBERSHIP_STATUS.FREE,
          isActive: true,
          roleId: defaultRole.id,

          // Configurar trial de 30 dias
          trialStartDate: new Date(),
          trialEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 dias
          isInViewerMode: false,
        },
        include: {
          role: true,
          address: true,
          userSystemConfig: true,
          emailNotification: true,
        },
      });

      // Criar endereço se fornecido
      if (userData.address) {
        await this.prisma.address.create({
          data: {
            userId: newUser.id,
            zipcode: userData.address.zipcode,
            street: userData.address.street,
            city: userData.address.city,
            neighborhood: userData.address.neighborhood,
            state: userData.address.state,
            country: userData.address.country,
            complement1: userData.address.complement1 || null,
            complement2: userData.address.complement2 || null,
          },
        });
      }

      // Criar configurações do sistema
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

      // Criar configurações de email
      await this.prisma.emailNotification.create({
        data: {
          userId: newUser.id,
          news: true,
          promotions: true,
          instability: true,
          security: true,
        },
      });

      // vincular o usuário a um plano gratuito por padrão
      let freePlan = await this.prisma.plan.findFirst({ where: { name: 'Free' } });

      if (!freePlan) {
        freePlan = await this.prisma.plan.create({
          data: {
            name: 'Free',
            description: 'Plano gratuito',
            price: new Prisma.Decimal(0),
            billingCycle: 'MONTHLY',
            features: 'Funcionalidades básicas',
          },
        });
      }

      await this.prisma.subscription.create({
        data: {
          userId: newUser.id,
          planId: freePlan.id,
          startSubDate: new Date(),
          status: PLANO_STATUS.ACTIVE,
        } as any,
      });

      const { password: _pw, ...userWithoutPassword } = newUser as any;
      const result = {
        ...userWithoutPassword,
        plan: freePlan.name,
        subscriptionStatus: PLANO_STATUS.ACTIVE,
        role: newUser.role,
      } as any;

      // Enviar email de boas-vindas
      try {
        const context = {
          FullName: newUser.fullName,
          AppName: 'Relable',
          LoginURL: 'https://app.relable.com/login',
          SupportEmail: 'suporte@relable.com.br',
          Year: new Date().getFullYear(),
        };

        await this.emailService.sendTemplateEmail(
          newUser.id,
          'welcome_email',
          context,
          'Bem-vindo ao Relable',
          'welcome-email',
          newUser.email,
        );

        this.logger.log(`Welcome email sent successfully to ${newUser.email}`);
      } catch (error) {
        this.logger.warn(`Failed to send welcome email to ${newUser.email}`, error);
      }

      this.logger.log(`User created successfully: ${JSON.stringify(result, null, 2)}`);
      this.logger.log(`User ID: ${result.id}`);
      this.logger.log(`User email: ${result.email}`);
      this.logger.log(`User isActive: ${result.isActive}`);
      this.logger.log(`User role: ${JSON.stringify(result.role)}`);
      this.logger.log(`User address: ${JSON.stringify(result.address)}`);
      this.logger.log(`User userSystemConfig: ${JSON.stringify(result.userSystemConfig)}`);

      return result;
    } catch (error) {
      this.logger.error(error);
      throw new HttpException('Internal server error', 500, { cause: error });
    }
  }

  async updateUser(userDto: UserDTO) {
    this.logger.log(`Updating user with ID: ${userDto.id}`);
    this.logger.log(`Received twoFactorEnabled: ${userDto.twoFactorEnabled}`);
    this.logger.log(`Type of twoFactorEnabled: ${typeof userDto.twoFactorEnabled}`);

    const user = await this.prisma.user.findUnique({
      where: {
        id: userDto.id,
      },
    });
    if (!user) {
      this.logger.warn(`User with ID: ${userDto.id} not found`);
      throw new NotFoundException('User not found');
    }

    this.logger.log(`Current twoFactorEnabled in DB: ${user.twoFactorEnabled}`);

    const data: any = {};

    if (userDto.email !== undefined) data.email = userDto.email;
    if (userDto.password !== undefined) data.password = userDto.password;
    if (userDto.fullName !== undefined) data.fullName = userDto.fullName;
    if (userDto.phone !== undefined) data.phone = userDto.phone;
    if (userDto.birthdate !== undefined) data.birthdate = userDto.birthdate;
    if (userDto.company !== undefined) data.company = userDto.company;
    if (userDto.professionalSegment !== undefined)
      data.professionalSegment = userDto.professionalSegment;

    // Incluir twoFactorEnabled normalmente
    if ('twoFactorEnabled' in userDto) {
      data.twoFactorEnabled = Boolean(userDto.twoFactorEnabled);
      this.logger.log(`Setting twoFactorEnabled to: ${data.twoFactorEnabled}`);
    }

    this.logger.log(`Final data to update:`, JSON.stringify(data, null, 2));
    this.logger.log(`Data object keys:`, Object.keys(data));
    this.logger.log(`Data object has twoFactorEnabled:`, 'twoFactorEnabled' in data);

    if (userDto.emailNotification) {
      data.emailNotification = {
        update: {},
      };
      if (userDto.emailNotification.news !== undefined)
        data.emailNotification.update.news = userDto.emailNotification.news;
      if (userDto.emailNotification.promotions !== undefined)
        data.emailNotification.update.promotions = userDto.emailNotification.promotions;
      if (userDto.emailNotification.instability !== undefined)
        data.emailNotification.update.instability = userDto.emailNotification.instability;
      if (userDto.emailNotification.security !== undefined)
        data.emailNotification.update.security = userDto.emailNotification.security;
    }

    if (userDto.userSystemConfig) {
      data.userSystemConfig = {
        update: {},
      };
      if (userDto.userSystemConfig.theme !== undefined)
        data.userSystemConfig.update.theme = userDto.userSystemConfig.theme;
      if (userDto.userSystemConfig.accentColor !== undefined)
        data.userSystemConfig.update.accentColor = userDto.userSystemConfig.accentColor;
      if (userDto.userSystemConfig.grayColor !== undefined)
        data.userSystemConfig.update.grayColor = userDto.userSystemConfig.grayColor;
      if (userDto.userSystemConfig.radius !== undefined)
        data.userSystemConfig.update.radius = userDto.userSystemConfig.radius;
      if (userDto.userSystemConfig.scaling !== undefined)
        data.userSystemConfig.update.scaling = userDto.userSystemConfig.scaling;
      if (userDto.userSystemConfig.language !== undefined)
        data.userSystemConfig.update.language = userDto.userSystemConfig.language;
    }

    if (userDto.address) {
      data.address = {
        update: {},
      };
      if (userDto.address.zipcode !== undefined)
        data.address.update.zipcode = userDto.address.zipcode;
      if (userDto.address.street !== undefined) data.address.update.street = userDto.address.street;
      if (userDto.address.city !== undefined) data.address.update.city = userDto.address.city;
      if (userDto.address.neighborhood !== undefined)
        data.address.update.neighborhood = userDto.address.neighborhood;
      if (userDto.address.state !== undefined) data.address.update.state = userDto.address.state;
    }

    // Atualizar tudo de uma vez só
    const updatedUser = await this.prisma.user.update({
      where: {
        id: userDto.id,
      },
      data: data,
    });

    this.logger.log(
      `User updated successfully. New twoFactorEnabled: ${updatedUser.twoFactorEnabled}`,
    );
    this.logger.log(`Updated user object:`, JSON.stringify(updatedUser, null, 2));
    return updatedUser;
  }

  async removeUser(userId: number) {
    this.logger.log(`Removing user with ID: ${userId}`);
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
    });
    if (!user) {
      this.logger.warn(`User with ID: ${userId} not found`);
      throw new NotFoundException('User not found');
    }

    return await this.prisma.user.delete({
      where: {
        id: userId,
      },
    });
  }

  async getUserByEmail(email: string, provider = 'local'): Promise<UserDTO | null> {
    return this.prisma.user.findFirst({
      where: { email, provider },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        idDocNumber: true,
        gender: true,
        birthdate: true,
        company: true,
        professionalSegment: true,
        knowledgeApp: true,
        readTerms: true,
        membership: true,
        isActive: true,
        photoKey: true,
        twoFactorEnabled: true,
        role: {
          select: {
            id: true,
            name: true,
          },
        },
        address: {
          select: {
            street: true,
            city: true,
            neighborhood: true,
            zipcode: true,
            state: true,
            country: true,
          },
        },
        userSystemConfig: {
          select: {
            theme: true,
            accentColor: true,
            grayColor: true,
            radius: true,
            scaling: true,
            language: true,
          },
        },
        emailNotification: {
          select: {
            news: true,
            promotions: true,
            instability: true,
            security: true,
          },
        },
        subscriptions: {
          where: { status: PLANO_STATUS.ACTIVE },
          select: { status: true, plan: { select: { name: true } } },
          take: 1,
        },
      },
    }) as unknown as Promise<UserDTO | null>;
  }

  async findOrCreateSocialUser(email: string, name: string, provider: string): Promise<UserDTO> {
    let user = await this.prisma.user.findFirst({
      where: { email, provider },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        idDocNumber: true,
        gender: true,
        birthdate: true,
        company: true,
        professionalSegment: true,
        knowledgeApp: true,
        readTerms: true,
        membership: true,
        isActive: true,
        photoKey: true,
        twoFactorEnabled: true,
        provider: true,
        role: {
          select: {
            id: true,
            name: true,
          },
        },
        address: {
          select: {
            street: true,
            city: true,
            neighborhood: true,
            zipcode: true,
            state: true,
            country: true,
          },
        },
        userSystemConfig: {
          select: {
            theme: true,
            accentColor: true,
            grayColor: true,
            radius: true,
            scaling: true,
            language: true,
          },
        },
        emailNotification: {
          select: {
            news: true,
            promotions: true,
            instability: true,
            security: true,
          },
        },
        subscriptions: {
          where: { status: PLANO_STATUS.ACTIVE },
          select: { status: true, plan: { select: { name: true } } },
          take: 1,
        },
      },
    });

    if (!user) {
      const userRole = await this.prisma.role.findFirst({
        where: { name: Role.USER },
      });

      user = await this.prisma.user.create({
        data: {
          email,
          provider,
          password: await bcrypt.hash(faker.internet.password(), 10),
          fullName: name,
          idDocNumber: 'SOCIAL',
          phone: '',
          gender: '',
          birthdate: new Date(),
          company: '',
          professionalSegment: '',
          knowledgeApp: 'social',
          readTerms: true,
          isActive: true,
          roleId: userRole.id,
          address: {
            create: {
              zipcode: '',
              street: '',
              city: '',
              neighborhood: '',
              state: '',
              country: '',
            },
          },
          userSystemConfig: {
            create: this._defaultSystemConfig,
          },
          emailNotification: {
            create: this._defaultEmailNotification,
          },
        },
        include: {
          role: {
            select: {
              id: true,
              name: true,
            },
          },
          address: {
            select: {
              street: true,
              city: true,
              neighborhood: true,
              zipcode: true,
              state: true,
              country: true,
            },
          },
          userSystemConfig: {
            select: {
              theme: true,
              accentColor: true,
              grayColor: true,
              radius: true,
              scaling: true,
              language: true,
            },
          },
          emailNotification: {
            select: {
              news: true,
              promotions: true,
              instability: true,
              security: true,
            },
          },
          subscriptions: {
            where: { status: PLANO_STATUS.ACTIVE },
            select: { status: true, plan: { select: { name: true } } },
            take: 1,
          },
        },
      });

      // Enviar email de boas-vindas para usuários sociais recém-criados
      try {
        const context = {
          FullName: user.fullName,
          AppName: 'Relable',
          LoginURL: 'https://app.relable.com/login',
          SupportEmail: 'suporte@relable.com.br',
          Year: new Date().getFullYear(),
        };

        await this.emailService.sendTemplateEmail(
          user.id,
          'welcome_email',
          context,
          'Bem-vindo ao Relable',
          'welcome-email',
          user.email,
        );

        this.logger.log(`Welcome email sent successfully to social user ${user.email}`);
      } catch (error) {
        this.logger.warn(`Failed to send welcome email to social user ${user.email}`, error);
      }
    }
    const sub = await this.prisma.subscription.findFirst({
      where: { userId: user.id, status: PLANO_STATUS.ACTIVE },
      include: { plan: true },
    });

    const { password: _pw, ...userWithoutPassword } = user as any;
    return {
      ...userWithoutPassword,
      plan: sub?.plan?.name,
      subscriptionStatus: sub?.status,
      role: user.role,
    } as any;
  }

  async getUserById(userId: number) {
    this.logger.log(`Fetching user by ID: ${userId}`);
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
      },
      select: {
        id: true,
        role: {
          select: {
            id: true,
            name: true,
          },
        },
        createdAt: true,
        updatedAt: true,
        email: true,
        fullName: true,
        idDocNumber: true,
        phone: true,
        gender: true,
        birthdate: true,
        company: true,
        professionalSegment: true,
        knowledgeApp: true,
        readTerms: true,
        membership: true,
        isActive: true,
        photoKey: true,
        twoFactorEnabled: true,
        subscriptions: {
          where: { status: PLANO_STATUS.ACTIVE },
          select: { status: true, plan: { select: { name: true } } },
          take: 1,
        },
        address: {
          select: {
            street: true,
            city: true,
            neighborhood: true,
            zipcode: true,
            state: true,
            country: true,
          },
        },
        emailNotification: {
          select: {
            id: true,
            news: true,
            promotions: true,
            instability: true,
            security: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        userSystemConfig: {
          select: {
            theme: true,
            accentColor: true,
            grayColor: true,
            radius: true,
            scaling: true,
            language: true,
          },
        },
      },
    });

    if (!user) {
      this.logger.warn(`User with ID: ${userId} not found`);
      throw new NotFoundException('User not found');
    }

    this.smartLogger.logEssential('User found', user, [
      'id',
      'email',
      'isActive',
      'role',
      'address',
      'userSystemConfig',
    ]);

    // Transformar o objeto role para string (nome) para compatibilizar com o GraphQL
    return {
      ...user,
      role: user.role?.name || 'User',
      membership: user.membership || 'FREE',
      isActive: user.isActive ?? true,
    };
  }

  async forgotPasswordByEmail(email: string, password: string) {
    this.logger.log(`Forgot password request for email: ${email}`);

    const user = await this.prisma.user.findFirst({
      where: { email, provider: 'local' },
    });

    if (!user) {
      this.logger.warn(`User with email: ${email} not found`);
      throw new NotFoundException('User not found');
    }

    this.validatePassword(password);

    const isSame = await bcrypt.compare(password, user.password);
    if (isSame) {
      throw new BadRequestException('New password must be different from the current password');
    }

    const newPassword = await bcrypt.hash(password, 10);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: newPassword },
    });

    this.logger.log(`Password for user with email: ${email} has been updated`);

    const context = {
      FullName: user.fullName,
      AppName: 'Relable',
      SupportEmail: 'suporte@relable.com.br',
      Year: new Date().getFullYear(),
    };

    await this.emailService.sendTemplateEmail(
      user.id,
      'password_changed',
      context,
      'Senha Alterada',
      'password-changed',
      email,
    );

    // expire all pending password recovery links for this email
    for (const key of Array.from(this._temp)) {
      if (key.startsWith(`${email}.`) && !key.includes('.change.')) {
        this._temp.delete(key);
      }
    }
  }

  async forgotPass(forgotPass: any) {
    this.logger.log(`Password reset`);

    const user = await this.prisma.user.findFirst({
      where: { email: forgotPass.email, provider: 'local' },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const token = randomUUID();
    const expiryTime = Date.now() + 2 * 60 * 60 * 1000; // 2 horas de expiração

    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
    const resetURL = `${frontendUrl}/forgot-password/${token}?email=${forgotPass.email}`;
    console.log('UserService: Generated reset URL:', resetURL);

    const context = {
      FullName: user.fullName,
      AppName: 'Relable - ' + token,
      // AppName: 'Relable',
      ResetURL: resetURL,
      ExpirationHours: 2,
      SupportEmail: 'suporte@relable.com.br',
      Year: new Date().getFullYear(),
    };

    await this.emailService.sendTemplateEmail(
      user.id,
      'password_reset',
      context,
      'Redefinição de Senha',
      'password-reset',
      forgotPass.email,
    );

    const tokenKey = `${forgotPass.email}.${token}`;
    this._temp.add(tokenKey);
    this._tempExpiry.set(tokenKey, expiryTime);

    console.log('UserService: Token stored:', tokenKey);
    console.log('UserService: Token expiry time:', expiryTime);
    console.log('UserService: Current tokens in _temp:', Array.from(this._temp));

    return true;
  }

  async forgotPassCheck(data: { token: string; email: string }) {
    console.log('UserService: forgotPassCheck called with data:', data);
    const tokenKey = `${data.email}.${data.token}`;
    console.log('UserService: Token key:', tokenKey);
    console.log('UserService: Current tokens in _temp:', Array.from(this._temp));
    console.log('UserService: Current expiry times:', Array.from(this._tempExpiry.entries()));

    // Verificar se o token existe e não expirou
    if (this._temp.has(tokenKey)) {
      console.log('UserService: Token found in _temp');
      const expiryTime = this._tempExpiry.get(tokenKey);
      console.log('UserService: Token expiry time:', expiryTime);
      console.log('UserService: Current time:', Date.now());

      if (expiryTime && Date.now() < expiryTime) {
        // Token válido e não expirado
        console.log('UserService: Token is valid and not expired');
        return true;
      } else {
        // Token expirado, remover
        console.log('UserService: Token is expired, removing');
        this._temp.delete(tokenKey);
        this._tempExpiry.delete(tokenKey);
        return false;
      }
    }

    // Token não encontrado, não deletar nada
    console.log('UserService: Token not found in _temp');
    return false;
  }

  async resetPasswordByToken(email: string, token: string, newPassword: string) {
    this.logger.log(`Password reset by token for email: ${email}`);

    const tokenKey = `${email}.${token}`;

    // Verificar se o token é válido e não expirou
    if (!this._temp.has(tokenKey)) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const expiryTime = this._tempExpiry.get(tokenKey);
    if (!expiryTime || Date.now() >= expiryTime) {
      // Token expirado, remover
      this._temp.delete(tokenKey);
      this._tempExpiry.delete(tokenKey);
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Buscar o usuário
    const user = await this.prisma.user.findFirst({
      where: { email, provider: 'local' },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Validar a nova senha
    this.validatePassword(newPassword);

    // Verificar se a nova senha é diferente da atual
    const isSame = await bcrypt.compare(newPassword, user.password);
    if (isSame) {
      throw new BadRequestException('New password must be different from the current password');
    }

    // Hash da nova senha
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Atualizar a senha
    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    this.logger.log(`Password for user with email: ${email} has been updated`);

    // Remover o token usado
    this._temp.delete(tokenKey);
    this._tempExpiry.delete(tokenKey);

    // Expirar todos os outros tokens pendentes para este email
    for (const key of Array.from(this._temp)) {
      if (key.startsWith(`${email}.`) && !key.includes('.change.')) {
        this._temp.delete(key);
        this._tempExpiry.delete(key);
      }
    }

    // Enviar email de confirmação
    const context = {
      FullName: user.fullName,
      AppName: 'Relable',
      SupportEmail: 'suporte@relable.com.br',
      Year: new Date().getFullYear(),
    };

    await this.emailService.sendTemplateEmail(
      user.id,
      'password_changed',
      context,
      'Senha Alterada',
      'password-changed',
      user.email,
    );
  }

  async resetPassword(userId: number, newPassword: string) {
    this.logger.log(`Password reset request for userId: ${userId}`);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      this.logger.warn(`User with id: ${userId} not found`);
      throw new NotFoundException('User not found');
    }

    this.validatePassword(newPassword);

    const isSame = await bcrypt.compare(newPassword, user.password);
    if (isSame) {
      throw new BadRequestException('New password must be different from the current password');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    this.logger.log(`Password for user with id: ${userId} has been updated`);

    // expire all pending password recovery links for this user
    for (const key of Array.from(this._temp)) {
      if (key.startsWith(`${user.email}.`) && !key.includes('.change.')) {
        this._temp.delete(key);
        this._tempExpiry.delete(key);
      }
    }

    const context = {
      FullName: user.fullName,
      AppName: 'Relable',
      SupportEmail: 'suporte@relable.com.br',
      Year: new Date().getFullYear(),
    };

    await this.emailService.sendTemplateEmail(
      user.id,
      'password_changed',
      context,
      'Senha Alterada',
      'password-changed',
      user.email,
    );
  }

  async verifyUser(
    email: string,
    password: string,
    deviceType?: string,
    browser?: string,
    os?: string,
    ip?: string,
    location?: string,
  ) {
    this.logger.log(`Verifying user with email: ${email}`);
    const attempt = this._loginAttempts.get(email);
    if (attempt && attempt.blockedUntil > Date.now()) {
      throw new UnauthorizedException('Too many login attempts. Please try again later.');
    }
    const user = await this.prisma.user.findFirst({
      where: {
        email,
        provider: 'local',
      },
      select: {
        id: true,
        email: true,
        password: true,
        provider: true,
        fullName: true,
        idDocNumber: true,
        phone: true,
        gender: true,
        birthdate: true,
        company: true,
        jobTitle: true,
        department: true,
        professionalSegment: true,
        knowledgeApp: true,
        readTerms: true,
        membership: true,
        isActive: true,
        stripeCustomerId: true,
        twoFactorEnabled: true,
        photoKey: true,
        createdAt: true,
        updatedAt: true,
        deleted_at: true,
        role: {
          select: {
            id: true,
            name: true,
          },
        },
        address: {
          select: {
            id: true,
            zipcode: true,
            street: true,
            city: true,
            neighborhood: true,
            state: true,
            country: true,
            complement1: true,
            complement2: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        userSystemConfig: {
          select: {
            id: true,
            theme: true,
            accentColor: true,
            grayColor: true,
            radius: true,
            scaling: true,
            language: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        emailNotification: {
          select: {
            news: true,
            promotions: true,
            instability: true,
            security: true,
          },
        },
      },
    });
    if (!user) {
      this.recordFailedLogin(email);
      throw new NotFoundException('User not found');
    }

    // Verificar se o usuário está ativo
    if (!user.isActive) {
      this.recordFailedLogin(email);
      throw new UnauthorizedException('Account is not active. Please contact support.');
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      this.recordFailedLogin(email);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Gravar histórico de login
    await this.prisma.loginHistory.create({
      data: {
        userId: user.id,
        deviceType: deviceType || 'Unknown',
        browser: browser || 'Unknown',
        os: os || 'Unknown',
        ip: ip || 'Unknown',
        location: location || 'Unknown',
      },
    });

    // Aqui você pode adicionar lógica para sessões ativas, se necessário

    return user;
  }

  async isPasswordValid(email: string, password: string): Promise<boolean> {
    const user = await this.prisma.user.findFirst({
      where: { email, provider: 'local' },
    });
    if (!user) {
      return false;
    }
    return bcrypt.compare(password, user.password);
  }

  async getLoginHistory(
    userId: number,
    page = 1,
    limit = 10,
  ): Promise<{
    data: LoginHistoryDTO[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const skip = (page - 1) * limit;

    // Consulta real ao banco de dados
    const [total, history] = await this.prisma.$transaction([
      this.prisma.loginHistory.count({ where: { userId } }),
      this.prisma.loginHistory.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: history.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getActiveSessions(
    userId: number,
    page = 1,
    limit = 10,
    currentIp?: string,
  ): Promise<{
    data: any[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const skip = (page - 1) * limit;

    // Consulta real ao banco de dados
    const [total, sessions] = await this.prisma.$transaction([
      this.prisma.activeSession.count({ where: { userId } }),
      this.prisma.activeSession.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    // Adiciona isCurrent baseado no IP atual, se fornecido
    const data = sessions.map((session) => ({
      ...session,
      isCurrent: currentIp ? session.ip === currentIp : false,
    }));

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async terminateSession(userId: number, sessionId: number, currentIp: string): Promise<void> {
    // Buscar a sessão
    const session = await (this.prisma as any).activeSession?.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    // Verificar se não é a sessão atual
    if (session.ip === currentIp) {
      throw new BadRequestException('Cannot terminate current session');
    }

    // Remover a sessão
    await (this.prisma as any).activeSession?.delete({
      where: { id: sessionId },
    });

    this.logger.log(`Session ${sessionId} terminated for user ${userId}`);
  }

  async getAllSessions(userId: number) {
    const [history, active] = await this.prisma.$transaction([
      (this.prisma as any).loginHistory?.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
      (this.prisma as any).activeSession?.findMany({
        where: { userId },
      }),
    ]);

    const activeSet = new Set(
      active.map(
        (a) =>
          `${a.deviceType}|${a.browser}|${a.os}|${a.ip}|${a.location}|${a.createdAt.toISOString()}`,
      ),
    );

    const activeHistory = [] as typeof history;
    const inactiveHistory = [] as typeof history;

    for (const session of history) {
      const key = `${session.deviceType}|${session.browser}|${session.os}|${session.ip}|${
        session.location
      }|${session.createdAt.toISOString()}`;
      if (activeSet.has(key)) activeHistory.push(session);
      else inactiveHistory.push(session);
    }

    return { active: activeHistory, inactive: inactiveHistory };
  }

  async updateUserSystemConfig(
    userId: number,
    updateConfigDto: UserSystemConfigDTO,
  ): Promise<boolean> {
    this.logger.log(
      `Updating user system config for user ID: ${userId} and config: ${JSON.stringify(
        updateConfigDto,
      )}`,
    );

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { userSystemConfig: true, address: true },
    });

    if (!user) {
      this.logger.error(`User with ID ${userId} not found`);
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    this.logger.log(`Found user: ${user.email}, current config:`, user.userSystemConfig);

    try {
      // Filtrar apenas os campos que foram fornecidos
      const configToUpdate = Object.fromEntries(
        Object.entries(updateConfigDto).filter(([_, value]) => value !== undefined),
      );

      this.logger.log(`Filtered config to update:`, configToUpdate);

      // Verificar se o usuário já tem configurações
      if (user.userSystemConfig) {
        // Atualizar configurações existentes
        await this.prisma.userSystemConfig.update({
          where: { userId: userId },
          data: configToUpdate,
        });
      } else {
        // Criar novas configurações
        await this.prisma.userSystemConfig.create({
          data: {
            userId: userId,
            theme: configToUpdate.theme || 'light',
            accentColor: configToUpdate.accentColor || 'bronze',
            grayColor: configToUpdate.grayColor || 'gray',
            radius: configToUpdate.radius || 'medium',
            scaling: configToUpdate.scaling || '100%',
            language: configToUpdate.language || 'en',
          },
        });
      }

      this.logger.log(`Successfully updated user system config for user ${userId}`);
      return true;
    } catch (error) {
      this.logger.error(`Error updating user system config for user ${userId}:`, error);
      throw error;
    }
  }

  async sendChangePasswordCode(email: string) {
    console.log('UserService: sendChangePasswordCode called with email:', email);

    const user = await this.prisma.user.findFirst({
      where: { email, provider: 'local' },
    });
    if (!user) {
      console.log('UserService: User not found for email:', email);
      throw new NotFoundException('User not found');
    }

    console.log('UserService: Found user:', { id: user.id, email: user.email });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiryTime = new Date(Date.now() + CHANGE_PASSWORD_CODE_EXPIRY_MINUTES * 60 * 1000);

    console.log('UserService: Generated code:', code);
    console.log('UserService: Code expiry time:', expiryTime);

    await this.prisma.verificationCode.create({
      data: {
        code,
        userId: user.id,
        expiresAt: expiryTime,
      },
    });

    console.log('UserService: Verification code saved to database');

    const context = {
      FullName: user.fullName,
      AppName: 'Relable',
      VerificationCode: code,
      SupportEmail: 'suporte@relable.com.br',
      Year: new Date().getFullYear(),
    };

    await this.emailService.sendTemplateEmail(
      user.id,
      'verification_code',
      context,
      'Código de verificação',
      'change-password-code',
      email,
    );

    console.log('UserService: Verification code email sent');
    return true;
  }

  async verifyChangePasswordCode(userId: number, code: string, consume = false) {
    console.log('UserService: verifyChangePasswordCode called with:', { userId, code, consume });

    const record = await this.prisma.verificationCode.findFirst({
      where: { userId, used: false },
      orderBy: { createdAt: 'desc' },
    });

    console.log('UserService: Found verification code record:', record);

    if (!record) {
      console.log('UserService: No verification code record found');
      return false;
    }

    console.log('UserService: Record expiry time:', record.expiresAt);
    console.log('UserService: Current time:', new Date());
    console.log('UserService: Is expired?', record.expiresAt < new Date());

    if (record.expiresAt < new Date()) {
      console.log('UserService: Code is expired, marking as used');
      await this.prisma.verificationCode.update({
        where: { id: record.id },
        data: { used: true },
      });
      return false;
    }

    console.log('UserService: Comparing codes - expected:', record.code, 'received:', code);
    if (record.code !== code) {
      console.log('UserService: Code mismatch');
      const attempts = record.attempts + 1;
      console.log('UserService: Incrementing attempts to:', attempts);
      await this.prisma.verificationCode.update({
        where: { id: record.id },
        data: {
          attempts,
          used: attempts >= CHANGE_PASSWORD_MAX_ATTEMPTS,
        },
      });
      return false;
    }

    console.log('UserService: Code is valid');
    if (consume) {
      console.log('UserService: Consuming code');
      await this.prisma.verificationCode.update({
        where: { id: record.id },
        data: { used: true },
      });
    }

    return true;
  }

  async changePassword(
    userId: number,
    email: string,
    oldPassword: string,
    newPassword: string,
    code: string,
  ) {
    console.log('UserService: changePassword called with:', { userId, email, code });

    const valid = await this.verifyChangePasswordCode(userId, code, true);
    console.log('UserService: Code verification result:', valid);

    if (!valid) {
      console.log('UserService: Code verification failed');
      throw new UnauthorizedException('Invalid or expired verification code');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      console.log('UserService: User not found');
      throw new NotFoundException('User not found');
    }

    if (user.email !== email) {
      console.log('UserService: Email mismatch');
      throw new UnauthorizedException('Invalid email');
    }

    const isValid = await bcrypt.compare(oldPassword, user.password);
    console.log('UserService: Current password validation:', isValid);

    if (!isValid) {
      console.log('UserService: Current password is invalid');
      throw new UnauthorizedException('Invalid current password');
    }

    this.validatePassword(newPassword);

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    console.log('UserService: Password updated successfully');

    // Enviar email de confirmação de alteração de senha
    try {
      const userWithConfig = await this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          userSystemConfig: {
            select: { language: true },
          },
        },
      });

      const lang = userWithConfig?.userSystemConfig?.language?.toLowerCase() || 'pt';

      const subjects = {
        pt: 'Senha alterada com sucesso',
        en: 'Password changed successfully',
        es: 'Contraseña cambiada con éxito',
      };

      const context = {
        FullName: user.fullName,
        AppName: 'Relable',
        SupportEmail: 'suporte@relable.com.br',
        Year: new Date().getFullYear(),
      };

      await this.emailService.sendTemplateEmail(
        user.id,
        'password_changed',
        context,
        subjects[lang] || subjects.pt,
        'password-changed-confirmation',
        user.email,
      );
    } catch (error) {
      this.logger.error(`Failed to send password changed confirmation email: ${error.message}`);
      // Não falhar o processo se o email não puder ser enviado
    }

    return true;
  }

  async setTwoFactor(userId: number, enabled: boolean) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: enabled },
    });
    return true;
  }

  async sendTwoFactorCode(user: UserDTO) {
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    const context = {
      FullName: user.fullName,
      AppName: 'Relable',
      VerificationCode: code,
      SupportEmail: 'suporte@relable.com.br',
      Year: new Date().getFullYear(),
    };

    await this.emailService.sendTemplateEmail(
      user.id,
      'verification_code',
      context,
      'Código de verificação',
      'enable-2fa',
      user.email,
    );

    this._temp.add(`${user.email}.enable2fa.${code}`);

    return true;
  }

  async verifyTwoFactorCode(email: string, code: string) {
    const key = `${email}.enable2fa.${code}`;
    const user = await this.prisma.user.findFirst({
      where: { email, provider: 'local' },
    });
    if (user && this._temp.has(key)) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { twoFactorEnabled: true },
      });
      this._temp.delete(key);
      return true;
    }
    throw new UnauthorizedException('Invalid verification code');
  }

  async sendLoginCode(user: UserDTO, loginId: string) {
    this.logger.log(`Sending login code - loginId: ${loginId}, user: ${user.email}`);

    // Invalidar códigos anteriores do mesmo usuário
    for (const [existingLoginId, entry] of this._loginCodes.entries()) {
      if (entry.email === user.email && !entry.used) {
        this.logger.log(
          `Invalidating previous code for user ${user.email} - loginId: ${existingLoginId}`,
        );
        this._loginCodes.delete(existingLoginId);
      }
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    this.logger.log(`Generated code: ${code}`);

    const context = {
      FullName: user.fullName,
      AppName: 'Relable',
      VerificationCode: code,
      SupportEmail: 'suporte@relable.com.br',
      Year: new Date().getFullYear(),
    };

    try {
      await this.emailService.sendTemplateEmail(
        user.id,
        'verification_code',
        context,
        'Código de verificação',
        'login-code',
        user.email,
      );
    } catch (error) {
      this.logger.error(`Failed to send email for login code: ${error.message}`);
      // Em desenvolvimento, podemos continuar sem enviar o email
      // Em produção, você pode querer tratar isso de forma diferente
      console.log(`DEVELOPMENT: Login code for ${user.email} is: ${code}`);
    }

    this._loginCodes.set(loginId, {
      email: user.email,
      code,
      expiresAt: Date.now() + TWO_FACTOR_CODE_EXPIRY_MINUTES * 60 * 1000,
      used: false,
    });

    this.logger.log(`Login code stored - loginId: ${loginId}, code: ${code}`);
    this.logger.log(`Total login codes in memory: ${this._loginCodes.size}`);

    return true;
  }

  async verifyLoginCode(loginId: string, code: string) {
    this.logger.log(`Verifying login code - loginId: ${loginId}, code: ${code}`);
    this.logger.log(`Available login codes: ${Array.from(this._loginCodes.keys()).join(', ')}`);

    const entry = this._loginCodes.get(loginId);
    this.logger.log(`Found entry: ${entry ? JSON.stringify(entry) : 'null'}`);

    if (!entry || entry.code !== code || entry.used) {
      this.logger.error(
        `Invalid verification code - entry exists: ${!!entry}, code matches: ${
          entry?.code === code
        }, used: ${entry?.used}`,
      );
      throw new UnauthorizedException('Invalid verification code');
    }
    if (entry.expiresAt < Date.now()) {
      this._loginCodes.delete(loginId);
      throw new UnauthorizedException('Invalid or expired verification code');
    }
    const { email } = entry;
    const user = await this.prisma.user.findFirst({
      where: { email, provider: 'local' },
      include: {
        subscriptions: {
          where: { status: PLANO_STATUS.ACTIVE },
          select: { status: true, plan: { select: { name: true } } },
          take: 1,
        },
        role: true,
      },
    });
    if (user) {
      entry.used = true;
      this._loginCodes.set(loginId, entry);
      const sub = user.subscriptions?.[0];
      const { password: _pw, ...userWithoutPassword } = user as any;
      return {
        ...userWithoutPassword,
        plan: sub?.plan?.name,
        subscriptionStatus: sub?.status,
        role: user.role,
      } as any;
    }
    throw new UnauthorizedException('Invalid verification code');
  }

  async listUsersByFilter(
    plan?: string,
    status?: string,
    subscriptionStatus?: string,
    role?: string,
    name?: string,
    email?: string,
    page = 1,
    limit = 10,
  ) {
    this.smartLogger.log('Received filters', {
      plan,
      status,
      subscriptionStatus,
      role,
      name,
      email,
      page,
      limit,
    });

    const where: Prisma.UserWhereInput = {};

    if (status && status.trim()) {
      const normalized = status.toLowerCase();
      if (normalized === 'active') where.isActive = true;
      if (normalized === 'inactive') where.isActive = false;
      if (normalized === 'past_due') where.membership = MEMBERSHIP_STATUS.PAST_DUE;
      if (normalized === 'paid') where.membership = MEMBERSHIP_STATUS.PAID;
      if (normalized === 'free') where.membership = MEMBERSHIP_STATUS.FREE;
    }

    if (role && role.trim()) {
      where.role = { name: { equals: role } } as any;
    }

    if (name && name.trim()) {
      this.smartLogger.log('Applying name filter', name);
      where.fullName = { contains: name } as any;
    }

    if (email && email.trim()) {
      this.smartLogger.log('Applying email filter', email);
      where.email = { contains: email } as any;
    }

    if (plan || subscriptionStatus) {
      const subWhere: Prisma.SubscriptionWhereInput = {};
      if (plan) {
        subWhere.plan = { name: { equals: plan } } as any;
        subWhere.status = PLANO_STATUS.ACTIVE;
      }
      if (subscriptionStatus) {
        const normalized = subscriptionStatus.toUpperCase();
        if (normalized === PLANO_STATUS.ACTIVE || normalized === PLANO_STATUS.INACTIVE) {
          subWhere.status = normalized as PLANO_STATUS;
        }
      }
      where.subscriptions = { some: subWhere } as any;
    }

    this.smartLogger.logEssential('Final where clause', where, ['isActive', 'membership', 'role']);

    const skip = (page - 1) * limit;

    try {
      const [users, total] = await this.prisma.$transaction([
        this.prisma.user.findMany({
          where,
          include: { subscriptions: { include: { plan: true } }, role: true },
          skip,
          take: limit,
        }),
        this.prisma.user.count({ where }),
      ]);

      this.smartLogger.log('Query result', {
        usersCount: users.length,
        total,
        page,
        limit,
      });

      // Transformar o objeto role para string (nome) para compatibilizar com o GraphQL
      const transformedUsers = users.map((user) => ({
        ...user,
        role: user.role?.name || 'User',
        membership: user.membership || 'FREE',
        isActive: user.isActive ?? true,
      }));

      this.smartLogger.log('Returning transformed users', {
        count: transformedUsers.length,
        firstUser: transformedUsers[0]
          ? { id: transformedUsers[0].id, email: transformedUsers[0].email }
          : null,
      });

      return { data: transformedUsers, page, limit, total };
    } catch (error) {
      this.smartLogger.error('Error in listUsersByFilter:', error);
      throw error;
    }
  }

  async setUserActive(userId: number, active: boolean) {
    await this.prisma.user.update({ where: { id: userId }, data: { isActive: active } });
  }

  async setMultipleUsersActive(userIds: number[], active: boolean) {
    if (!userIds || userIds.length === 0) {
      throw new BadRequestException('User IDs array cannot be empty');
    }

    const result = await this.prisma.user.updateMany({
      where: {
        id: {
          in: userIds,
        },
      },
      data: {
        isActive: active,
      },
    });

    this.logger.log(`Updated ${result.count} users to active status: ${active}`);
    return {
      success: true,
      updatedCount: result.count,
      message: `${result.count} users ${active ? 'activated' : 'deactivated'} successfully`,
    };
  }

  async changeMultipleUsersPlan(userIds: number[], planName: string) {
    if (!userIds || userIds.length === 0) {
      throw new BadRequestException('User IDs array cannot be empty');
    }

    // Verificar se o plano existe
    const plan = await this.prisma.plan.findFirst({
      where: { name: { equals: planName } },
    });

    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    // Buscar todas as assinaturas ativas dos usuários
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        userId: {
          in: userIds,
        },
        status: PLANO_STATUS.ACTIVE,
      },
    });

    if (subscriptions.length === 0) {
      throw new BadRequestException('No active subscriptions found for the selected users');
    }

    // Atualizar todas as assinaturas encontradas
    const updatePromises = subscriptions.map((subscription) =>
      this.prisma.subscription.update({
        where: { id: subscription.id },
        data: { planId: plan.id },
      }),
    );

    await Promise.all(updatePromises);

    this.logger.log(`Updated ${subscriptions.length} subscriptions to plan: ${planName}`);
    return {
      success: true,
      updatedCount: subscriptions.length,
      message: `${subscriptions.length} users plan changed to ${planName} successfully`,
    };
  }

  async updatePaymentStatus(userId: number, status: MEMBERSHIP_STATUS) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { membership: status, isActive: status === MEMBERSHIP_STATUS.PAID },
    });
  }

  async changeUserPlan(userId: number, planName: string) {
    const plan = await this.prisma.plan.findFirst({
      where: { name: { equals: planName } },
    });
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    const sub = await this.prisma.subscription.findFirst({
      where: { userId, status: PLANO_STATUS.ACTIVE },
    });

    if (!sub) {
      throw new NotFoundException('Subscription not found');
    }

    await this.prisma.subscription.update({
      where: { id: sub.id },
      data: { planId: plan.id },
    });
  }

  async generatePhotoUploadUrl(
    userId: number,
    fileExtension?: string,
    contentType?: string,
  ): Promise<string> {
    // Validar extensão do arquivo
    const allowedExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
    const extension = fileExtension?.toLowerCase().replace('.', '') || 'jpg';

    if (!allowedExtensions.includes(extension)) {
      throw new BadRequestException('Invalid file extension. Allowed: jpg, jpeg, png, gif, webp');
    }

    const key = `users/${userId}/${uuidv4()}.${extension}`;
    await this.prisma.user.update({ where: { id: userId }, data: { photoKey: key } });
    return this.s3Service.getUploadUrl(key, contentType);
  }

  async getPhotoDownloadUrl(userId: number): Promise<string> {
    this.logger.log(`Getting photo download URL for user ID: ${userId}`);
    const user = await this.prisma.user.findFirst({ where: { id: userId } });
    this.logger.log(`User found:`, { userId, photoKey: user?.photoKey });

    if (!user?.photoKey) {
      this.logger.warn(`No photoKey found for user ID: ${userId}`);
      throw new NotFoundException('Photo not found');
    }

    const downloadUrl = await this.s3Service.getDownloadUrl(user.photoKey);
    this.logger.log(`Generated download URL for user ID ${userId}:`, downloadUrl);
    return downloadUrl;
  }

  async importUsersFromCsv(usersData: any[]): Promise<{
    totalProcessed: number;
    successCount: number;
    errorCount: number;
    errors: Array<{ row: number; email: string; error: string }>;
    success: Array<{ email: string; fullName: string }>;
  }> {
    this.logger.log(`Starting import of ${usersData.length} users`);
    this.logger.log('Raw data received:', JSON.stringify(usersData, null, 2));

    const result = {
      totalProcessed: usersData.length,
      successCount: 0,
      errorCount: 0,
      errors: [] as Array<{ row: number; email: string; error: string }>,
      success: [] as Array<{ email: string; fullName: string }>,
    };

    // Buscar role padrão (USER)
    const userRole = await this.prisma.role.findFirst({
      where: { name: Role.USER },
    });

    if (!userRole) {
      throw new BadRequestException('Default user role not found');
    }

    // Processar cada usuário
    for (let i = 0; i < usersData.length; i++) {
      const userData = usersData[i];
      const rowNumber = i + 2; // +2 porque o CSV tem header e arrays começam em 0

      try {
        // Validar se o email já existe
        const existingUser = await this.prisma.user.findFirst({
          where: {
            email: userData.email,
            provider: 'local',
          },
        });

        if (existingUser) {
          result.errors.push({
            row: rowNumber,
            email: userData.email,
            error: 'Email já está registrado',
          });
          result.errorCount++;
          continue;
        }

        // Validar senha
        try {
          this.validatePassword(userData.password);
        } catch (error) {
          result.errors.push({
            row: rowNumber,
            email: userData.email,
            error: 'Senha não atende aos requisitos de complexidade',
          });
          result.errorCount++;
          continue;
        }

        // Converter isActive para boolean
        let isActive = false;
        if (userData.isActive !== undefined && userData.isActive !== null) {
          if (typeof userData.isActive === 'string') {
            isActive = userData.isActive.toLowerCase() === 'true' || userData.isActive === '1';
          } else {
            isActive = Boolean(userData.isActive);
          }
        }

        // Validar membership
        let membership = MEMBERSHIP_STATUS.FREE;
        if (userData.membership) {
          const membershipUpper = userData.membership.toUpperCase();
          if (Object.values(MEMBERSHIP_STATUS).includes(membershipUpper as MEMBERSHIP_STATUS)) {
            membership = membershipUpper as MEMBERSHIP_STATUS;
          } else {
            result.errors.push({
              row: rowNumber,
              email: userData.email,
              error: `Valor inválido para membership: ${
                userData.membership
              }. Valores válidos: ${Object.values(MEMBERSHIP_STATUS).join(', ')}`,
            });
            result.errorCount++;
            continue;
          }
        }

        // Debug logging
        this.logger.log(
          `Processing user ${userData.email}: isActive=${
            userData.isActive
          } (type: ${typeof userData.isActive}) -> converted: ${isActive}, membership=${
            userData.membership
          } -> converted: ${membership}`,
        );

        // Log the final data being sent to Prisma
        this.logger.log(`Final data for ${userData.email}:`, {
          isActive: isActive,
          membership: membership,
          isActiveType: typeof isActive,
          membershipType: typeof membership,
        });

        // Criar usuário
        const newUser = await this.prisma.user.create({
          data: {
            provider: 'local',
            email: userData.email,
            roleId: userRole.id,
            password: await bcrypt.hash(userData.password, 10),
            fullName: userData.fullName,
            gender: userData.gender,
            phone: userData.phone,
            idDocNumber: userData.idDocNumber,
            birthdate: new Date(userData.birthdate),
            company: userData.company ? userData.company.toUpperCase() : undefined,
            jobTitle: userData.jobTitle ? userData.jobTitle.toUpperCase() : undefined,
            department: userData.department ? userData.department.toUpperCase() : undefined,
            professionalSegment: userData.professionalSegment,
            knowledgeApp: userData.knowledgeApp,
            readTerms: userData.readTerms,
            membership: MEMBERSHIP_STATUS.FREE,
            isActive: isActive,
            address: {
              create: {
                zipcode: userData.address.zipcode,
                street: userData.address.street,
                city: userData.address.city,
                neighborhood: userData.address.neighborhood,
                state: userData.address.state,
                country: userData.address.country,
              },
            },
            userSystemConfig: {
              create: {
                ...this._defaultSystemConfig,
                language: userData.userSystemConfig.language,
              },
            },
            emailNotification: {
              create: this._defaultEmailNotification,
            },
          },
          include: {
            role: true,
            address: true,
            userSystemConfig: true,
            emailNotification: true,
          },
        });

        // Enviar email de boas-vindas (opcional)
        try {
          const context = {
            FullName: newUser.fullName,
            AppName: 'Relable',
            LoginURL: 'https://app.relable.com/login',
            SupportEmail: 'suporte@relable.com.br',
            Year: new Date().getFullYear(),
          };

          await this.emailService.sendTemplateEmail(
            newUser.id,
            'welcome_email',
            context,
            'Bem-vindo ao Relable',
            'welcome-email',
            newUser.email,
          );
        } catch (error) {
          this.logger.warn(`Failed to send welcome email to ${newUser.email}`, error);
        }

        // Vincular ao plano gratuito se não especificado
        if (!userData.membership || userData.membership === MEMBERSHIP_STATUS.FREE) {
          let freePlan = await this.prisma.plan.findFirst({ where: { name: 'Free' } });

          if (!freePlan) {
            freePlan = await this.prisma.plan.create({
              data: {
                name: 'Free',
                description: 'Plano gratuito',
                price: new Prisma.Decimal(0),
                billingCycle: 'MONTHLY',
                features: 'Funcionalidades básicas',
              },
            });
          }

          await this.prisma.subscription.create({
            data: {
              userId: newUser.id,
              planId: freePlan.id,
              startSubDate: new Date(),
              status: 'active',
            },
          });
        } else if (membership === MEMBERSHIP_STATUS.PAID) {
          // Para usuários PAID, buscar um plano pago ou criar um padrão
          let paidPlan = await this.prisma.plan.findFirst({
            where: {
              name: { not: 'Free' },
              price: { gt: new Prisma.Decimal(0) },
            },
          });

          if (!paidPlan) {
            paidPlan = await this.prisma.plan.create({
              data: {
                name: 'Premium',
                description: 'Plano premium',
                price: new Prisma.Decimal(29.9),
                billingCycle: 'MONTHLY',
                features: 'Funcionalidades premium',
              },
            });
          }

          await this.prisma.subscription.create({
            data: {
              userId: newUser.id,
              planId: paidPlan.id,
              startSubDate: new Date(),
              status: 'active',
            },
          });
        }

        result.success.push({
          email: newUser.email,
          fullName: newUser.fullName,
        });
        result.successCount++;

        this.logger.log(`Successfully imported user: ${newUser.email}`);
      } catch (error) {
        this.logger.error(`Error importing user at row ${rowNumber}:`, error);
        result.errors.push({
          row: rowNumber,
          email: userData.email || 'N/A',
          error: error.message || 'Erro desconhecido',
        });
        result.errorCount++;
      }
    }

    this.logger.log(
      `Import completed. Success: ${result.successCount}, Errors: ${result.errorCount}`,
    );
    return result;
  }

  /**
   * Verifica se o usuário está no trial e atualiza para viewer mode se necessário
   */
  async checkAndUpdateTrialStatus(userId: number): Promise<{
    isInTrial: boolean;
    isInViewerMode: boolean;
    trialDaysLeft: number;
    viewerModeDaysLeft: number;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        trialStartDate: true,
        trialEndDate: true,
        isInViewerMode: true,
        viewerModeStartDate: true,
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    const now = new Date();
    const trialEndDate = user.trialEndDate;
    const isInTrial = trialEndDate && now < trialEndDate;

    let trialDaysLeft = 0;
    if (trialEndDate && now < trialEndDate) {
      trialDaysLeft = Math.ceil((trialEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    }

    // Se o trial acabou e o usuário não está em viewer mode, ativar viewer mode
    if (!isInTrial && !user.isInViewerMode && trialEndDate && now > trialEndDate) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          isInViewerMode: true,
          viewerModeStartDate: now,
        },
      });

      // Enviar email notificando sobre o fim do trial
      const userData = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, fullName: true },
      });

      if (userData) {
        const context = {
          FullName: userData.fullName,
          AppName: 'Relable',
          UpgradeURL: 'https://app.relable.com/plans',
          SupportEmail: 'suporte@relable.com.br',
          Year: new Date().getFullYear(),
        };

        try {
          await this.emailService.sendTemplateEmail(
            userId,
            'trial_ended',
            context,
            'Seu trial acabou - Ative o modo viewer',
            'trial-ended',
            userData.email,
          );
        } catch (error) {
          this.logger.error(`Failed to send trial ended email to ${userData.email}`, error);
        }
      }

      return {
        isInTrial: false,
        isInViewerMode: true,
        trialDaysLeft: 0,
        viewerModeDaysLeft: 180, // 6 meses
      };
    }

    // Calcular dias restantes do viewer mode
    let viewerModeDaysLeft = 0;
    if (user.isInViewerMode && user.viewerModeStartDate) {
      const viewerModeEndDate = new Date(
        user.viewerModeStartDate.getTime() + 180 * 24 * 60 * 60 * 1000,
      ); // 6 meses
      if (now < viewerModeEndDate) {
        viewerModeDaysLeft = Math.ceil(
          (viewerModeEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );
      }
    }

    return {
      isInTrial,
      isInViewerMode: user.isInViewerMode,
      trialDaysLeft,
      viewerModeDaysLeft,
    };
  }
}
