// src\auth\users\users.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TRIAL_QUEUE } from '../../queue/queue.constants';
import { UserService } from './users.service';
import { TrialExpiryProcessor, TrialExpiryScheduler } from './trial-expiry';
import { UserController } from './users.controller';
import { EmailModule } from '@/email/email.module';
import { PrismaService } from '@/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { AwsModule } from '@/aws/aws.module';
import { ClubBillingPauseModule } from '@/barbershop/club-billing-pause.module';

@Module({
  imports: [EmailModule, AwsModule, ClubBillingPauseModule, BullModule.registerQueue({ name: TRIAL_QUEUE })],
  providers: [UserService, PrismaService, JwtService, TrialExpiryScheduler, TrialExpiryProcessor],
  controllers: [UserController],
  exports: [UserService, PrismaService],
})
export class UserModule {}
