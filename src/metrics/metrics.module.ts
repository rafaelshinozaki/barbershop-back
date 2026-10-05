import { Global, Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricsInterceptor } from './metrics.interceptor';
import { BackupModule } from '../backup/backup.module';

/** Métricas a cada 60 s e alertas (horizonte "Registros e estabilidade", R4) */
@Global()
@Module({
  imports: [BackupModule],
  providers: [MetricsService, MetricsInterceptor],
  exports: [MetricsService, MetricsInterceptor],
})
export class MetricsModule {}
