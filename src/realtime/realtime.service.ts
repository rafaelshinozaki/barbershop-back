import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisPubSub } from 'graphql-redis-subscriptions';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { redisOptionsFromUrl, redisUrl } from '../redis/redis-url';

export type ActivityKind = 'APPOINTMENT' | 'SALE' | 'WALK_IN' | 'CUSTOMER';
export type ActivityAction = 'CREATED' | 'UPDATED' | 'DELETED';

export interface NetworkActivityPayload {
  networkId: number;
  barbershopId: number;
  kind: ActivityKind;
  action: ActivityAction;
  at: string;
}

export const NETWORK_ACTIVITY = 'NETWORK_ACTIVITY';

/**
 * Avisos em tempo real pros dashboards (WebSocket/GraphQL subscription).
 *
 * Pub/sub pelo Redis: o evento publicado por uma instância do back chega em
 * quem estiver conectado em qualquer outra. O aviso só diz "algo mudou nesta
 * barbearia" — a tela recarrega os próprios dados (sem mandar dados de
 * clientes pelo socket).
 */
@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);
  readonly pubSub: RedisPubSub;
  // barbershopId → networkId (não muda depois de criada)
  private readonly networkOf = new Map<number, number>();

  constructor(config: ConfigService, private readonly prisma: PrismaService) {
    const options = redisOptionsFromUrl(redisUrl(config.get<string>('REDIS_URL')));
    const make = () => {
      const client = new Redis(options);
      client.on('error', (err) => this.logger.error(`Redis pub/sub: ${err.message}`));
      return client;
    };
    this.pubSub = new RedisPubSub({ publisher: make(), subscriber: make() });
  }

  /**
   * Publica sem nunca quebrar quem chamou: falha no aviso não pode desfazer
   * nem atrasar a venda/agendamento que acabou de ser salvo.
   */
  notify(barbershopId: number, kind: ActivityKind, action: ActivityAction) {
    void this.publish(barbershopId, kind, action).catch((err) =>
      this.logger.warn(`Aviso em tempo real não enviado: ${err.message}`),
    );
  }

  private async publish(barbershopId: number, kind: ActivityKind, action: ActivityAction) {
    let networkId = this.networkOf.get(barbershopId);
    if (networkId === undefined) {
      const shop = await this.prisma.barbershop.findUnique({
        where: { id: barbershopId },
        select: { networkId: true },
      });
      if (!shop) return;
      networkId = shop.networkId;
      this.networkOf.set(barbershopId, networkId);
    }
    const payload: NetworkActivityPayload = {
      networkId,
      barbershopId,
      kind,
      action,
      at: new Date().toISOString(),
    };
    await this.pubSub.publish(NETWORK_ACTIVITY, { networkActivity: payload });
  }

  async onModuleDestroy() {
    await this.pubSub.close().catch(() => undefined);
  }
}
