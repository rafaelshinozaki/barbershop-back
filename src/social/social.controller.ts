import { Controller, Get, Query, Req, Res, UseGuards, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiExcludeEndpoint } from '@nestjs/swagger';
import { randomBytes } from 'crypto';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@/auth/current-user.decorator';
import { UserDTO } from '@/auth/users/dto/user.dto';
import { SocialService } from './social.service';

// Endpoints REST (não GraphQL) porque OAuth precisa de navegação real do
// navegador — redirect pro diálogo da Meta e depois de volta pra cá — não
// dá pra fazer isso numa mutation. Mesmo padrão de /auth/facebook e
// /client-auth/facebook, só que pra permissões de Página/Instagram em vez
// de login de usuário.
const SOCIAL_STATE_COOKIE = 'SocialConnectState';
const SOCIAL_STATE_MS = 10 * 60 * 1000;

@ApiTags('social')
@Controller('social')
export class SocialController {
  private readonly logger = new Logger(SocialController.name);

  constructor(
    private readonly socialService: SocialService,
    private readonly configService: ConfigService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('connect')
  @ApiExcludeEndpoint()
  async connect(
    @Query('barbershopId') barbershopId: string,
    @CurrentUser() user: UserDTO,
    @Res() res: Response,
  ) {
    const nonce = randomBytes(24).toString('base64url');
    const url = await this.socialService.getConnectUrl(
      user.id,
      parseInt(barbershopId, 10),
      nonce,
    );
    const prod = process.env.NODE_ENV === 'production';
    res.cookie(SOCIAL_STATE_COOKIE, nonce, {
      httpOnly: true,
      secure: prod,
      sameSite: 'lax',
      path: '/social',
      maxAge: SOCIAL_STATE_MS,
    });
    return res.redirect(url);
  }

  @Get('callback')
  @ApiExcludeEndpoint()
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
    const nonce = req.cookies?.[SOCIAL_STATE_COOKIE] as string | undefined;
    res.clearCookie(SOCIAL_STATE_COOKIE, { path: '/social' });
    if (!code || !state) {
      return res.redirect(`${frontendUrl}/barbershops?socialError=1`);
    }
    let result: { barbershopId: number; error?: string; pick?: string };
    try {
      result = await this.socialService.handleOAuthCallback(code, state, nonce);
    } catch {
      return res.redirect(`${frontendUrl}/barbershops?socialError=1`);
    }
    const { barbershopId, error, pick } = result;
    const target = `${frontendUrl}/barbershops/${barbershopId}/social`;
    if (error) return res.redirect(`${target}?socialError=${encodeURIComponent(error)}`);
    if (pick) return res.redirect(`${target}?socialPick=${encodeURIComponent(pick)}`);
    return res.redirect(`${target}?socialConnected=1`);
  }
}
