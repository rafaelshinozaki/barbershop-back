import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ClientAuthService } from './client-auth.service';
import { ClientGoogleAuthGuard } from './guards/client-google-auth.guard';
import { ClientFacebookAuthGuard } from './guards/client-facebook-auth.guard';
import { ClientAppleAuthGuard } from './guards/client-apple-auth.guard';
import { clientClaims } from '../auth/session-claims';
import { CLIENT_TERMS_COOKIE } from './oauth-state';

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
  async googleAuth() {
    // Vazio de propósito: o guard do Passport redireciona pro provedor antes
  }

  @Get('google/redirect')
  @UseGuards(ClientGoogleAuthGuard)
  async googleAuthRedirect(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.completeSocialLogin((req as any).user, 'google', req, res);
  }

  @Get('facebook')
  @UseGuards(ClientFacebookAuthGuard)
  async facebookAuth() {
    // Vazio de propósito: o guard do Passport redireciona pro provedor antes
  }

  @Get('facebook/redirect')
  @UseGuards(ClientFacebookAuthGuard)
  async facebookAuthRedirect(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.completeSocialLogin((req as any).user, 'facebook', req, res);
  }

  @Get('apple')
  @UseGuards(ClientAppleAuthGuard)
  async appleAuth() {
    // Vazio de propósito: o guard do Passport redireciona pro provedor antes
  }

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
      });
      return clientClaims(decoded)?.clientAccountId ?? null;
    } catch {
      return null;
    }
  }

  private async completeSocialLogin(
    user: { email: string; displayName: string; providerUserId?: string },
    provider: string,
    req: Request,
    res: Response,
  ) {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
    const currentClientId = this.getCurrentSessionClientId(req);

    if (currentClientId) {
      const result = await this.clientAuthService.linkSocialAccountToClient(
        currentClientId,
        user.email,
        provider,
        user.providerUserId,
      );
      let redirectUrl = `${frontendUrl}/client/account?linked=${provider}`;
      if (!result.ok) {
        redirectUrl = `${frontendUrl}/client/account?linkError=${result.reason}`;
      }
      res.redirect(redirectUrl);
      return;
    }

    let account;
    const acceptedTerms = req.cookies?.[CLIENT_TERMS_COOKIE] === '1';
    res.clearCookie(CLIENT_TERMS_COOKIE, { path: '/client-auth' });
    try {
      account = await this.clientAuthService.findOrCreateSocialAccount(
        user.email,
        user.displayName,
        provider,
        user.providerUserId,
        acceptedTerms,
      );
    } catch (err) {
      // Vínculo de outra pessoa neste provedor: volta pra tela de login (item 299)
      if (err instanceof UnauthorizedException) {
        res.redirect(`${frontendUrl}/client/login?error=social`);
        return;
      }
      if (err instanceof BadRequestException) {
        res.redirect(`${frontendUrl}/client/signup?error=terms`);
        return;
      }
      throw err;
    }
    if (account.suspendedAt) {
      res.redirect(`${frontendUrl}/client/login?suspended=1`);
      return;
    }
    await this.clientAuthService.issueCookie(account, res);
    res.redirect(`${frontendUrl}/client/account`);
  }
}
