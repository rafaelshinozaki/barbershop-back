import type { RedisOptions } from 'ioredis';

/**
 * REDIS_URL (redis://[:senha@]host:porta[/db] ou rediss:// com TLS) em
 * opções do ioredis — o BullMQ recebe host/porta, não URL.
 */
export function redisOptionsFromUrl(url: string): RedisOptions {
  const u = new URL(url);
  const db = u.pathname && u.pathname !== '/' ? Number(u.pathname.slice(1)) : undefined;
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: Number.isFinite(db) ? db : undefined,
    tls: u.protocol === 'rediss:' ? {} : undefined,
  };
}

export const redisUrl = (value?: string) => value || 'redis://localhost:6379';
