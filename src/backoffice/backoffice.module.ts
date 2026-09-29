import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BackofficeService } from './backoffice.service';
import { BackofficeTeamService } from './backoffice-team.service';
import { BackofficeAuditService } from './audit/backoffice-audit.service';
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
          // Em segundos, como no AuthModule (string sem unidade = milissegundos)
          expiresIn: `${configService.get('JWT_EXPIRATION')}s`,
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [BackofficeService, BackofficeTeamService, BackofficeAuditService],
  exports: [BackofficeService, BackofficeTeamService, BackofficeAuditService],
})
export class BackofficeModule {}
