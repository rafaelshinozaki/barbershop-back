import { Controller, Post, Get, Body, Param, UseGuards, Request } from '@nestjs/common';
import { FriendInviteService } from './friend-invite.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ThrottleEmail, ThrottleLogin } from '../common/decorators/throttle.decorator';

@Controller('friend-invites')
@UseGuards(JwtAuthGuard)
export class FriendInviteController {
  constructor(private readonly friendInviteService: FriendInviteService) {}

  @Post()
  async createInvite(@Request() req, @Body() body: { friendEmail: string; sentVia?: string }) {
    return this.friendInviteService.createInvite(req.user.id, body.friendEmail, body.sentVia);
  }

  @Get()
  async getSentInvites(@Request() req) {
    return this.friendInviteService.getSentInvites(req.user.id);
  }

  @Get('eligibility')
  async eligibility(@Request() req) {
    return this.friendInviteService.eligibility(req.user.id);
  }

  @Post('email-confirmation')
  @ThrottleEmail()
  async sendEmailConfirmation(@Request() req) {
    return this.friendInviteService.sendEmailConfirmationCode(req.user.id);
  }

  @Post('email-confirmation/verify')
  @ThrottleLogin()
  async confirmEmail(@Request() req, @Body() body: { code: string }) {
    return this.friendInviteService.confirmEmailCode(req.user.id, body?.code);
  }

  @Get('stats')
  async getInviteStats(@Request() req) {
    return this.friendInviteService.getInviteStats(req.user.id);
  }

  @Post('accept/:inviteToken')
  async acceptInvite(@Request() req, @Param('inviteToken') inviteToken: string) {
    return this.friendInviteService.acceptInvite(inviteToken, req.user.id);
  }

  @Get('validate/:inviteToken')
  async validateInvite(@Param('inviteToken') inviteToken: string) {
    return this.friendInviteService.validateInvite(inviteToken);
  }
}
