import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SocialService } from './social.service';
import { SCHEDULED_JOB_OPTIONS, SOCIAL_POSTS_QUEUE } from '../queue/queue.constants';

// Publica posts agendados por polling a cada 5 min — granularidade de
// minutos é suficiente pra post de marketing. Agendado pelo BullMQ (uma
// execução por vez no cluster) em vez de @Cron, que rodava em cada
// instância e podia publicar o mesmo post duas vezes.
@Injectable()
export class SocialPostsSchedulerService implements OnModuleInit {
  constructor(@InjectQueue(SOCIAL_POSTS_QUEUE) private readonly queue: Queue) {}

  async onModuleInit() {
    await this.queue.upsertJobScheduler(
      'publish-due-posts',
      { every: 5 * 60 * 1000 },
      { name: 'publish-due-posts', opts: SCHEDULED_JOB_OPTIONS },
    );
  }
}

@Processor(SOCIAL_POSTS_QUEUE)
export class SocialPostsProcessor extends WorkerHost {
  constructor(private readonly socialService: SocialService) {
    super();
  }

  async process() {
    if (!this.socialService.isConfigured()) return;
    await this.socialService.publishDuePosts();
  }
}
