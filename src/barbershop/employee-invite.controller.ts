import { Controller, Post, Get, Body, Param, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  EmployeeInviteService,
  CreateEmployeeInviteInput,
  AcceptEmployeeInviteInput,
} from './employee-invite.service';

@Controller('employee-invites')
export class EmployeeInviteController {
  constructor(private readonly employeeInviteService: EmployeeInviteService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async createInvite(@Request() req: any, @Body() body: CreateEmployeeInviteInput) {
    return this.employeeInviteService.createInvite(req.user.id, body);
  }

  @Get('validate/:inviteToken')
  async validateInvite(@Param('inviteToken') inviteToken: string) {
    return this.employeeInviteService.validateInvite(inviteToken);
  }

  /** Aceita com a conta já existente (logado): entra em mais uma unidade */
  @Post('accept/:inviteToken/existing')
  @UseGuards(JwtAuthGuard)
  async acceptInviteAsUser(@Request() req: any, @Param('inviteToken') inviteToken: string) {
    return this.employeeInviteService.acceptInviteAsUser(inviteToken, req.user.id);
  }

  @Post('accept/:inviteToken')
  async acceptInvite(
    @Param('inviteToken') inviteToken: string,
    @Body() body: AcceptEmployeeInviteInput,
  ) {
    return this.employeeInviteService.acceptInvite(inviteToken, body);
  }
}
