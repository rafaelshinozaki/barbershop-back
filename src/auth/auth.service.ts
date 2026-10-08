// src\auth\auth.service.ts
import { clientIp } from '../common/client-ip';
import { setAuthCookie } from './session-cookie';
import { Injectable, Logger } from '@nestjs/common';
import { EmailService } from '@/email/email.service';
import { Request, Response } from 'express';

import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '@/prisma/prisma.service';
import { randomUUID } from 'crypto';
import { UserDTO } from './users/dto/user.dto';
import { IpLocationService } from '@/common/ip-location.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  // Cache para localização de IPs
  private locationCache = new Map<string, { data: string; timestamp: number }>();

  // Tempo de cache: 1 hora
  private readonly CACHE_DURATION = 60 * 60 * 1000;

  // Timeout para requisições: 3 segundos
  private readonly REQUEST_TIMEOUT = 3000;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly ipLocationService: IpLocationService,
  ) {
    // Iniciar limpeza de cache a cada hora
    this.scheduleCacheCleanup();
  }

  /**
   * Abre a sessão. rememberMe ("Lembrar de mim"): 30 dias e o cookie
   * sobrevive a fechar o navegador; sem ele, 12 horas e cookie de sessão.
   * (Antes o cookie durava 7 dias mas o token vencia em JWT_EXPIRATION —
   * 1 hora no .env de exemplo — e a caixa do login não fazia nada.)
   */
  async login(user: UserDTO, req: Request, res: Response, rememberMe = false) {
    const sessionToken = randomUUID();

    // Não o X-Forwarded-For direto: o cliente escolheria o IP do histórico
    const ip = clientIp(req);
    const { location, latitude, longitude } = await this.ipLocationService.lookup(ip ?? '');
    const existing = await (this.prisma as any).loginHistory?.findFirst({
      where: { userId: user.id, ip },
    });
    const { deviceType, browser, os } = this.parseUserAgent(req.headers['user-agent'] || '');

    await (this.prisma as any).loginHistory?.create({
      data: {
        userId: user.id,
        deviceType,
        browser,
        os,
        ip,
        location,
        latitude,
        longitude,
        sessionToken,
      },
    });

    await (this.prisma as any).activeSession?.create({
      data: {
        userId: user.id,
        sessionToken,
        deviceType,
        browser,
        os,
        ip,
        location,
        latitude,
        longitude,
      },
    });

    if (!existing) {
      const context = {
        FullName: user.fullName,
        AppName: 'Barbershop',
        IP: ip,
        Location: location,
        DeviceType: deviceType,
        Browser: browser,
        OS: os,
        SupportEmail: 'suporte@barbershop.com.br',
        Year: new Date().getFullYear(),
      };

      try {
        await this.emailService.sendTemplateEmail(
          user.id,
          'new_login_ip',
          context,
          {
            pt: 'Novo login detectado',
            en: 'New sign-in detected',
            es: 'Nuevo inicio de sesión detectado',
          },
          'new-login-ip',
          user.email,
        );
      } catch (error) {
        this.logger.warn(`Failed to send new login IP email: ${error.message}`);
        // Continue login process even if email fails
      }
    }

    setAuthCookie(
      this.jwtService,
      res,
      { userId: user.id, email: user.email, sessionToken, remember: rememberMe },
      this.configService.get<string>('NODE_ENV') === 'production',
    );
  }

  async logout(user: UserDTO, req: Request, res: Response) {
    // Encerra só a sessão do token atual — IP não identifica uma sessão
    // específica (várias podem compartilhar IP atrás de NAT/rede local).
    await (this.prisma as any).activeSession?.deleteMany({
      where: { userId: user.id, sessionToken: user.sessionToken },
    });

    // Limpar cookie com as mesmas configurações usadas na criação
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    res.clearCookie('Authentication', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
    });
  }

  async logoutOtherSessions(user: UserDTO, _req: Request) {
    // A sessão some da ActiveSession: o login deixa de aceitar o token.
    // sessionToken, não IP — várias sessões podem compartilhar o mesmo IP.
    const removed = await this.prisma.activeSession.deleteMany({
      where: {
        userId: user.id,
        NOT: { sessionToken: user.sessionToken },
      },
    });
    if (removed.count > 0) {
      this.logger.log(`Invalidated ${removed.count} sessions for user ${user.id}`);
    }
  }

  // Método para agendar limpeza de cache
  scheduleCacheCleanup(): void {
    // Limpar cache expirado a cada hora
    setInterval(() => {
      const now = Date.now();
      for (const [key, value] of this.locationCache.entries()) {
        if (now - value.timestamp > this.CACHE_DURATION) {
          this.locationCache.delete(key);
        }
      }
    }, 60 * 60 * 1000); // 1 hora
  }

  private parseUserAgent(ua: string) {
    const deviceType = /mobile/i.test(ua) ? 'Mobile' : /tablet/i.test(ua) ? 'Tablet' : 'Desktop';
    const browserMatch = ua.match(/(edge|chrome|safari|firefox|msie|trident)/i);
    const browser = browserMatch ? browserMatch[1] : 'Other';
    const osMatch = ua.match(/(windows|android|linux|iphone|ipad|mac os)/i);
    let os = osMatch ? osMatch[1] : 'Other';
    if (os.toLowerCase() === 'mac os') os = 'macOS';

    return { deviceType, browser, os };
  }
}
