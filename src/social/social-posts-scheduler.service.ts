import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SocialService } from './social.service';

// Publica posts agendados por polling — sem fila de jobs no projeto, e
// granularidade de minutos é suficiente pra post de marketing (ninguém
// precisa de precisão ao segundo pra isso). Mesmo padrão de
// appointment-reminder.service.ts / recurring-payments.service.ts.
@Injectable()
export class SocialPostsSchedulerService {
  private readonly logger = new Logger(SocialPostsSchedulerService.name);

  constructor(private readonly socialService: SocialService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handlePublishDuePosts() {
    if (!this.socialService.isConfigured()) return;
    await this.socialService.publishDuePosts();
  }
}
