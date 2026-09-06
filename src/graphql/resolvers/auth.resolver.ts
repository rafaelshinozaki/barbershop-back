import { Resolver, Mutation, Args, Context } from '@nestjs/graphql';
import { UseGuards, UseFilters } from '@nestjs/common';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../../auth/auth.service';
import { UserService } from '../../auth/users/users.service';
import { BarbershopService } from '../../barbershop/barbershop.service';
import { User } from '../types/user.type';
import { Role } from '../../auth/interfaces/roles';
import {
  LoginInput,
  Verify2FAInput,
  CreateUserInput,
  ForgotPasswordInput,
  ForgotPasswordCheckInput,
  ResetPasswordInput,
  TwoFactorInput,
  RequestChangePasswordCodeInput,
  VerifyChangePasswordCodeInput,
  ResetPasswordWithCodeInput,
  CheckPasswordInput,
  SocialSignupInput,
} from '../dto/auth.dto';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { NewUserSchema } from '../../auth/users/models/new-user.schema';
import { SmartLogger } from '../../common/logger.util';
import { randomUUID } from 'crypto';
import {
  ThrottleLogin,
  ThrottleAuth,
  ThrottlePasswordReset,
  ThrottleEmail,
} from '../../common/decorators/throttle.decorator';

function toGraphQLUser(user: any) {
  return {
    id: user.id,
    email: user.email,
    provider: user.provider,
    fullName: user.fullName,
    idDocNumber: user.idDocNumber,
    phone: user.phone,
    gender: user.gender,
    birthdate: user.birthdate,
    company: user.company,
    jobTitle: user.jobTitle,
    department: user.department,
    professionalSegment: user.professionalSegment,
    knowledgeApp: user.knowledgeApp,
    readTerms: user.readTerms,
    membership: user.membership,
    isActive: user.isActive,
    stripeCustomerId: user.stripeCustomerId,
    role: user.role && typeof user.role === 'object' ? user.role.name : user.role,
    twoFactorEnabled: user.twoFactorEnabled,
    photoKey: user.photoKey,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    deleted_at: user.deleted_at,
    emailNotification: user.emailNotification,
    userSystemConfig: user.userSystemConfig,
    address: user.address,
    twoFactorRequired: user.twoFactorRequired,
    loginId: user.loginId,
  };
}

const pendingSocialSignups = new Map<
  string,
  { email: string; fullName: string; provider: string }
>();

@Resolver(() => User)
@UseFilters(GqlHttpExceptionFilter)
export class AuthResolver {
  private readonly logger = new SmartLogger('AuthResolver');

  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly barbershopService: BarbershopService,
    private readonly prisma: PrismaService,
  ) {}

  @Mutation(() => User)
  @ThrottleLogin()
  async login(@Args('input') loginInput: LoginInput, @Context() context: any): Promise<any> {
    const { req, res } = context;
    this.logger.log('Login attempt for email', loginInput.email);

    const dbUser = await this.userService.verifyUser(loginInput.email, loginInput.password);

    this.logger.log('User verified, twoFactorEnabled', dbUser.twoFactorEnabled);

    if (dbUser.twoFactorEnabled) {
      this.logger.log('2FA enabled, sending login code');
      const loginId = randomUUID();
      await this.userService.sendLoginCode(dbUser, loginId);
      return { ...toGraphQLUser(dbUser), twoFactorRequired: true, loginId } as any;
    }

    this.logger.log('2FA disabled, logging in directly');
    await this.authService.login(dbUser, req, res);
    return toGraphQLUser(dbUser) as any;
  }

  @Mutation(() => User)
  @ThrottleAuth()
  async verify2FA(
    @Args('input') verifyInput: Verify2FAInput,
    @Context() context: any,
  ): Promise<any> {
    const { req, res } = context;
    const dbUser = await this.userService.verifyLoginCode(verifyInput.loginId, verifyInput.code);
    await this.authService.login(dbUser, req, res);
    return toGraphQLUser(dbUser) as any;
  }

  @Mutation(() => User)
  @ThrottleAuth()
  async createUser(@Args('input') createUserInput: CreateUserInput): Promise<any> {
    const isBarbershopOwner = createUserInput.signupType === 'barbershop_owner';

    const userData: Record<string, any> = {
      ...createUserInput,
      // Usa o endereço enviado pelo cliente quando presente — antes isso era
      // sempre sobrescrito por um objeto vazio, então o endereço pessoal
      // (rua, bairro, complemento etc.) do usuário nunca era gravado no
      // cadastro via GraphQL, mesmo quando o formulário coletava esses dados.
      address: createUserInput.address ?? {
        zipcode: '',
        street: '',
        city: '',
        neighborhood: '',
        state: '',
        country: '',
      },
      userSystemConfig: {
        theme: 'light',
        accentColor: 'bronze',
        grayColor: 'gray',
        radius: 'medium',
        scaling: '100%',
        language: 'pt',
      },
    };

    if (isBarbershopOwner && createUserInput.barbershopData) {
      const { barbershopData } = createUserInput;
      userData.company = barbershopData.name;
      userData.jobTitle = 'Proprietário';
      userData.department = 'Barbearia';
      userData.professionalSegment = 'barbershop';
      userData.roleName = Role.BARBERSHOP_OWNER;
    }

    const dbUser = await this.userService.createUser(userData as NewUserSchema);

    if (isBarbershopOwner && createUserInput.barbershopData) {
      try {
        await this.barbershopService.createBarbershop(dbUser.id, {
          name: createUserInput.barbershopData.name,
          slug: createUserInput.barbershopData.slug,
          address: createUserInput.barbershopData.address,
          complement1: createUserInput.barbershopData.complement1,
          complement2: createUserInput.barbershopData.complement2,
          city: createUserInput.barbershopData.city,
          state: createUserInput.barbershopData.state,
          country: createUserInput.barbershopData.country,
          postalCode: createUserInput.barbershopData.postalCode,
          phone: createUserInput.barbershopData.phone,
          email: createUserInput.barbershopData.email,
          timezone: createUserInput.barbershopData.timezone,
          businessHours: createUserInput.barbershopData.businessHours,
        });
      } catch (error) {
        // userService.createUser() e barbershopService.createBarbershop() não
        // rodam na mesma transação — se a barbearia falhar (ex.: slug
        // duplicado), o usuário já foi criado e ficaria órfão (sem barbearia,
        // sem poder se cadastrar de novo com o mesmo email). Desfaz o usuário
        // manualmente para manter o cadastro atômico do ponto de vista do cliente.
        //
        // User tem soft-delete global (ver PrismaService: delete vira update
        // com deleted_at) — mas @@unique([email, provider]) é uma constraint
        // real do Postgres que não sabe de deleted_at, então um soft-delete
        // aqui deixaria o email permanentemente preso e a pessoa nunca mais
        // conseguiria se cadastrar com ele. Por isso o delete final é via SQL
        // bruto, contornando o middleware, para realmente liberar o registro.
        await this.prisma.address.deleteMany({ where: { userId: dbUser.id } });
        await this.prisma.userSystemConfig.deleteMany({ where: { userId: dbUser.id } });
        await this.prisma.emailNotification.deleteMany({ where: { userId: dbUser.id } });
        await this.prisma.subscription.deleteMany({ where: { userId: dbUser.id } });
        await this.prisma.$executeRaw`DELETE FROM "User" WHERE id = ${dbUser.id}`;
        throw error;
      }
    }

    return toGraphQLUser(dbUser) as any;
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  async logout(@Context() context: any, @CurrentUser() user: UserDTO) {
    const { req, res } = context;
    await this.authService.logout(user, req, res);
    return true;
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  async logoutOtherSessions(@CurrentUser() user: UserDTO, @Context() context: any) {
    const { req } = context;
    await this.authService.logoutOtherSessions(user, req);
    return true;
  }

  @Mutation(() => Boolean)
  @ThrottlePasswordReset()
  async forgotPassword(@Args('input') forgotPasswordInput: ForgotPasswordInput) {
    await this.userService.forgotPass({ email: forgotPasswordInput.email });
    return true;
  }

  @Mutation(() => Boolean)
  @ThrottleAuth()
  async forgotPasswordCheck(@Args('input') forgotPasswordCheckInput: ForgotPasswordCheckInput) {
    const result = await this.userService.forgotPassCheck({
      email: forgotPasswordCheckInput.email,
      token: forgotPasswordCheckInput.token,
    });
    return result;
  }

  @Mutation(() => Boolean)
  @ThrottleAuth()
  async resetPassword(@Args('input') resetPasswordInput: ResetPasswordInput) {
    await this.userService.resetPasswordByToken(
      resetPasswordInput.email,
      resetPasswordInput.token,
      resetPasswordInput.newPassword,
    );
    return true;
  }

  // Havia uma segunda mutation `changePassword` aqui que enviava um código
  // real por e-mail e, na sequência, tentava consumi-lo com o literal fixo
  // '123456' em vez do código que o usuário digitou — nunca poderia
  // funcionar de verdade. Como `changePassword` também é definida em
  // UserResolver (essa sim recebendo o código real do cliente e sendo a
  // única registrada no schema — mesmo conflito silencioso já visto em `me`,
  // ver comentário abaixo), essa versão aqui nunca era servida. Removida.

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  @ThrottleEmail()
  async requestTwoFactorCode(@CurrentUser() user: UserDTO) {
    await this.userService.sendTwoFactorCode(user);
    return true;
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  @ThrottleAuth()
  async setTwoFactor(@Args('input') twoFactorInput: TwoFactorInput, @CurrentUser() user: UserDTO) {
    if (twoFactorInput.enabled) {
      // Ativar exige prova de posse do e-mail: código enviado por requestTwoFactorCode.
      if (!twoFactorInput.code) {
        throw new Error('Verification code is required to enable two-factor authentication');
      }
      await this.userService.verifyTwoFactorCode(user.email, twoFactorInput.code);
      return true;
    }

    // Desativar remove uma camada de segurança da conta — exige reautenticação com a senha atual.
    if (!twoFactorInput.currentPassword) {
      throw new Error('Current password is required to disable two-factor authentication');
    }
    const isValid = await this.userService.isPasswordValid(
      user.email,
      twoFactorInput.currentPassword,
    );
    if (!isValid) {
      throw new Error('Current password is incorrect');
    }
    await this.userService.setTwoFactor(user.id, false);
    return true;
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  @ThrottleEmail()
  async requestChangePasswordCode(
    @Args('input') input: RequestChangePasswordCodeInput,
    @CurrentUser() user: UserDTO,
  ) {
    await this.userService.sendChangePasswordCode(user.email);
    return true;
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  @ThrottleAuth()
  async verifyChangePasswordCode(
    @Args('input') input: VerifyChangePasswordCodeInput,
    @CurrentUser() user: UserDTO,
  ) {
    const result = await this.userService.verifyChangePasswordCode(user.id, input.code, true);
    return result;
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  @ThrottleAuth()
  async resetPasswordWithCode(
    @Args('input') input: ResetPasswordWithCodeInput,
    @CurrentUser() user: UserDTO,
  ) {
    await this.userService.changePassword(
      user.id,
      user.email,
      input.currentPassword,
      input.newPassword,
      input.code,
    );
    return true;
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  @ThrottleAuth()
  async checkPassword(@Args('input') input: CheckPasswordInput, @CurrentUser() user: UserDTO) {
    const isValid = await this.userService.isPasswordValid(user.email, input.password);
    return isValid;
  }

  // `me` vive em UserResolver — dois resolvers definindo a mesma query
  // root causava um conflito silencioso (UserResolver vencia; esta versão
  // nunca era chamada, confirmado ao vivo checando se userSystemConfig/
  // address/emailNotification vinham populados — só o refetch completo do
  // UserResolver faz isso, já que o user de @CurrentUser() aqui só inclui
  // `role`, ver GraphQLJwtAuthGuard).

  @Mutation(() => String)
  async startSocialSignup(
    @Args('provider') provider: string,
    @Args('email') email: string,
    @Args('fullName') fullName: string,
  ): Promise<string> {
    const token = randomUUID();
    pendingSocialSignups.set(token, { email, fullName, provider });
    return token;
  }

  @Mutation(() => User)
  async completeSocialSignup(
    @Args('input') input: SocialSignupInput,
    @Args('token') token: string,
    @Context() context: any,
  ): Promise<any> {
    const { req, res } = context;
    const pending = pendingSocialSignups.get(token);
    if (!pending || pending.email !== input.email || pending.provider !== input.provider) {
      throw new Error('Invalid or expired social signup token');
    }
    pendingSocialSignups.delete(token);
    const userData = {
      ...input,
      provider: input.provider,
      password: randomUUID(),
      address: {
        zipcode: '',
        street: '',
        city: '',
        neighborhood: '',
        state: '',
        country: '',
      },
      userSystemConfig: {
        theme: 'light',
        accentColor: 'bronze',
        grayColor: 'gray',
        radius: 'medium',
        scaling: '100%',
        language: 'en',
      },
    };
    const dbUser = await this.userService.createUser(userData);
    await this.authService.login(dbUser, req, res);
    return toGraphQLUser(dbUser) as any;
  }
}
