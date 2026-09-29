import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { RedisService } from '../redis/redis.service';
import { clampRadius, haversineKm, rankResults, type SearchSort } from './search';

/**
 * A vitrine pode atrasar até isso. A única invalidação é o Destaque (ligado
 * pelo admin ou comprado), que sobe a "geração" do cache: quem pagou ou foi
 * tirado do topo vê a mudança na hora.
 */
export const SEARCH_CACHE_TTL_SECONDS = 45;
const GENERATION_KEY = 'search:gen';

type SearchInput = {
  query?: string | null;
  city?: string | null;
  lat?: number | null;
  lng?: number | null;
  radiusKm?: number | null;
  sort?: string | null;
};

type Cacheable = {
  name: string;
  distanceKm: number | null;
  averageRating: number | null;
  reviewCount: number;
  minPrice: number | null;
  isFeatured: boolean;
  /** Posições das unidades do resultado (fora do GraphQL) */
  points?: number[][];
};

/** Posição arredondada (2 casas, ~1 km) pra quem está perto dividir a chave */
const roundCoord = (v: number) => Math.round(v * 100) / 100;

/**
 * Chave do cache: a busca normalizada (textos sem caixa nem espaço nas
 * pontas, chaves em ordem) com a posição arredondada. Devolve também a
 * busca que vai pro banco (com a posição arredondada), pra lista em cache
 * não depender do ponto exato de quem pediu primeiro.
 */
export function searchCacheKey<T extends SearchInput>(
  kind: string,
  input: T,
): { key: string; rounded: T } {
  const rounded: T = {
    ...input,
    ...(input.lat != null && input.lng != null
      ? { lat: roundCoord(input.lat), lng: roundCoord(input.lng) }
      : {}),
  };
  const fields = rounded as unknown as Record<string, unknown>;
  const normalized = Object.keys(fields)
    .sort()
    .map((k) => {
      const v = fields[k];
      if (v === undefined || v === null || v === '') return null;
      return [k, typeof v === 'string' ? v.trim().toLowerCase() : v];
    })
    .filter((e) => e !== null);
  const hash = createHash('sha1').update(JSON.stringify(normalized)).digest('hex');
  return { key: `search:v1:${kind}:${hash}`, rounded };
}

/**
 * Lista em cache ajustada pra quem pediu: distância refeita com o ponto
 * exato, raio conferido de novo e a ordem refeita (relevância com ponto e
 * "mais perto" ordenam pela distância).
 */
export function repositionResults<T extends Cacheable>(items: T[], input: SearchInput): T[] {
  if (input.lat == null || input.lng == null) return items;
  const { lat, lng } = input;
  const radiusKm = clampRadius(input.radiusKm ?? undefined);
  const withDistance = items
    .map((r) => {
      const distances = (r.points ?? []).map(([pLat, pLng]) => haversineKm(lat, lng, pLat, pLng));
      return {
        ...r,
        distanceKm: distances.length ? Math.round(Math.min(...distances) * 10) / 10 : null,
      };
    })
    .filter((r) => r.distanceKm != null && r.distanceKm <= radiusKm);
  return rankResults(withDistance, (input.sort as SearchSort) ?? 'relevance', true);
}

/**
 * Cache curto da busca pública no Redis. A busca sem filtro e a da cidade
 * são a mesma lista para todo visitante e a tela mais cara (teste de carga:
 * 28 req/s, p95 863 ms). Com o Redis fora, vai direto ao banco.
 */
@Injectable()
export class SearchCacheService {
  private readonly logger = new Logger(SearchCacheService.name);

  constructor(private readonly redis: RedisService) {}

  async cached<I extends SearchInput, R extends Cacheable>(
    kind: string,
    input: I,
    compute: (input: I) => Promise<R[]>,
  ): Promise<R[]> {
    const { key: base, rounded } = searchCacheKey(kind, input);
    const key = `${base}:g${await this.generation()}`;
    let hit: R[] | null = null;
    try {
      hit = await this.redis.getJson<R[]>(key);
    } catch (err) {
      this.logger.warn(`Cache da busca indisponível: ${(err as Error).message}`);
    }
    if (hit) return repositionResults(hit, input);

    const fresh = await compute(rounded);
    this.redis.setJson(key, fresh, SEARCH_CACHE_TTL_SECONDS).catch((err: Error) => {
      this.logger.warn(`Cache da busca não gravado: ${err.message}`);
    });
    return repositionResults(fresh, input);
  }

  /** Mudou o Destaque: as listas em cache deixam de valer (sem apagar chave por chave) */
  async bump(): Promise<void> {
    try {
      await this.redis.client.incr(GENERATION_KEY);
    } catch (err) {
      this.logger.warn(`Cache da busca não renovado: ${(err as Error).message}`);
    }
  }

  private async generation(): Promise<string> {
    try {
      return (await this.redis.client.get(GENERATION_KEY)) ?? '0';
    } catch {
      return '0';
    }
  }
}
