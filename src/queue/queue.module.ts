import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EmailModule } from '../email/email.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { PrismaModule } from '../prisma/prisma.module';
import { redisOptionsFromUrl, redisUrl } from '../redis/redis-url';
import { DEFAULT_JOB_OPTIONS, EMAIL_QUEUE, WHATSAPP_QUEUE } from './queue.constants';
import { NotificationQueueService } from './notification-queue.service';
import { EmailProcessor } from './email.processor';
import { WhatsappProcessor } from './whatsapp.processor';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: redisOptionsFromUrl(redisUrl(config.get<string>('REDIS_URL'))),
        prefix: 'barbershop',
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      }),
    }),
    BullModule.registerQueue({ name: EMAIL_QUEUE }, { name: WHATSAPP_QUEUE }),
    EmailModule,
    WhatsappModule,
    PrismaModule,
  ],
  providers: [NotificationQueueService, EmailProcessor, WhatsappProcessor],
  exports: [BullModule, NotificationQueueService],
})
export class QueueModule {}
