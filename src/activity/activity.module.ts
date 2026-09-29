import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { APP_ACTIVITY_QUEUE } from '../queue/queue.constants';
import { AppActivityProcessor, AppActivityService } from './app-activity.service';
import { AppActivityInterceptor } from './app-activity.interceptor';

@Module({
  imports: [BullModule.registerQueue({ name: APP_ACTIVITY_QUEUE })],
  providers: [AppActivityService, AppActivityProcessor, AppActivityInterceptor],
  exports: [AppActivityService, AppActivityInterceptor],
})
export class ActivityModule {}
