import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BackofficeService } from './backoffice.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';

// Todos os endpoints REST deste módulo foram migrados para GraphQL
// (ver src/graphql/resolvers/backoffice.resolver.ts); o controller
// REST vazio foi removido.
@Module({
  imports: [
    PrismaModule,
    EmailModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRATION'),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [BackofficeService],
  exports: [BackofficeService],
})
export class BackofficeModule {}
