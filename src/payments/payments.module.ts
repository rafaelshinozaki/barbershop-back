//src\payments\payments.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import {
  RecurringPaymentsService,
  RecurringPaymentsScheduler,
  RecurringPaymentsProcessor,
} from './recurring-payments.service';
import { RECURRING_PAYMENTS_QUEUE } from '../queue/queue.constants';
import { CouponsService } from './coupons.service';
import { CouponsController } from './coupons.controller';
import { FriendInviteService } from './friend-invite.service';
import { FriendInviteController } from './friend-invite.controller';
import { PrismaService } from '../prisma/prisma.service';
import { StripeModule } from '../stripe/stripe.module';
import { EmailModule } from '../email/email.module';
import { AuthModule } from '@/auth/auth.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: RECURRING_PAYMENTS_QUEUE }),
    StripeModule,
    EmailModule,
    AuthModule,
  ],
  controllers: [PaymentsController, CouponsController, FriendInviteController],
  providers: [
    PaymentsService,
    RecurringPaymentsService,
    RecurringPaymentsScheduler,
    RecurringPaymentsProcessor,
    CouponsService,
    FriendInviteService,
    PrismaService,
  ],
  exports: [PaymentsService, RecurringPaymentsService, CouponsService, FriendInviteService],
})
export class PaymentsModule {}
