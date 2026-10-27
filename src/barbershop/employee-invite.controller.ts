import { Controller, Post, Get, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
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

  /** Novo prazo e novo link do mesmo convite (também o que já venceu). */
  @Post('resend')
  @UseGuards(JwtAuthGuard)
  async resendInvite(
    @Request() req: any,
    @Body() body: { barbershopId: number; barberId: number },
  ) {
    return this.employeeInviteService.resendInvite(req.user.id, body.barbershopId, body.barberId);
  }

  @Get('validate/:inviteToken')
  async validateInvite(@Param('inviteToken') inviteToken: string, @Query('k') emailKey?: string) {
    return this.employeeInviteService.validateInvite(inviteToken, emailKey);
  }

  /** Quem abriu o link sem a chave do e-mail pede o e-mail de novo */
  @Post('resend-email/:inviteToken')
  async resendInviteEmail(@Param('inviteToken') inviteToken: string) {
    return this.employeeInviteService.resendInviteEmail(inviteToken);
  }

  /** Aceita com a conta já existente (logado): entra em mais uma unidade */
  @Post('accept/:inviteToken/existing')
  @UseGuards(JwtAuthGuard)
  async acceptInviteAsUser(
    @Request() req: any,
    @Param('inviteToken') inviteToken: string,
    // Chave do link do e-mail: exigida quando a conta ainda não confirmou o e-mail
    @Query('k') emailKey?: string,
  ) {
    return this.employeeInviteService.acceptInviteAsUser(inviteToken, req.user.id, emailKey);
  }

  @Post('accept/:inviteToken')
  async acceptInvite(
    @Param('inviteToken') inviteToken: string,
    @Body() body: AcceptEmployeeInviteInput,
  ) {
    return this.employeeInviteService.acceptInvite(inviteToken, body);
  }
}
