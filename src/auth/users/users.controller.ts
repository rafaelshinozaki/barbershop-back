// src\auth\users\users.controller.ts
import {
  Body,
  Controller,
  Get,
  Put,
  Post,
  UseGuards,
  Param,
  Logger,
  ParseIntPipe,
  NotFoundException,
  Query,
  Patch,
  Delete,
} from '@nestjs/common';
import { UserService } from './users.service';
import { UserDTO } from './dto/user.dto';
import { UserSystemConfigDTO } from './dto/userSystemConfig.dto';
import { ApiTags, ApiCookieAuth, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';

import { PublicRoute, MEMBERSHIP_STATUS } from '@/common';
import { NewUserSchema } from './models/new-user.schema';
import { LocalAuthGuard } from '../guards/local-auth.guard';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CurrentUser } from '../current-user.decorator';
import { Roles } from '../roles.decorator';
import { Role } from '../interfaces/roles';
import { RolesGuard } from '../guards/roles.guard';
import { ThrottleAuth } from '@/common/decorators/throttle.decorator';

@ApiTags('user')
@ApiCookieAuth()
@Controller('user')
export class UserController {
  constructor(private userService: UserService) {}
  private readonly logger = new Logger(UserService.name);

  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Retrieve current authenticated user' })
  @ApiResponse({ status: 200, description: 'Current user data' })
  @Get('me')
  async getMe(@CurrentUser() user: UserDTO) {
    this.logger.log(`getMe called for user ID: ${user.id}`);
    this.logger.log(`Current user data: ${JSON.stringify(user, null, 2)}`);

    const result = await this.userService.getUserById(user.id);
    this.logger.log(`getMe result: ${JSON.stringify(result, null, 2)}`);

    return result;
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List login history of current user' })
  @ApiResponse({ status: 200, description: 'Login history list' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page (default: 10)' })
  @Get('login-history')
  getLoginHistory(
    @CurrentUser() user: UserDTO,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
  ) {
    const pageNumber = parseInt(page as any, 10) || 1;
    const limitNumber = parseInt(limit as any, 10) || 10;
    return this.userService.getLoginHistory(user.id, pageNumber, limitNumber);
  }

  // GET /user/active-sessions e GET /user/sessions existiam aqui como
  // réplicas REST da query GraphQL activeSessions (a única realmente usada
  // pelo frontend, ver ActiveSessions.tsx) — ambas confirmadas sem nenhum
  // chamador no frontend via grep. A de active-sessions também identificava
  // "sessão atual" pelo IP, o mesmo bug corrigido no resolver GraphQL; a de
  // sessions chamava um getAllSessions() removido (dedup por timestamp
  // exato entre duas linhas criadas em inserts separados — nunca batia).

  @UseGuards(JwtAuthGuard)
  @Post('me/photo-url')
  getPhotoUploadUrl(
    @CurrentUser() user: UserDTO,
    @Body() body?: { fileExtension?: string; contentType?: string },
  ) {
    return this.userService
      .generatePhotoUploadUrl(user.id, body?.fileExtension, body?.contentType)
      .then((uploadUrl) => ({ uploadUrl }));
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/photo')
  getPhotoUrl(@CurrentUser() user: UserDTO) {
    return this.userService.getPhotoDownloadUrl(user.id).then((downloadUrl) => ({ downloadUrl }));
  }

  // Buscar usuário por ID (admin/manager) foi migrado para a query GraphQL
  // `user(id)` — operação interna do app, sem consumidor externo do REST.

  @PublicRoute()
  @ThrottleAuth()
  @ApiOperation({ summary: 'Create a new user' })
  @ApiResponse({ status: 201, description: 'User created' })
  @Post('create')
  async createUser(@Body() userData: NewUserSchema) {
    console.log('📥 Dados recebidos no createUser:', JSON.stringify(userData, null, 2));
    console.log('📱 Telefone recebido:', userData.phone);
    console.log('🆔 CPF recebido:', userData.idDocNumber);

    const user = await this.userService.createUser(userData);
    return { success: true, data: user };
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update user' })
  @ApiResponse({ status: 200, description: 'User updated' })
  @Put('update')
  updateUser(@Body() userDto: UserDTO) {
    return this.userService.updateUser(userDto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  @ApiOperation({ summary: 'Remove user' })
  @ApiResponse({ status: 200, description: 'User removed' })
  @Post('remove')
  removeUser(@Body('userId') userId: number) {
    return this.userService.removeUser(userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @ApiOperation({ summary: 'List users with filters' })
  @ApiResponse({ status: 200, description: 'List of users' })
  @ApiQuery({ name: 'plan', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'subscriptionStatus', required: false })
  @ApiQuery({ name: 'role', required: false })
  @ApiQuery({ name: 'name', required: false })
  @ApiQuery({ name: 'email', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @Get('admin/list')
  listUsers(
    @Query('plan') plan?: string,
    @Query('status') status?: string,
    @Query('subscriptionStatus') subscriptionStatus?: string,
    @Query('role') role?: string,
    @Query('name') name?: string,
    @Query('email') email?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
  ) {
    const pageNumber = parseInt(page as any, 10) || 1;
    const limitNumber = parseInt(limit as any, 10) || 10;
    return this.userService.listUsersByFilter(
      plan,
      status,
      subscriptionStatus,
      role,
      name,
      email,
      pageNumber,
      limitNumber,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @ApiOperation({ summary: 'Activate or deactivate user' })
  @ApiResponse({ status: 200, description: 'User status updated' })
  @Post('admin/set-active')
  setActive(@Body('userId') userId: number, @Body('active') active: boolean) {
    return this.userService.setUserActive(userId, active);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @ApiOperation({ summary: 'Activate or deactivate multiple users' })
  @ApiResponse({ status: 200, description: 'Users status updated' })
  @Post('admin/set-multiple-active')
  setMultipleActive(@Body('userIds') userIds: number[], @Body('active') active: boolean) {
    return this.userService.setMultipleUsersActive(userIds, active);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @ApiOperation({ summary: 'Change multiple users plan' })
  @ApiResponse({ status: 200, description: 'Users plan changed' })
  @Post('admin/change-multiple-plans')
  changeMultiplePlans(@Body('userIds') userIds: number[], @Body('plan') plan: string) {
    return this.userService.changeMultipleUsersPlan(userIds, plan);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @ApiOperation({ summary: 'Update payment status' })
  @ApiResponse({ status: 200, description: 'Payment status updated' })
  @Post('admin/update-payment-status')
  updatePaymentStatus(@Body('userId') userId: number, @Body('status') status: MEMBERSHIP_STATUS) {
    return this.userService.updatePaymentStatus(userId, status);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @ApiOperation({ summary: 'Change user plan' })
  @ApiResponse({ status: 200, description: 'User plan changed' })
  @Post('admin/change-plan')
  changePlan(@Body('userId') userId: number, @Body('plan') plan: string) {
    return this.userService.changeUserPlan(userId, plan);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update user system config' })
  @ApiResponse({ status: 200, description: 'User system config updated' })
  @Put('system-config/:id')
  async updateUserSystemConfig(
    @Param('id') id: number,
    @Body() updateConfigDto: UserSystemConfigDTO,
  ): Promise<{ success: boolean; message: string }> {
    const result = await this.userService.updateUserSystemConfig(id, updateConfigDto);
    return {
      success: result,
      message: result
        ? 'User system config updated successfully'
        : 'Failed to update user system config',
    };
  }

  // check-password, change-password-request, verify-change-password,
  // change-password, two-factor, two-factor-request e two-factor-verify
  // existiam aqui como réplicas REST das mutations GraphQL equivalentes
  // (checkPassword, requestChangePasswordCode, verifyChangePasswordCode,
  // changePassword/resetPasswordWithCode, setTwoFactor, requestTwoFactorCode).
  // Confirmado via grep que o frontend não chama nenhuma delas (os helpers em
  // services/nestjs/user/index.ts que apontavam pra cá também eram código
  // morto, com URLs que nem batiam com as rotas reais aqui). Removidas —
  // mesmo padrão de sobra de migração REST→GraphQL já visto no forgot-password.

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @ApiOperation({ summary: 'Import users from CSV' })
  @ApiResponse({ status: 200, description: 'Users imported' })
  @Post('admin/import-csv')
  async importUsersFromCsv(@Body() usersData: any[]) {
    const result = await this.userService.importUsersFromCsv(usersData);
    return { success: true, data: result };
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Terminate session' })
  @ApiResponse({ status: 200, description: 'Session terminated' })
  @Post('terminate-session/:sessionId')
  async terminateSession(
    @CurrentUser() user: UserDTO,
    @Param('sessionId', ParseIntPipe) sessionId: number,
  ) {
    await this.userService.terminateSession(user.id, sessionId, user.sessionToken);
    return { success: true };
  }
}
