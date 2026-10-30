import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { TRIAL_QUEUE } from '../../queue/queue.constants';
import { registerSchedulers } from '../../queue/register-schedulers';
import { UserService } from './users.service';

/** Uma vez por hora, no cluster inteiro — não na consulta de status. */
@Injectable()
export class TrialExpiryScheduler implements OnModuleInit {
  constructor(@InjectQueue(TRIAL_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    registerSchedulers(this.queue, [
      { id: 'expire-trials', repeat: { pattern: '0 20 * * * *' } },
    ]);
  }
}

@Processor(TRIAL_QUEUE)
export class TrialExpiryProcessor extends WorkerHost {
  constructor(private readonly users: UserService) {
    super();
  }

  async process(job: Job) {
    if (job.name === 'expire-trials') return this.users.processExpiredTrials();
  }
}
