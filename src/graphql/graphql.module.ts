import { Module } from '@nestjs/common';
import { AuthResolver } from './resolvers/auth.resolver';
import { UserResolver } from './resolvers/user.resolver';
import { PlanResolver } from './resolvers/plan.resolver';
import { BackofficeResolver } from './resolvers/backoffice.resolver';
import { NotificationsResolver } from './resolvers/notifications.resolver';
import { PaymentResolver } from './resolvers/payment.resolver';
import { CouponsResolver } from './resolvers/coupons.resolver';
import { BarbershopResolver } from './resolvers/barbershop.resolver';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../auth/users/users.module';
import { PlanModule } from '../plan/plan.module';
import { BackofficeModule } from '../backoffice/backoffice.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AwsModule } from '../aws/aws.module';
import { StripeModule } from '../stripe/stripe.module';
import { BarbershopModule } from '../barbershop/barbershop.module';
import { PaymentsModule } from '../payments/payments.module';

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
  ],
  providers: [
    AuthResolver,
    UserResolver,
    PlanResolver,
    BackofficeResolver,
    NotificationsResolver,
    PaymentResolver,
    CouponsResolver,
    BarbershopResolver,
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
