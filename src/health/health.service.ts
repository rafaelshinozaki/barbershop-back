import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class HealthService {
  constructor(
    private prisma: PrismaService,
    private stripeService: StripeService,
    private redis: RedisService,
  ) {}

  async getHealthStatus() {
    const database = await this.checkDatabase();
    const stripe = await this.checkStripe();
    const redis = await this.checkRedis();
    const status =
      database === 'connected' && stripe === 'available' && redis === 'connected' ? 'ok' : 'error';
    const timestamp = new Date().toISOString();
    return { status, database, stripe, redis, timestamp };
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

  private async checkStripe(): Promise<'available' | 'unavailable'> {
    return (await this.stripeService.isAvailable()) ? 'available' : 'unavailable';
  }
}
