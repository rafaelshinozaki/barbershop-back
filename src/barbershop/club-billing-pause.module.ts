import { Module } from '@nestjs/common';
import { EmailModule } from '@/email/email.module';
import { StripeModule } from '@/stripe/stripe.module';
import { ClubBillingPauseService } from './club-billing-pause.service';

@Module({
  imports: [StripeModule, EmailModule],
  providers: [ClubBillingPauseService],
  exports: [ClubBillingPauseService],
})
export class ClubBillingPauseModule {}
