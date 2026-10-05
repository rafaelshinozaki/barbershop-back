import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BACKUP_QUEUE } from '../queue/queue.constants';
import { BackupProcessor, BackupScheduler, BackupService } from './backup.service';

@Module({
  imports: [BullModule.registerQueue({ name: BACKUP_QUEUE })],
  providers: [BackupService, BackupScheduler, BackupProcessor],
  exports: [BackupService, BackupScheduler],
})
export class BackupModule {}
