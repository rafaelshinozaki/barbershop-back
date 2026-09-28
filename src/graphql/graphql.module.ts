import { AccountDeletionResolver } from './resolvers/account-deletion.resolver';
import { CareerResolver } from './resolvers/career.resolver';
import { CustomerRatingResolver } from './resolvers/customer-rating.resolver';
import { AppTipResolver, TipResolver } from './resolvers/tip.resolver';
import { ModerationResolver } from './resolvers/moderation.resolver';
import { AccountLinkResolver } from './resolvers/account-link.resolver';
import { IdentityVerificationResolver } from './resolvers/identity-verification.resolver';
import { ChatResolver } from './resolvers/chat.resolver';
import { SupportResolver } from './resolvers/support.resolver';
import { JobOpeningResolver } from './resolvers/job-opening.resolver';
import { FeaturedResolver } from './resolvers/featured.resolver';
import { PilotResolver } from './resolvers/pilot.resolver';
import { PricingResolver } from './resolvers/pricing.resolver';
import { PushResolver } from './resolvers/push.resolver';
import { ConnectResolver } from './resolvers/connect.resolver';
import { PrepaymentResolver } from './resolvers/prepayment.resolver';
import { SupportModule } from '../support/support.module';
import { SoloResolver } from './resolvers/solo.resolver';
import { ImportResolver } from './resolvers/import.resolver';
import { PublicProfessionalResolver } from './resolvers/public-professional.resolver';
import { Module } from '@nestjs/common';
import { AuthResolver } from './resolvers/auth.resolver';
import { UserResolver } from './resolvers/user.resolver';
import { PlanResolver } from './resolvers/plan.resolver';
import { BackofficeResolver } from './resolvers/backoffice.resolver';
import { NotificationsResolver } from './resolvers/notifications.resolver';
import { PaymentResolver } from './resolvers/payment.resolver';
import { CouponsResolver } from './resolvers/coupons.resolver';
import { BarbershopResolver } from './resolvers/barbershop.resolver';
import { BarbershopProductResolver } from './resolvers/barbershop-product.resolver';
import { BarbershopPhotoResolver } from './resolvers/barbershop-photo.resolver';
import { NetworkResolver } from './resolvers/network.resolver';
import { ClientAuthResolver } from './resolvers/client-auth.resolver';
import { PublicBookingResolver } from './resolvers/public-booking.resolver';
import { SharedLocationResolver } from './resolvers/shared-location.resolver';
import { PayrollResolver } from './resolvers/payroll.resolver';
import { CalendarResolver } from './resolvers/calendar.resolver';
import { ReviewRequestResolver } from './resolvers/review-request.resolver';
import { ClosureResolver } from './resolvers/closure.resolver';
import { ScheduleResolver } from './resolvers/schedule.resolver';
import { AppointmentSeriesResolver } from './resolvers/appointment-series.resolver';
import { DepositResolver } from './resolvers/deposit.resolver';
import {
  BarberAvatarResolver,
  MediaResolver,
  PublicBarberAvatarResolver,
} from './resolvers/media.resolver';
import { SocialResolver } from './resolvers/social.resolver';
import { RealtimeResolver } from './resolvers/realtime.resolver';
import { AuthModule } from '../auth/auth.module';
import { ClientAuthModule } from '../client-auth/client-auth.module';
import { UserModule } from '../auth/users/users.module';
import { PlanModule } from '../plan/plan.module';
import { BackofficeModule } from '../backoffice/backoffice.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AwsModule } from '../aws/aws.module';
import { StripeModule } from '../stripe/stripe.module';
import { BarbershopModule } from '../barbershop/barbershop.module';
import { PaymentsModule } from '../payments/payments.module';
import { SocialModule } from '../social/social.module';

@Module({
  imports: [
    AuthModule,
    UserModule,
    PlanModule,
    BackofficeModule,
    NotificationsModule,
    PrismaModule,
    AwsModule,
    StripeModule,
    BarbershopModule,
    PaymentsModule,
    ClientAuthModule,
    SocialModule,
    SupportModule,
  ],
  providers: [
    RealtimeResolver,
    AuthResolver,
    UserResolver,
    PlanResolver,
    BackofficeResolver,
    NotificationsResolver,
    PaymentResolver,
    CouponsResolver,
    BarbershopResolver,
    BarbershopProductResolver,
    BarbershopPhotoResolver,
    NetworkResolver,
    ClientAuthResolver,
    PublicBookingResolver,
    SharedLocationResolver,
    PayrollResolver,
    CalendarResolver,
    ReviewRequestResolver,
    ClosureResolver,
    ScheduleResolver,
    AppointmentSeriesResolver,
    DepositResolver,
    MediaResolver,
    BarberAvatarResolver,
    PublicBarberAvatarResolver,
    SocialResolver,
    AccountDeletionResolver,
    CareerResolver,
    CustomerRatingResolver,
    TipResolver,
    AppTipResolver,
    ModerationResolver,
    AccountLinkResolver,
    IdentityVerificationResolver,
    ChatResolver,
    SupportResolver,
    JobOpeningResolver,
    FeaturedResolver,
    PilotResolver,
    PricingResolver,
    PushResolver,
    ConnectResolver,
    PrepaymentResolver,
    SoloResolver,
    ImportResolver,
    PublicProfessionalResolver,
  ],
  exports: [
    AuthResolver,
    UserResolver,
    PlanResolver,
    BackofficeResolver,
    NotificationsResolver,
    PaymentResolver,
    CouponsResolver,
  ],
})
export class GraphQLAppModule {}
