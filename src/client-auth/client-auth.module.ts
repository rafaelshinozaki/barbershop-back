import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '@/prisma/prisma.module';
import { ClientAuthService } from './client-auth.service';
import { GraphQLClientJwtAuthGuard } from './guards/graphql-client-jwt-auth.guard';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: `${configService.get('JWT_EXPIRATION')}s` },
      }),
    }),
  ],
  providers: [ClientAuthService, GraphQLClientJwtAuthGuard],
  exports: [ClientAuthService, GraphQLClientJwtAuthGuard],
})
export class ClientAuthModule {}
