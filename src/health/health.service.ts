import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';

@Injectable()
export class HealthService {
  constructor(private prisma: PrismaService, private stripeService: StripeService) {}

  async getHealthStatus() {
    const database = await this.checkDatabase();
    const stripe = await this.checkStripe();
    const status = database === 'connected' && stripe === 'available' ? 'ok' : 'error';
    const timestamp = new Date().toISOString();
    return { status, database, stripe, timestamp };
  }

  private async checkDatabase(): Promise<'connected' | 'disconnected'> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'connected';
    } catch (error) {
      return 'disconnected';
    }
  }

  private async checkStripe(): Promise<'available' | 'unavailable'> {
    return (await this.stripeService.isAvailable()) ? 'available' : 'unavailable';
  }
}
