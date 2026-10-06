import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EmailModule } from '../email/email.module';
import { BACKOFFICE_COMMANDS_QUEUE, DEFAULT_JOB_OPTIONS } from '../queue/queue.constants';
import { BackofficeCommandsProcessor } from './backoffice-commands.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: BACKOFFICE_COMMANDS_QUEUE,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
    EmailModule,
  ],
  providers: [BackofficeCommandsProcessor],
})
export class BackofficeCommandsModule {}
