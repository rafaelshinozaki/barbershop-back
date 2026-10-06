import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EmailModule } from '../email/email.module';
import { SupportModule } from '../support/support.module';
import { ClientAuthModule } from '../client-auth/client-auth.module';
import { SearchCacheService } from '../barbershop/search-cache.service';
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
  ],
  // Cache da busca: estado no Redis (global); uma instância aqui basta
  providers: [BackofficeCommandsProcessor, SearchCacheService],
})
export class BackofficeCommandsModule {}
