import { Module } from '@nestjs/common';
import { BarbershopService } from './barbershop.service';
import { EmployeeInviteService } from './employee-invite.service';
import { EmployeeInviteController } from './employee-invite.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../auth/users/users.module';

@Module({
  imports: [PrismaModule, EmailModule, AuthModule, UserModule],
  providers: [BarbershopService, EmployeeInviteService],
  controllers: [EmployeeInviteController],
  exports: [BarbershopService, EmployeeInviteService],
})
export class BarbershopModule {}
