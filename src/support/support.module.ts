import { Module } from '@nestjs/common';
import { EmailModule } from '@/email/email.module';
import { SupportService } from './support.service';

@Module({
  imports: [EmailModule],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
