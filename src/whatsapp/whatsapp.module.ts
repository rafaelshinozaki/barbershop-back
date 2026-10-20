import { Module } from '@nestjs/common';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappOptOutService } from './whatsapp-opt-out.service';
import { WhatsappService } from './whatsapp.service';

@Module({
  controllers: [WhatsappController],
  providers: [WhatsappService, WhatsappOptOutService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
