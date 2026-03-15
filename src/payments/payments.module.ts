//src\payments\payments.module.ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { RecurringPaymentsService } from './recurring-payments.service';
import { CouponsService } from './coupons.service';
import { CouponsController } from './coupons.controller';
import { FriendInviteService } from './friend-invite.service';
import { FriendInviteController } from './friend-invite.controller';
import { PrismaService } from '../prisma/prisma.service';
import { StripeModule } from '../stripe/stripe.module';
import { EmailModule } from '../email/email.module';
import { AuthModule } from '@/auth/auth.module';

@Module({
  imports: [ScheduleModule.forRoot(), StripeModule, EmailModule, AuthModule],
  controllers: [PaymentsController, CouponsController, FriendInviteController],
  providers: [
    PaymentsService,
    RecurringPaymentsService,
    CouponsService,
    FriendInviteService,
    PrismaService,
  ],
  exports: [PaymentsService, RecurringPaymentsService, CouponsService, FriendInviteService],
})
export class PaymentsModule {}
