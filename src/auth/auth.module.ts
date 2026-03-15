// src\auth\auth.module.ts
import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UserModule } from './users/users.module';
import { LocalStrategy } from './strategies/local.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PrismaModule } from '@/prisma/prisma.module';
import { RolesGuard } from './guards/roles.guard';
import { SubscriptionGuard } from './guards/subscription.guard';
import { PassportModule } from '@nestjs/passport';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { EmailModule } from '@/email/email.module';
import { IpLocationService } from '@/common/ip-location.service';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    UserModule,
    EmailModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: `${configService.get('JWT_EXPIRATION')}s` },
      }),
    }),
  ],
  providers: [
    AuthService,
    LocalStrategy,
    JwtStrategy,
    GoogleStrategy,
    GoogleAuthGuard,
    RolesGuard,
    SubscriptionGuard,
    IpLocationService,
  ],
  controllers: [AuthController],
  exports: [AuthService, JwtModule, RolesGuard, SubscriptionGuard, IpLocationService],
})
export class AuthModule {}
