import { Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ClientAuthService } from './client-auth.service';
import { ClientGoogleAuthGuard } from './guards/client-google-auth.guard';
import { ClientFacebookAuthGuard } from './guards/client-facebook-auth.guard';
import { ClientAppleAuthGuard } from './guards/client-apple-auth.guard';
import { ClientTokenPayload } from './interfaces/client-token-payload.interface';

// Rotas REST puras porque OAuth precisa de um redirect de página inteira —
// não dá para fazer esse fluxo via mutation GraphQL. O resto da API de
// cliente (signup por senha, histórico, favoritos) continua em GraphQL.
@Controller('client-auth')
export class ClientAuthController {
  constructor(
    private readonly clientAuthService: ClientAuthService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  @Get('google')
  @UseGuards(ClientGoogleAuthGuard)
  async googleAuth() {}

  @Get('google/redirect')
  @UseGuards(ClientGoogleAuthGuard)
  async googleAuthRedirect(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.completeSocialLogin((req as any).user, 'google', req, res);
  }

  @Get('facebook')
  @UseGuards(ClientFacebookAuthGuard)
  async facebookAuth() {}

  @Get('facebook/redirect')
  @UseGuards(ClientFacebookAuthGuard)
  async facebookAuthRedirect(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.completeSocialLogin((req as any).user, 'facebook', req, res);
  }

  @Get('apple')
  @UseGuards(ClientAppleAuthGuard)
  async appleAuth() {}

  @Post('apple/redirect')
  @UseGuards(ClientAppleAuthGuard)
  async appleAuthRedirect(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.completeSocialLogin((req as any).user, 'apple', req, res);
  }

  private getCurrentSessionClientId(req: Request): number | null {
    const token = req.cookies?.ClientAuthentication;
    if (!token) return null;
    try {
      const decoded = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      }) as ClientTokenPayload;
      return decoded.clientAccountId;
    } catch {
      return null;
    }
  }

  private async completeSocialLogin(
    user: { email: string; displayName: string },
    provider: string,
    req: Request,
    res: Response,
  ) {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
    const currentClientId = this.getCurrentSessionClientId(req);

    if (currentClientId) {
      const result = await this.clientAuthService.linkSocialAccountToClient(currentClientId, user.email, provider);
      let redirectUrl = `${frontendUrl}/client/account?linked=${provider}`;
      if (!result.ok) {
        redirectUrl = `${frontendUrl}/client/account?linkError=${result.reason}`;
      }
      res.redirect(redirectUrl);
      return;
    }

    const account = await this.clientAuthService.findOrCreateSocialAccount(user.email, user.displayName, provider);
    this.clientAuthService.issueCookie(account, res);
    res.redirect(`${frontendUrl}/client/account`);
  }
}
