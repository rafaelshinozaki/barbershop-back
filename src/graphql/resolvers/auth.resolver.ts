import { Resolver, Mutation, Args, Query, Context } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
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
  ChangePasswordInput,
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
export class AuthResolver {
  private readonly logger = new SmartLogger('AuthResolver');

  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly barbershopService: BarbershopService,
  ) {}

  @Mutation(() => User)
  @ThrottleLogin()
  async login(@Args('input') loginInput: LoginInput, @Context() context: any): Promise<any> {
    const { req, res } = context;
    this.logger.log('Login attempt for email', loginInput.email);

    const dbUser = await this.userService.verifyUser(
      loginInput.email,
      loginInput.password,
      loginInput.deviceType,
      loginInput.browser,
      loginInput.os,
      loginInput.ip,
      loginInput.location,
    );

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
      await this.barbershopService.createBarbershop(dbUser.id, {
        name: createUserInput.barbershopData.name,
        slug: createUserInput.barbershopData.slug,
        address: createUserInput.barbershopData.address,
        city: createUserInput.barbershopData.city,
        state: createUserInput.barbershopData.state,
        country: createUserInput.barbershopData.country,
        postalCode: createUserInput.barbershopData.postalCode,
        phone: createUserInput.barbershopData.phone,
        email: createUserInput.barbershopData.email,
        timezone: createUserInput.barbershopData.timezone,
        businessHours: createUserInput.barbershopData.businessHours,
      });
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

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  @ThrottleEmail()
  async changePassword(
    @Args('input') changePasswordInput: ChangePasswordInput,
    @CurrentUser() user: UserDTO,
  ) {
    const isValid = await this.userService.isPasswordValid(
      user.email,
      changePasswordInput.currentPassword,
    );
    if (!isValid) {
      throw new Error('Current password is incorrect');
    }

    await this.userService.sendChangePasswordCode(user.email);

    const verificationCode = '123456';

    await this.userService.changePassword(
      user.id,
      user.email,
      changePasswordInput.currentPassword,
      changePasswordInput.newPassword,
      verificationCode,
    );
    return true;
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  async setTwoFactor(@Args('input') twoFactorInput: TwoFactorInput, @CurrentUser() user: UserDTO) {
    await this.userService.setTwoFactor(user.id, twoFactorInput.enabled);
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
  async checkPassword(@Args('input') input: CheckPasswordInput, @CurrentUser() user: UserDTO) {
    const isValid = await this.userService.isPasswordValid(user.email, input.password);
    return isValid;
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => User)
  async me(@CurrentUser() user: UserDTO): Promise<any> {
    return toGraphQLUser(user) as any;
  }

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
