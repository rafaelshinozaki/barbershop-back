import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeService } from './realtime.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
