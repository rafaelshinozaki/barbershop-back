import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { PrismaModule } from '@/prisma/prisma.module';
import { ClientAuthService } from './client-auth.service';
import { ClientAuthController } from './client-auth.controller';
import { GraphQLClientJwtAuthGuard } from './guards/graphql-client-jwt-auth.guard';
import { ClientGoogleStrategy } from './strategies/client-google.strategy';
import { ClientFacebookStrategy } from './strategies/client-facebook.strategy';
import { ClientAppleStrategy } from './strategies/client-apple.strategy';
import { ClientGoogleAuthGuard } from './guards/client-google-auth.guard';
import { ClientFacebookAuthGuard } from './guards/client-facebook-auth.guard';
import { ClientAppleAuthGuard } from './guards/client-apple-auth.guard';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
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
  controllers: [ClientAuthController],
  providers: [
    ClientAuthService,
    GraphQLClientJwtAuthGuard,
    ClientGoogleStrategy,
    ClientFacebookStrategy,
    ClientAppleStrategy,
    ClientGoogleAuthGuard,
    ClientFacebookAuthGuard,
    ClientAppleAuthGuard,
  ],
  exports: [ClientAuthService, GraphQLClientJwtAuthGuard],
})
export class ClientAuthModule {}
