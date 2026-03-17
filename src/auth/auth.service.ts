// src\auth\auth.service.ts
import { Injectable } from '@nestjs/common';
import { EmailService } from '@/email/email.service';
import { Request, Response } from 'express';

import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '@/prisma/prisma.service';
import * as https from 'https';
import { TokenPayload } from './interfaces/token-payload.interface';
import { UserDTO } from './users/dto/user.dto';
import { IpLocationService } from '@/common/ip-location.service';

@Injectable()
export class AuthService {
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
    // Iniciar limpeza automática de tokens expirados
    this.scheduleTokenCleanup();
    // Iniciar limpeza de cache a cada hora
    this.scheduleCacheCleanup();
  }

  async login(user: UserDTO, req: Request, res: Response) {
    const token = this.jwtService.sign({ userId: user.id, email: user.email });
    const expires = new Date();
    expires.setDate(expires.getDate() + 7);

    const forwarded = req.headers['x-forwarded-for'];
    const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0] || req.ip;
    const location = await this.ipLocationService.getLocation(ip);
    const existing = await (this.prisma as any).loginHistory?.findFirst({
      where: { userId: user.id, ip },
    });
    const { deviceType, browser, os } = this.parseUserAgent(req.headers['user-agent'] || '');

    await (this.prisma as any).loginHistory?.create({
      data: { userId: user.id, deviceType, browser, os, ip, location },
    });

    await (this.prisma as any).activeSession?.create({
      data: { userId: user.id, deviceType, browser, os, ip, location },
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

      // TODO: Fix Mailgun configuration before enabling email
      try {
        await this.emailService.sendTemplateEmail(
          user.id,
          'new_login_ip',
          context,
          'Novo login detectado',
          'new-login-ip',
          user.email,
        );
      } catch (error) {
        console.warn('Failed to send new login IP email:', error.message);
        // Continue login process even if email fails
      }
    }

    // Configuração melhorada do cookie
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    
    // Para cross-domain cookies, não definir domain deixa o navegador usar o domínio do servidor
    // Se frontend e backend estão em domínios diferentes, domain deve ser undefined
    res.cookie('Authentication', token, {
      httpOnly: true,
      secure: isProduction, // true em produção (HTTPS), false em desenvolvimento
      sameSite: isProduction ? 'none' : 'lax', // 'none' necessário para cross-origin em produção
      // domain removido - deixar o navegador gerenciar para funcionar cross-domain
      path: '/', // Definir path explicitamente
      expires,
    });
  }

  async logout(user: UserDTO, req: Request, res: Response) {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0] || req.ip;
    await (this.prisma as any).activeSession?.deleteMany({
      where: { userId: user.id, ip },
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

  async logoutOtherSessions(user: UserDTO, req: Request) {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0] || req.ip;

    // Buscar todas as sessões ativas do usuário exceto a atual
    const otherSessions = await (this.prisma as any).activeSession?.findMany({
      where: {
        userId: user.id,
        NOT: { ip },
      },
    });

    // Invalidar tokens de outras sessões
    if (otherSessions.length > 0) {
      // Gerar um timestamp único para invalidar tokens
      const invalidationTimestamp = new Date().toISOString();

      // Armazenar o timestamp de invalidação para o usuário
      // Vamos usar o campo updatedAt como indicador de invalidação
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          updatedAt: new Date(), // Isso vai servir como indicador de invalidação
        },
      });

      // Limpar as sessões ativas de outros dispositivos
      await (this.prisma as any).activeSession?.deleteMany({
        where: {
          userId: user.id,
          NOT: { ip },
        },
      });

      // Log da ação
      console.log(`Invalidated ${otherSessions.length} sessions for user ${user.id} from IP ${ip}`);
    }
  }

  async isTokenInvalidated(token: string, userId: number): Promise<boolean> {
    // Verificar se o token está na blacklist
    const invalidatedToken = await (this.prisma as any).invalidatedToken?.findFirst({
      where: {
        token,
        userId,
        expiresAt: {
          gt: new Date(),
        },
      },
    });

    return !!invalidatedToken;
  }

  async invalidateToken(token: string, userId: number): Promise<void> {
    // Decodificar o token para obter a data de expiração
    try {
      const decoded = this.jwtService.decode(token) as any;
      const expiresAt = new Date(decoded.exp * 1000);

      // Adicionar o token à blacklist
      await (this.prisma as any).invalidatedToken?.create({
        data: {
          token,
          userId,
          expiresAt,
        },
      });
    } catch (error) {
      // Se não conseguir decodificar o token, usar uma expiração padrão
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24); // 24 horas

      await (this.prisma as any).invalidatedToken?.create({
        data: {
          token,
          userId,
          expiresAt,
        },
      });
    }
  }

  async cleanupExpiredTokens(): Promise<void> {
    // Remover tokens expirados da blacklist
    await (this.prisma as any).invalidatedToken?.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
  }

  // Método para agendar limpeza de tokens expirados
  scheduleTokenCleanup(): void {
    // Limpar tokens expirados a cada hora
    setInterval(async () => {
      try {
        await this.cleanupExpiredTokens();
      } catch (error) {
        console.error('Error cleaning up expired tokens:', error);
      }
    }, 60 * 60 * 1000); // 1 hora
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

  decodeToken(token: string): any {
    try {
      return this.jwtService.decode(token);
    } catch (error) {
      return null;
    }
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
