import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GEOCODING_QUEUE } from '../queue/queue.constants';
import { registerSchedulers } from '../queue/register-schedulers';

type Address = {
  address: string;
  complement1?: string | null;
  city: string;
  state: string;
  postalCode?: string | null;
  country: string;
};

const ADDRESS_FIELDS = {
  address: true,
  complement1: true,
  city: true,
  state: true,
  postalCode: true,
  country: true,
} as const;

const addressKey = (a: Address) =>
  JSON.stringify([
    a.address,
    a.complement1 ?? null,
    a.city,
    a.state,
    a.postalCode ?? null,
    a.country,
  ]);

/** Nominatim pede no máximo 1 pedido por segundo */
const MIN_INTERVAL_MS = 1100;
/** Quantas unidades sem localização completar por vez */
const BACKFILL_BATCH = 200;
/** Endereço não encontrado: tenta de novo só depois deste prazo */
const GEOCODE_RETRY_MS = 7 * 86_400_000;

/** Unidades ativas sem coordenada, as nunca tentadas primeiro. */
export function geocodeBackfillWhere(now = new Date()): Prisma.BarbershopWhereInput {
  const retryAfter = new Date(now.getTime() - GEOCODE_RETRY_MS);
  return {
    isActive: true,
    OR: [{ latitude: null }, { longitude: null }],
    AND: [
      {
        OR: [{ geocodeAttemptedAt: null }, { geocodeAttemptedAt: { lt: retryAfter } }],
      },
    ],
  };
}

/**
 * Latitude/longitude da unidade a partir do endereço (OpenStreetMap
 * Nominatim — sem chave; GEOCODING_URL troca o serviço). Sem isso a busca
 * "perto de mim" não achava nenhuma unidade cadastrada pelo app: nada
 * preenchia as coordenadas. Roda ao cadastrar/mudar o endereço e, ao subir,
 * completa as que ainda não têm. Falhou ou não achou: fica sem, sem erro.
 */
@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private queue: Promise<unknown> = Promise.resolve();
  private last = 0;

  constructor(private readonly prisma: PrismaService) {}

  private get enabled() {
    return process.env.GEOCODING_DISABLED !== 'true' && process.env.NODE_ENV !== 'test';
  }

  /** Coordenadas do endereço (null se não achou ou o serviço falhou) */
  async geocode(a: Address): Promise<{ lat: number; lng: number } | null> {
    const base = process.env.GEOCODING_URL || 'https://nominatim.openstreetmap.org/search';
    const params = new URLSearchParams({
      format: 'json',
      limit: '1',
      street: a.address,
      city: a.city,
      state: a.state,
      country: a.country,
      ...(a.postalCode ? { postalcode: a.postalCode } : {}),
    });
    // Um pedido por vez, respeitando o intervalo mínimo
    const run = this.queue.then(async () => {
      const wait = this.last + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
      const res = await fetch(`${base}?${params}`, {
        headers: {
          'User-Agent': `barbershop-app/1.0 (${process.env.FRONTEND_URL || 'barbershop'})`,
          'Accept-Language': 'pt-BR,en',
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = (await res.json()) as Array<{ lat: string; lon: string }>;
      const first = rows[0];
      if (!first) return null;
      const lat = Number(first.lat);
      const lng = Number(first.lon);
      return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    });
    this.queue = run.catch(() => undefined);
    try {
      return await run;
    } catch (err) {
      this.logger.warn(`Não localizou "${a.address}, ${a.city}": ${String(err)}`);
      return null;
    }
  }

  /** Localiza a unidade pelo endereço e grava as coordenadas */
  async locate(barbershopId: number): Promise<boolean> {
    if (!this.enabled) return false;
    return this.locateNow(barbershopId).catch((err) => {
      this.logger.warn(`Não localizou a unidade #${barbershopId}: ${String(err)}`);
      return false;
    });
  }

  /** O endereço atual, pra comparar depois de uma edição */
  async addressOf(barbershopId: number): Promise<string | null> {
    const shop = await this.prisma.barbershop.findUnique({
      where: { id: barbershopId },
      select: ADDRESS_FIELDS,
    });
    return shop ? addressKey(shop) : null;
  }

  /**
   * Depois de editar a unidade: se o endereço mudou, as coordenadas antigas
   * saem antes de localizar o novo. Antes, endereço novo não encontrado
   * deixava a unidade no lugar antigo, e o backfill nunca corrigia (item 290).
   */
  async relocateIfMoved(barbershopId: number, before: string | null): Promise<boolean> {
    if (!this.enabled) return false;
    const now = await this.addressOf(barbershopId);
    if (now == null || now === before) return false;
    await this.prisma.barbershop.update({
      where: { id: barbershopId },
      data: { latitude: null, longitude: null },
    });
    return this.locate(barbershopId);
  }

  private async locateNow(barbershopId: number): Promise<boolean> {
    const shop = await this.prisma.barbershop.findUnique({ where: { id: barbershopId } });
    if (!shop) return false;
    const found = await this.geocode(shop);
    if (!found) {
      await this.prisma.barbershop.update({
        where: { id: barbershopId },
        data: { geocodeAttemptedAt: new Date() },
      });
      return false;
    }
    await this.prisma.barbershop.update({
      where: { id: barbershopId },
      data: { latitude: found.lat, longitude: found.lng },
    });
    return true;
  }

  /** Completa as unidades ativas que ainda não têm localização */
  async backfill(): Promise<number> {
    const shops = await this.prisma.barbershop.findMany({
      where: geocodeBackfillWhere(),
      select: { id: true },
      orderBy: [{ geocodeAttemptedAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
      take: BACKFILL_BATCH,
    });
    let done = 0;
    for (const s of shops) if (await this.locate(s.id)) done++;
    if (shops.length) this.logger.log(`Localização completada: ${done}/${shops.length} unidade(s)`);
    return done;
  }
}

@Injectable()
export class GeocodingScheduler implements OnModuleInit {
  constructor(@InjectQueue(GEOCODING_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    if (process.env.GEOCODING_DISABLED === 'true' || process.env.NODE_ENV === 'test') return;
    registerSchedulers(this.queue, [{ id: 'geocode-backfill', repeat: { pattern: '0 15 * * * *' } }]);
  }
}

@Processor(GEOCODING_QUEUE)
export class GeocodingProcessor extends WorkerHost {
  constructor(private readonly geocoding: GeocodingService) {
    super();
  }

  async process(job: Job) {
    if (job.name === 'geocode-backfill') return this.geocoding.backfill();
  }
}
