// src\auth\auth.controller.ts
import { Controller, Post, Res, UseGuards, Get, Req, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiCookieAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { FacebookAuthGuard } from './guards/facebook-auth.guard';
import { AppleAuthGuard } from './guards/apple-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { Response, Request } from 'express';
import { UserDTO } from './users/dto/user.dto';
import { UserService } from './users/users.service';
import { Verify2faDto } from './users/dto/verify-2fa.dto';
import { randomUUID } from 'crypto';
import { ThrottleLogin, ThrottleAuth } from '@/common/decorators/throttle.decorator';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

@ApiTags('auth')
@ApiCookieAuth()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  @UseGuards(LocalAuthGuard)
  @ThrottleLogin()
  @ApiOperation({ summary: 'User login' })
  @ApiResponse({ status: 200, description: 'Logged in user' })
  @Post('login')
  async login(
    @CurrentUser() user: UserDTO,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    console.log('Login attempt for user:', user.email, 'twoFactorEnabled:', user.twoFactorEnabled);

    if (user.twoFactorEnabled) {
      console.log('User has 2FA enabled, sending verification code');
      const loginId = randomUUID();
      await this.userService.sendLoginCode(user, loginId);
      console.log('Sending response with twoFactor: true and loginId:', loginId);
      res.send({ success: true, twoFactor: true, loginId });
      return;
    }

    console.log('User does not have 2FA enabled, proceeding with normal login');
    await this.authService.login(user, req, res);

    console.log('Login successful, sending response with user data');
    console.log('User data being sent:', {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      plan: user.plan,
      subscriptionStatus: user.subscriptionStatus,
      userSystemConfig: user.userSystemConfig,
    });
    console.log('Full user object:', JSON.stringify(user, null, 2));

    res.send({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        plan: user.plan,
        subscriptionStatus: user.subscriptionStatus,
        userSystemConfig: user.userSystemConfig,
      },
    });
  }

  @Post('login/verify')
  @ThrottleAuth()
  @ApiOperation({ summary: 'Verify 2FA login code' })
  @ApiResponse({ status: 200, description: 'User logged in' })
  async verifyLogin(
    @Body() verifyDto: Verify2faDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.userService.verifyLoginCode(verifyDto.loginId, verifyDto.code);
    await this.authService.login(user, req, res);
    res.send(user);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Logout current user' })
  @ApiResponse({ status: 200, description: 'Successfully logged out' })
  @Post('logout')
  async logout(
    @CurrentUser() user: UserDTO,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logout(user, req, res);
    res.send({ success: true });
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Log out all other sessions' })
  @ApiResponse({ status: 200, description: 'Other sessions logged out' })
  @Post('logout/others')
  async logoutOtherSessions(@CurrentUser() user: UserDTO, @Req() req: Request) {
    await this.authService.logoutOtherSessions(user, req);
    return { success: true };
  }

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Google OAuth redirect' })
  async googleAuth() {
    // Guard handles redirect
  }

  @Get('google/redirect')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Google OAuth callback' })
  async googleAuthRedirect(
    @CurrentUser() user: any,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.completeSocialLogin(user, 'google', req, res);
  }

  @Get('facebook')
  @UseGuards(FacebookAuthGuard)
  @ApiOperation({ summary: 'Facebook OAuth redirect' })
  async facebookAuth() {
    // Guard handles redirect
  }

  @Get('facebook/redirect')
  @UseGuards(FacebookAuthGuard)
  @ApiOperation({ summary: 'Facebook OAuth callback' })
  async facebookAuthRedirect(
    @CurrentUser() user: any,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.completeSocialLogin(user, 'facebook', req, res);
  }

  @Get('apple')
  @UseGuards(AppleAuthGuard)
  @ApiOperation({ summary: 'Apple Sign In redirect' })
  async appleAuth() {
    // Guard handles redirect
  }

  // A Apple chama de volta via POST (response_mode=form_post) — é assim que
  // ela consegue devolver o nome do usuário no primeiro login, junto com o
  // id_token, ao invés de só como query string num GET.
  @Post('apple/redirect')
  @UseGuards(AppleAuthGuard)
  @ApiOperation({ summary: 'Apple Sign In callback' })
  async appleAuthRedirect(
    @CurrentUser() user: any,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.completeSocialLogin(user, 'apple', req, res);
  }

  // Se o navegador já tem um cookie de sessão válido quando o OAuth volta,
  // trata como "conectar mais um método de login" à conta já logada, em vez
  // de logar/criar outra conta — é o que permite um usuário entrar tanto por
  // senha quanto por Google/Facebook/Apple na mesma conta.
  private getCurrentSessionUserId(req: Request): number | null {
    const token = req.cookies?.Authentication;
    if (!token) return null;
    try {
      const decoded = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      }) as { userId: number };
      return decoded.userId;
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
    const currentUserId = this.getCurrentSessionUserId(req);

    if (currentUserId) {
      const result = await this.userService.linkSocialAccountToUser(currentUserId, user.email, provider);
      let redirectUrl = `${frontendUrl}/profile?linked=${provider}`;
      if (!result.ok) {
        redirectUrl = `${frontendUrl}/profile?linkError=${result.reason}`;
      }
      res.redirect(redirectUrl);
      return;
    }

    const dbUser = await this.userService.findOrCreateSocialUser(
      user.email,
      user.displayName,
      provider,
    );
    await this.authService.login(dbUser, req, res);

    // Verificar se o usuário precisa completar o cadastro
    // Se o usuário tem dados básicos preenchidos, vai para a página principal
    // Caso contrário, vai para social-signup para completar o cadastro
    const needsCompleteSignup = !dbUser.phone || !dbUser.company || !dbUser.professionalSegment;

    const redirectPath = needsCompleteSignup ? '/social-signup' : '/';
    const fullRedirectUrl = `${frontendUrl}${redirectPath}`;

    console.log(
      `${provider} OAuth redirect: ${fullRedirectUrl} (needsCompleteSignup: ${needsCompleteSignup})`,
    );
    res.redirect(fullRedirectUrl);
  }
}
