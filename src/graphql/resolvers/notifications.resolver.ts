import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  UserNotification,
  NotificationType,
  NotificationWithUser,
} from '../types/notification.type';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { GraphQLRolesGuard } from '../../auth/guards/graphql-roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { Role } from '../../auth/interfaces/roles';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { CreateNotificationDto } from '../../notifications/dto/create-notification.dto';
import { CommonResponse } from '../types/common-response.type';
import { NotificationCount } from '../types/notification-count.type';
import { SmartLogger } from '../../common/logger.util';

@Resolver(() => UserNotification)
export class NotificationsResolver {
  private readonly logger = new SmartLogger('NotificationsResolver');

  constructor(private readonly notificationsService: NotificationsService) {}

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.ADMIN)
  @Query(() => [NotificationWithUser])
  async allNotificationsWithUser(
    @Args('limit', { type: () => Int, defaultValue: 100 }) limit: number,
  ) {
    this.logger.log(`allNotificationsWithUser called, limit: ${limit}`);
    const result = await this.notificationsService.getAllNotificationsWithUser(limit);
    this.logger.log(`allNotificationsWithUser returning ${result.length} notifications`);
    return result;
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => [UserNotification])
  async myNotifications(
    @CurrentUser() user: UserDTO,
    @Args('limit', { type: () => Int, defaultValue: 10 }) limit: number,
  ) {
    this.logger.log(`myNotifications called for user ${user.id}, limit: ${limit}`);
    const result = await this.notificationsService.getUserNotifications(user.id, limit);
    this.logger.log(`myNotifications returning ${result.length} notifications for user ${user.id}`);
    return result;
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => [UserNotification])
  async myUnreadNotifications(@CurrentUser() user: UserDTO) {
    return this.notificationsService.getUnreadNotifications(user.id);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => [UserNotification])
  async myNewNotifications(@CurrentUser() user: UserDTO) {
    return this.notificationsService.getNewNotifications(user.id);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => NotificationCount)
  async myNotificationsCount(@CurrentUser() user: UserDTO) {
    this.logger.log(`myNotificationsCount called for user ${user.id}`);
    const result = await this.notificationsService.getNotificationCount(user.id);
    this.logger.log(`myNotificationsCount returning count for user ${user.id}`);
    return result;
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => CommonResponse)
  async markNotificationAsRead(
    @CurrentUser() user: UserDTO,
    @Args('id', { type: () => Int }) id: number,
  ) {
    return this.notificationsService.markAsRead(id, user.id);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => CommonResponse)
  async markAllNotificationsAsRead(@CurrentUser() user: UserDTO) {
    return this.notificationsService.markAllAsRead(user.id);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => CommonResponse)
  async deleteNotification(
    @CurrentUser() user: UserDTO,
    @Args('id', { type: () => Int }) id: number,
  ) {
    return this.notificationsService.deleteNotification(id, user.id);
  }

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  @Mutation(() => UserNotification)
  async createNotification(
    @CurrentUser() user: UserDTO,
    @Args('title') title: string,
    @Args('message') message: string,
    @Args('type', { defaultValue: 'info' }) type: string,
    @Args('userId', { type: () => Int, nullable: true }) userId?: number,
  ) {
    this.logger.log(`createNotification called by user ${user.id} for user ${userId || user.id}`);
    const createDto: CreateNotificationDto = {
      title,
      message,
      type: type as NotificationType,
      userId: userId || user.id,
    };
    const result = await this.notificationsService.createNotification(createDto);
    this.logger.log(`createNotification completed, created notification ${result.id}`);
    return result;
  }

  @UseGuards(GraphQLJwtAuthGuard, GraphQLRolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  @Mutation(() => CommonResponse)
  async createBatchNotifications(
    @CurrentUser() user: UserDTO,
    @Args('title') title: string,
    @Args('message') message: string,
    @Args('type', { defaultValue: 'info' }) type: string,
    @Args('userIds', { type: () => [Int] }) userIds: number[],
  ) {
    this.logger.log(
      `createBatchNotifications called by user ${user.id} for ${userIds.length} users`,
    );
    const createDto = {
      title,
      message,
      type: type as NotificationType,
    };
    const result = await this.notificationsService.createNotificationsForUsers(userIds, createDto);
    this.logger.log(`createBatchNotifications completed, created ${result.count} notifications`);
    return result;
  }
}
