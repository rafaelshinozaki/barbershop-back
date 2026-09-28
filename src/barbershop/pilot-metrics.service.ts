import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { TreatmentCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PILOT_QUEUE } from '../queue/queue.constants';
import { registerSchedulers } from '../queue/register-schedulers';
import { BarbershopService } from './barbershop.service';

/** Quantas unidades do topo da busca contam para "achou horário" */
export const PILOT_TOP_RESULTS = 5;
/** Janela da métrica de liquidez do piloto */
export const PILOT_WINDOW_HOURS = 48;
const EVALUATE_BATCH = 200;

type SearchInput = {
  city?: string | null;
  category?: TreatmentCategory | null;
  lat?: number | null;
  lng?: number | null;
};
type SearchResult = { id: number; city: string };

/**
 * Métrica do piloto: a maioria das buscas acha horário em até 48 h? Cada busca
 * de unidades vira um SearchEvent (sem dado pessoal); um job olha, pouco
 * depois, se alguma das primeiras unidades tinha horário livre nessa janela.
 * O backoffice mostra a taxa junto com os agendamentos vindos da vitrine.
 */
@Injectable()
export class PilotMetricsService {
  private readonly logger = new Logger(PilotMetricsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly barbershops: BarbershopService,
  ) {}

  /** Registra a busca; nunca atrapalha a resposta (erro só vai para o log) */
  async recordSearch(input: SearchInput, results: SearchResult[]) {
    try {
      await this.prisma.searchEvent.create({
        data: {
          city: input.city?.trim() || results[0]?.city || null,
          category: input.category ?? null,
          hasPoint: input.lat != null && input.lng != null,
          resultCount: results.length,
          topBarbershopIds: results.slice(0, PILOT_TOP_RESULTS).map((r) => r.id),
          // Sem resultado: já sabemos que não achou
          ...(results.length === 0 ? { evaluatedAt: new Date(), foundWithin48h: false } : {}),
        },
      });
    } catch (err) {
      this.logger.warn(`Busca não registrada: ${(err as Error).message}`);
    }
  }

  /** Avalia as buscas pendentes: alguma das primeiras tinha horário em até 48 h? */
  async evaluatePending(): Promise<number> {
    const pending = await this.prisma.searchEvent.findMany({
      where: { evaluatedAt: null },
      orderBy: { id: 'asc' },
      take: EVALUATE_BATCH,
    });
    for (const event of pending) {
      const deadline = event.createdAt.getTime() + PILOT_WINDOW_HOURS * 3_600_000;
      let found = false;
      for (const barbershopId of event.topBarbershopIds) {
        const startAt = await this.firstSlot(barbershopId, event.category);
        if (startAt && new Date(startAt).getTime() <= deadline) {
          found = true;
          break;
        }
      }
      await this.prisma.searchEvent.update({
        where: { id: event.id },
        data: { evaluatedAt: new Date(), foundWithin48h: found },
      });
    }
    return pending.length;
  }

  /** Primeiro horário livre da unidade (qualquer profissional) nos próximos dias */
  private async firstSlot(barbershopId: number, category: TreatmentCategory | null) {
    // O serviço mais curto da categoria buscada (ou de qualquer uma): se nem
    // ele cabe, a pessoa não acharia horário
    const service = await this.prisma.barbershopService.findFirst({
      where: { barbershopId, isActive: true, ...(category ? { category } : {}) },
      orderBy: { durationMinutes: 'asc' },
      select: { id: true },
    });
    if (!service) return null;
    try {
      const days = Math.ceil(PILOT_WINDOW_HOURS / 24) + 1;
      const next = await this.barbershops.getPublicNextAvailableSlot(
        barbershopId,
        null,
        [service.id],
        null,
        days,
      );
      return next?.startAt ?? null;
    } catch {
      // Unidade desativada ou sem profissional depois da busca: não achou
      return null;
    }
  }

  /** Números do piloto no período (dias), opcionalmente de uma cidade */
  async metrics(days: number, city?: string | null) {
    const since = new Date(Date.now() - Math.min(Math.max(days, 1), 365) * 86_400_000);
    const wanted = city?.trim() ? this.barbershops.slugifyCity(city) : null;
    const inCity = (c: string | null) =>
      !wanted || (c != null && this.barbershops.slugifyCity(c) === wanted);

    const events = (
      await this.prisma.searchEvent.findMany({
        where: { createdAt: { gte: since } },
        select: { city: true, category: true, evaluatedAt: true, foundWithin48h: true },
      })
    ).filter((e) => inCity(e.city));
    const byCategory = new Map<string, { searches: number; evaluated: number; found: number }>();
    const total = { searches: 0, evaluated: 0, found: 0 };
    for (const e of events) {
      const key = e.category ?? 'ANY';
      const row = byCategory.get(key) ?? { searches: 0, evaluated: 0, found: 0 };
      for (const acc of [row, total]) {
        acc.searches++;
        if (e.evaluatedAt) acc.evaluated++;
        if (e.foundWithin48h) acc.found++;
      }
      byCategory.set(key, row);
    }

    const bookings = (
      await this.prisma.appointment.findMany({
        where: { source: 'ONLINE', createdAt: { gte: since }, bookingChannel: { not: null } },
        select: { bookingChannel: true, firstVisit: true, barbershop: { select: { city: true } } },
      })
    ).filter((a) => inCity(a.barbershop.city));
    const rate = (found: number, evaluated: number) => (evaluated ? found / evaluated : null);

    return {
      days,
      city: city?.trim() || null,
      searches: total.searches,
      evaluated: total.evaluated,
      foundWithin48h: total.found,
      foundRate: rate(total.found, total.evaluated),
      byCategory: [...byCategory.entries()]
        .map(([category, r]) => ({
          category,
          searches: r.searches,
          evaluated: r.evaluated,
          foundWithin48h: r.found,
          foundRate: rate(r.found, r.evaluated),
        }))
        .sort((a, b) => b.searches - a.searches),
      marketplaceBookings: bookings.filter((b) => b.bookingChannel === 'marketplace').length,
      marketplaceNewClients: bookings.filter(
        (b) => b.bookingChannel === 'marketplace' && b.firstVisit,
      ).length,
      directBookings: bookings.filter((b) => b.bookingChannel === 'direct').length,
    };
  }
}

/** Avaliação das buscas: a cada 10 minutos, uma só no cluster */
@Injectable()
export class PilotScheduler implements OnModuleInit {
  constructor(@InjectQueue(PILOT_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    registerSchedulers(this.queue, [
      { id: 'evaluate-search-events', repeat: { every: 10 * 60 * 1000 } },
    ]);
  }
}

@Processor(PILOT_QUEUE)
export class PilotProcessor extends WorkerHost {
  constructor(private readonly pilot: PilotMetricsService) {
    super();
  }

  async process() {
    return this.pilot.evaluatePending();
  }
}
