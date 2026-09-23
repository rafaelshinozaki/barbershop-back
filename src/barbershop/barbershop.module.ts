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
import { APPOINTMENT_REMINDERS_QUEUE } from '../queue/queue.constants';
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
  ],
  providers: [
    BarbershopService,
    EmployeeInviteService,
    AppointmentReminderService,
    AppointmentReminderScheduler,
    AppointmentReminderProcessor,
  ],
  controllers: [EmployeeInviteController],
  exports: [BarbershopService, EmployeeInviteService],
})
export class BarbershopModule {}
