import { MarketingUnsubscribeController } from './marketing-unsubscribe.controller';
import { AccountDeletionService } from './account-deletion.service';
import { SharedLocationService } from './shared-location.service';
import { ChairRentService, ChairRentScheduler, ChairRentProcessor } from './chair-rent.service';
import { Module } from '@nestjs/common';
import { BarbershopService } from './barbershop.service';
import { EmployeeInviteService } from './employee-invite.service';
import { EmployeeInviteController } from './employee-invite.controller';
import { BullModule } from '@nestjs/bullmq';
import {
  AppointmentReminderService,
  AppointmentReminderScheduler,
  AppointmentReminderProcessor,
} from './appointment-reminder.service';
import { APPOINTMENT_REMINDERS_QUEUE, CHAIR_RENT_QUEUE } from '../queue/queue.constants';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../auth/users/users.module';
import { AwsModule } from '../aws/aws.module';
import { StripeModule } from '../stripe/stripe.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    PrismaModule,
    EmailModule,
    WhatsappModule,
    AuthModule,
    UserModule,
    AwsModule,
    StripeModule,
    NotificationsModule,
    BullModule.registerQueue({ name: APPOINTMENT_REMINDERS_QUEUE }),
    BullModule.registerQueue({ name: CHAIR_RENT_QUEUE }),
  ],
  providers: [
    BarbershopService,
    AccountDeletionService,
    EmployeeInviteService,
    SharedLocationService,
    ChairRentService,
    ChairRentScheduler,
    ChairRentProcessor,
    AppointmentReminderService,
    AppointmentReminderScheduler,
    AppointmentReminderProcessor,
  ],
  controllers: [EmployeeInviteController, MarketingUnsubscribeController],
  exports: [
    BarbershopService,
    EmployeeInviteService,
    AccountDeletionService,
    SharedLocationService,
    ChairRentService,
  ],
})
export class BarbershopModule {}
