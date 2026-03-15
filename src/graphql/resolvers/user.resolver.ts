import {
  Resolver,
  Query,
  Mutation,
  Args,
  Int,
  Context,
  ResolveField,
  Parent,
} from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { UserService } from '../../auth/users/users.service';
import { User, UserSystemConfig, Address } from '../types/user.type';
import {
  LoginHistory,
  ActiveSession,
  PaginatedLoginHistory,
  PaginatedActiveSessions,
} from '../types/notification.type';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { GraphQLRolesGuard } from '../../auth/guards/graphql-roles.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { Role } from '../../auth/interfaces/roles';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { UpdateUserInput } from '../../auth/users/dto/update-user.dto';
import { ChangePasswordInput } from '../../auth/users/dto/change-password.dto';
import { UpdateUserSystemConfigInput } from '../../auth/users/dto/userSystemConfig.dto';
import { UpdateEmailNotificationInput } from '../dto/auth.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../../aws/s3.service';
import { SmartLogger } from '../../common/logger.util';

@Resolver(() => User)
export class UserResolver {
  private readonly logger = new SmartLogger('UserResolver');

  constructor(
    private readonly userService: UserService,
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
  ) {}

  @ResolveField(() => String, { nullable: true })
  async plan(@Parent() user: User): Promise<string | null> {
    const activeSubscription = await this.prisma.subscription.findFirst({
      where: {
        userId: user.id,
        status: 'ACTIVE',
      },
      include: {
        plan: true,
      },
      orderBy: {
        startSubDate: 'desc',
      },
    });

    return activeSubscription?.plan.name || 'FREE';
  }

  @ResolveField(() => String, { nullable: true })
  async subscriptionStatus(@Parent() user: User): Promise<string | null> {
    const activeSubscription = await this.prisma.subscription.findFirst({
      where: {
        userId: user.id,
        status: 'ACTIVE',
      },
      orderBy: {
        startSubDate: 'desc',
      },
    });

    return activeSubscription?.status || user.membership || 'FREE';
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => User)
  async me(@CurrentUser() user: UserDTO) {
    this.logger.log(`ME query called for user ${user.id} (${user.email})`);

    // Log adicional para debug do token
    this.logger.log('ME query - User from token:', {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role?.name,
    });

    const userData = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: {
        role: true,
        emailNotification: true,
        userSystemConfig: true,
        address: true,
      },
    });

    if (!userData) {
      this.logger.error(`User not found in database for ID ${user.id}`);
      throw new Error('User not found');
    }

    this.logger.logEssential('User data from DB', userData, ['id', 'email', 'fullName', 'role']);

    const defaultEmailNotification = {
      news: false,
      promotions: false,
      security: false,
      instability: false,
    };

    const result = {
      ...userData,
      emailNotification: userData.emailNotification || defaultEmailNotification,
      role: userData.role?.name || 'BarbershopOwner',
      membership: userData.membership || 'FREE',
      isActive: userData.isActive ?? true,
    };

    this.logger.logEssential('ME query result', result, ['id', 'email', 'fullName', 'role']);
    this.logger.log(`ME query completed for user ${user.id} (${user.email})`);

    // Log adicional para verificar consistência
    if (result.id !== user.id) {
      this.logger.error('ME query - CRITICAL: User ID mismatch!', {
        tokenUserId: user.id,
        tokenUserEmail: user.email,
        dbUserId: result.id,
        dbUserEmail: result.email,
      });
    }

    return result;
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => UserSystemConfig)
  async userSystemConfig(@CurrentUser() user: UserDTO) {
    const userData = await this.userService.getUserById(user.id);
    return userData.userSystemConfig;
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => User)
  async updateUserProfile(@CurrentUser() user: UserDTO, @Args('input') input: UpdateUserInput) {
    this.logger.log(`updateUserProfile called for user ${user.id}`);
    this.logger.logEssential('updateUserProfile input', input, ['fullName', 'email', 'phone']);
    const updateData: any = {};

    // Campos básicos do usuário
    if (input.fullName !== undefined) updateData.fullName = input.fullName;
    if (input.phone !== undefined) updateData.phone = input.phone;
    if (input.company !== undefined) updateData.company = input.company;
    if (input.position !== undefined) updateData.jobTitle = input.position;
    if (input.department !== undefined) updateData.department = input.department;
    if (input.gender !== undefined) updateData.gender = input.gender;
    if (input.birthdate !== undefined && input.birthdate.trim() !== '') {
      const birthdate = new Date(input.birthdate);
      if (!isNaN(birthdate.getTime())) {
        updateData.birthdate = birthdate;
      }
    }
    if (input.professionalSegment !== undefined)
      updateData.professionalSegment = input.professionalSegment;
    if (input.knowledgeApp !== undefined) updateData.knowledgeApp = input.knowledgeApp;
    if (input.twoFactorEnabled !== undefined) updateData.twoFactorEnabled = input.twoFactorEnabled;

    // Campos de endereço
    if (
      input.street !== undefined ||
      input.city !== undefined ||
      input.neighborhood !== undefined ||
      input.zipcode !== undefined ||
      input.state !== undefined ||
      input.country !== undefined ||
      input.complement1 !== undefined ||
      input.complement2 !== undefined
    ) {
      updateData.address = {
        upsert: {
          create: {},
          update: {},
        },
      };
      if (input.street !== undefined) {
        updateData.address.upsert.create.street = input.street;
        updateData.address.upsert.update.street = input.street;
      }
      if (input.city !== undefined) {
        updateData.address.upsert.create.city = input.city;
        updateData.address.upsert.update.city = input.city;
      }
      if (input.neighborhood !== undefined) {
        updateData.address.upsert.create.neighborhood = input.neighborhood;
        updateData.address.upsert.update.neighborhood = input.neighborhood;
      }
      if (input.zipcode !== undefined) {
        updateData.address.upsert.create.zipcode = input.zipcode;
        updateData.address.upsert.update.zipcode = input.zipcode;
      }
      if (input.state !== undefined) {
        updateData.address.upsert.create.state = input.state;
        updateData.address.upsert.update.state = input.state;
      }
      if (input.country !== undefined) {
        updateData.address.upsert.create.country = input.country;
        updateData.address.upsert.update.country = input.country;
      }
      if (input.complement1 !== undefined) {
        updateData.address.upsert.create.complement1 = input.complement1;
        updateData.address.upsert.update.complement1 = input.complement1;
      }
      if (input.complement2 !== undefined) {
        updateData.address.upsert.create.complement2 = input.complement2;
        updateData.address.upsert.update.complement2 = input.complement2;
      }
    }

    this.logger.logEssential('updateUserProfile updateData', updateData, [
      'fullName',
      'email',
      'phone',
    ]);

    try {
      const updatedUser = await this.prisma.user.update({
        where: { id: user.id },
        data: updateData,
        include: {
          role: true,
          emailNotification: true,
          userSystemConfig: true,
          address: true,
        },
      });

      this.logger.log(`updateUserProfile success for user ${user.id}`);

      return {
        ...updatedUser,
        role: updatedUser.role?.name || 'BarbershopOwner',
        membership: updatedUser.membership || 'FREE',
        isActive: updatedUser.isActive ?? true,
      };
    } catch (error) {
      this.logger.error(`updateUserProfile error for user ${user.id}`, error);
      throw error;
    }
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  async changePassword(@CurrentUser() user: UserDTO, @Args('input') input: ChangePasswordInput) {
    return this.userService.changePassword(
      user.id,
      input.email,
      input.oldPassword,
      input.newPassword,
      input.code,
    );
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  async updateUserSystemConfig(
    @CurrentUser() user: UserDTO,
    @Args('input') input: UpdateUserSystemConfigInput,
  ) {
    this.logger.log(`updateUserSystemConfig called for user ${user.id}`);
    this.logger.logEssential('updateUserSystemConfig input', input, ['theme', 'language']);
    const result = await this.userService.updateUserSystemConfig(user.id, input);
    this.logger.log(`updateUserSystemConfig result: ${result}`);
    return result;
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => User)
  async updateEmailNotification(
    @CurrentUser() user: UserDTO,
    @Args('input') input: UpdateEmailNotificationInput,
  ) {
    this.logger.log(`updateEmailNotification called for user ${user.id}`);
    this.logger.logEssential('updateEmailNotification input', input, [
      'news',
      'promotions',
      'security',
    ]);

    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailNotification: {
          upsert: {
            create: input,
            update: input,
          },
        },
      },
      include: {
        role: true,
        emailNotification: true,
        userSystemConfig: true,
        address: true,
      },
    });

    return {
      ...updatedUser,
      role: updatedUser.role?.name || 'BarbershopOwner',
      membership: updatedUser.membership || 'FREE',
      isActive: updatedUser.isActive ?? true,
    };
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => PaginatedLoginHistory)
  async loginHistory(
    @CurrentUser() user: UserDTO,
    @Args('page', { type: () => Int, defaultValue: 1 }) page: number,
    @Args('limit', { type: () => Int, defaultValue: 10 }) limit: number,
  ) {
    return this.userService.getLoginHistory(user.id, page, limit);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => PaginatedActiveSessions)
  async activeSessions(
    @CurrentUser() user: UserDTO,
    @Args('page', { type: () => Int, defaultValue: 1 }) page: number,
    @Args('limit', { type: () => Int, defaultValue: 10 }) limit: number,
    @Context() context: any,
  ) {
    return this.userService.getActiveSessions(user.id, page, limit, context.req);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => [ActiveSession])
  async sessions(@CurrentUser() user: UserDTO) {
    return this.userService.getAllSessions(user.id);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => User)
  async user(@Args('id', { type: () => Int }) id: number) {
    return this.userService.getUserById(id);
  }

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @Query(() => [User])
  async getAllUsers() {
    return this.userService.getAllUsers();
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => String, { nullable: true })
  async getUserPhotoDownloadUrl(@CurrentUser() user: UserDTO) {
    const userData = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { photoKey: true },
    });

    if (!userData?.photoKey) {
      return null;
    }

    return this.s3Service.getDownloadUrl(userData.photoKey);
  }

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @Query(() => [User])
  async getUsers() {
    return this.userService.getAllUsers();
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => String)
  async getPhotoUploadUrl(
    @CurrentUser() user: UserDTO,
    @Args('fileExtension', { nullable: true }) fileExtension?: string,
    @Args('contentType', { nullable: true }) contentType?: string,
  ) {
    const photoKey = `users/${user.id}/profile-photo.${fileExtension || 'jpg'}`;
    const uploadUrl = await this.s3Service.getUploadUrl(photoKey, contentType);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { photoKey },
    });

    return uploadUrl;
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => String, { nullable: true })
  async getPhotoUrl(@CurrentUser() user: UserDTO) {
    const userData = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { photoKey: true },
    });

    if (!userData?.photoKey) {
      return null;
    }

    return this.s3Service.getDownloadUrl(userData.photoKey);
  }

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  @Mutation(() => Boolean)
  async removeUser(@Args('userId', { type: () => Int }) userId: number) {
    return this.userService.removeUser(userId);
  }

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  @Mutation(() => Boolean)
  async setUserActive(
    @Args('userId', { type: () => Int }) userId: number,
    @Args('active') active: boolean,
  ) {
    return this.userService.setUserActive(userId, active);
  }

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  @Mutation(() => Boolean)
  async setMultipleUsersActive(
    @Args('userIds', { type: () => [Int] }) userIds: number[],
    @Args('active') active: boolean,
  ) {
    return this.userService.setMultipleUsersActive(userIds, active);
  }

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  @Mutation(() => Boolean)
  async changeMultipleUsersPlan(
    @Args('userIds', { type: () => [Int] }) userIds: number[],
    @Args('plan') plan: string,
  ) {
    return this.userService.changeMultipleUsersPlan(userIds, plan);
  }

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  @Mutation(() => Boolean)
  async changeUserPlan(
    @Args('userId', { type: () => Int }) userId: number,
    @Args('plan') plan: string,
  ) {
    return this.userService.changeUserPlan(userId, plan);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  async terminateSession(@CurrentUser() user: UserDTO, @Args('sessionId') sessionId: string) {
    return this.userService.terminateSession(user.id, parseInt(sessionId), '127.0.0.1');
  }
}
