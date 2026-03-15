// src/email/email.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmailService } from './email.service';
import { TestEmailController } from './test-email.controller';
import { MailgunService } from './mailgun.service';

@Module({
  imports: [ConfigModule],
  controllers: [TestEmailController],
  providers: [EmailService, MailgunService],
  exports: [EmailService],
})
export class EmailModule {}
