import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EmailModule } from '../email/email.module';
import { SupportModule } from '../support/support.module';
import { ClientAuthModule } from '../client-auth/client-auth.module';
import { SearchCacheService } from '../barbershop/search-cache.service';
import { PricingModule } from '../pricing/pricing.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { BarbershopModule } from '../barbershop/barbershop.module';
import { BackofficeService } from '../backoffice/backoffice.service';
import { ApprovalService } from '../backoffice/approval.service';
import { BACKOFFICE_COMMANDS_QUEUE, DEFAULT_JOB_OPTIONS } from '../queue/queue.constants';
import { BackofficeCommandsProcessor } from './backoffice-commands.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: BACKOFFICE_COMMANDS_QUEUE,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
    EmailModule,
    SupportModule,
    ClientAuthModule,
    PricingModule,
    RealtimeModule,
    BarbershopModule,
  ],
  // Cache da busca: estado no Redis (global); uma instância aqui basta. O
  // BackofficeService só lê o banco e manda e-mail, e o ApprovalService
  // executa pedidos já confirmados (sem estado)
  providers: [BackofficeCommandsProcessor, SearchCacheService, BackofficeService, ApprovalService],
})
export class BackofficeCommandsModule {}
