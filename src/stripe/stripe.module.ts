import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StripeService } from './stripe.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [ConfigModule, PrismaModule, EmailModule],
  providers: [StripeService],
  exports: [StripeService],
})
export class StripeModule {}
