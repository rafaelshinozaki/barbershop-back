import { Logger } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';
import { redisOptionsFromUrl } from './redis-url';

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/**
 * Contadores do rate limit no Redis, compartilhados entre todas as
 * instâncias do back — em memória, cada instância contava sozinha e o
 * limite efetivo virava limite × número de instâncias (ex.: login 3/5min
 * virava 9/5min com 3 réplicas).
 *
 * Se o Redis cair, deixa a requisição passar (sem limite) em vez de
 * derrubar o site inteiro: todo request passa por aqui, e um erro no
 * throttle viraria 500 em tudo, inclusive páginas públicas.
 */
export class FailOpenRedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger('ThrottlerStorage');
  private readonly inner: ThrottlerStorageRedisService;
  private lastErrorLog = 0;

  constructor(url: string) {
    const client = new Redis({
      ...redisOptionsFromUrl(url),
      keyPrefix: 'throttle:',
      // Throttle está no caminho de toda requisição: falha rápido
      commandTimeout: 1000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    client.on('error', () => undefined); // logado abaixo, com limite
    this.inner = new ThrottlerStorageRedisService(client);
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    try {
      return await this.inner.increment(key, ttl, limit, blockDuration, throttlerName);
    } catch (error) {
      // No máximo um log por minuto enquanto o Redis estiver fora
      if (Date.now() - this.lastErrorLog > 60_000) {
        this.lastErrorLog = Date.now();
        this.logger.error(`Redis indisponível, rate limit desligado: ${(error as Error).message}`);
      }
      return { totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };
    }
  }
}
