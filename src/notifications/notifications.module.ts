import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

// O REST controller foi removido (sem chamadores desde a migração para
// GraphQL, ver src/graphql/resolvers/notifications.resolver.ts) e o
// NotificationsResolver é registrado uma única vez, em GraphQLAppModule
// (padrão usado por todos os outros módulos de resolver deste app).
@Module({
  imports: [PrismaModule, AuthModule],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
