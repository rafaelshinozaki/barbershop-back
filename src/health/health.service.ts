import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class HealthService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  async getHealthStatus() {
    const database = await this.checkDatabase();
    const redis = await this.checkRedis();
    const status = database === 'connected' && redis === 'connected' ? 'ok' : 'error';
    const timestamp = new Date().toISOString();
    return { status, database, redis, timestamp };
  }

  private async checkDatabase(): Promise<'connected' | 'disconnected'> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'connected';
    } catch (error) {
      return 'disconnected';
    }
  }

  // Sem Redis não há fila (e-mails/lembretes) nem login por código
  private async checkRedis(): Promise<'connected' | 'disconnected'> {
    try {
      return (await this.redis.client.ping()) === 'PONG' ? 'connected' : 'disconnected';
    } catch {
      return 'disconnected';
    }
  }

}
