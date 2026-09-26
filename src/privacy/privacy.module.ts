import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { DATA_RETENTION_QUEUE } from '../queue/queue.constants';
import { RetentionProcessor, RetentionScheduler, RetentionService } from './retention.service';

@Module({
  imports: [PrismaModule, BullModule.registerQueue({ name: DATA_RETENTION_QUEUE })],
  providers: [RetentionService, RetentionScheduler, RetentionProcessor],
})
export class PrivacyModule {}
