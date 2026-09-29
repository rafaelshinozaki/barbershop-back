// src/email/email.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmailService } from './email.service';
import { MailgunService } from './mailgun.service';

@Module({
  imports: [ConfigModule],
  providers: [EmailService, MailgunService],
  exports: [EmailService],
})
export class EmailModule {}
