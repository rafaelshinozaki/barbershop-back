import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { redisOptionsFromUrl, redisUrl } from './redis-url';

/**
 * Conexão Redis compartilhada pra estado que precisa valer entre todas as
 * instâncias do back (código de login, bloqueio por tentativas, código de
 * 2FA). Antes isso ficava em Map na memória do processo: com mais de uma
 * instância atrás do load balancer, o código gerado numa era validado na
 * outra e o login falhava.
 *
 * Falha rápido em vez de enfileirar comandos com o Redis fora do ar — um
 * login esperando indefinidamente é pior que um erro.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis({
      ...redisOptionsFromUrl(redisUrl(config.get<string>('REDIS_URL'))),
      maxRetriesPerRequest: 2,
      commandTimeout: 3000,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
    this.client.on('error', (err) => this.logger.error(`Redis: ${err.message}`));
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  /** Grava JSON com expiração em segundos. */
  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), 'EX', Math.max(1, Math.ceil(ttlSeconds)));
  }

  async onModuleDestroy() {
    await this.client.quit().catch(() => undefined);
  }
}
