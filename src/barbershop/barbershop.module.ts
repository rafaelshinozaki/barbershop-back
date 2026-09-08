import { Module } from '@nestjs/common';
import { BarbershopService } from './barbershop.service';
import { EmployeeInviteService } from './employee-invite.service';
import { EmployeeInviteController } from './employee-invite.controller';
import { AppointmentReminderService } from './appointment-reminder.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../auth/users/users.module';
import { AwsModule } from '../aws/aws.module';

@Module({
  imports: [PrismaModule, EmailModule, WhatsappModule, AuthModule, UserModule, AwsModule],
  providers: [BarbershopService, EmployeeInviteService, AppointmentReminderService],
  controllers: [EmployeeInviteController],
  exports: [BarbershopService, EmployeeInviteService],
})
export class BarbershopModule {}
