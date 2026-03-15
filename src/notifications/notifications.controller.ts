import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '../auth/interfaces/roles';
import { CurrentUser } from '../auth/current-user.decorator';
import { TokenPayload } from '../auth/interfaces/token-payload.interface';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { CreateBatchNotificationsDto } from './dto/create-batch-notifications.dto';
import { CreateAllNotificationsDto } from './dto/create-all-notifications.dto';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('test')
  async testEndpoint() {
    return { message: 'Notifications service is working!' };
  }

  @Get()
  async getUserNotifications(@CurrentUser() user: TokenPayload, @Query('limit') limit?: string) {
    const limitNumber = limit ? parseInt(limit, 10) : 50;
    return this.notificationsService.getUserNotifications(user.userId, limitNumber);
  }

  @Get('unread')
  async getUnreadNotifications(@CurrentUser() user: TokenPayload) {
    return this.notificationsService.getUnreadNotifications(user.userId);
  }

  @Get('new')
  async getNewNotifications(@CurrentUser() user: TokenPayload) {
    return this.notificationsService.getNewNotifications(user.userId);
  }

  @Get('count')
  async getNotificationCount(@CurrentUser() user: TokenPayload) {
    return this.notificationsService.getNotificationCount(user.userId);
  }

  @Put(':id/read')
  async markAsRead(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: TokenPayload) {
    return this.notificationsService.markAsRead(id, user.userId);
  }

  @Put('read-all')
  async markAllAsRead(@CurrentUser() user: TokenPayload) {
    return this.notificationsService.markAllAsRead(user.userId);
  }

  @Delete(':id')
  async deleteNotification(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: TokenPayload,
  ) {
    return this.notificationsService.deleteNotification(id, user.userId);
  }

  // Endpoints administrativos (apenas para admins)
  @Post('create')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  async createNotification(@Body() createNotificationDto: CreateNotificationDto) {
    return this.notificationsService.createNotification(createNotificationDto);
  }

  @Post('create-for-users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  async createNotificationsForUsers(
    @Body() createBatchNotificationsDto: CreateBatchNotificationsDto,
  ) {
    const { userIds, ...notificationData } = createBatchNotificationsDto;
    return this.notificationsService.createNotificationsForUsers(userIds, notificationData);
  }

  @Post('create-for-all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  async createNotificationForAllActiveUsers(
    @Body() createAllNotificationsDto: CreateAllNotificationsDto,
  ) {
    return this.notificationsService.createNotificationForAllActiveUsers(createAllNotificationsDto);
  }
}
