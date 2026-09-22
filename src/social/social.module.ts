import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '@/prisma/prisma.module';
import { AwsModule } from '@/aws/aws.module';
import { BarbershopModule } from '@/barbershop/barbershop.module';
import { SocialService } from './social.service';
import { SocialController } from './social.controller';
import { BullModule } from '@nestjs/bullmq';
import {
  SocialPostsSchedulerService,
  SocialPostsProcessor,
} from './social-posts-scheduler.service';
import { SOCIAL_POSTS_QUEUE } from '../queue/queue.constants';

@Module({
  imports: [
    PrismaModule,
    AwsModule,
    BarbershopModule,
    BullModule.registerQueue({ name: SOCIAL_POSTS_QUEUE }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [SocialController],
  providers: [SocialService, SocialPostsSchedulerService, SocialPostsProcessor],
  exports: [SocialService],
})
export class SocialModule {}
