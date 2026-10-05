/**
 * Backup do Postgres (sem Nest, pra testar sem subir nada): configuração,
 * nome do arquivo, o que já passou da guarda e quando o último está velho.
 */

export type BackupConfig = {
  enabled: boolean;
  bucket: string;
  prefix: string;
  retentionDays: number;
  /** Acima disso o último backup está atrasado (alerta e tela em vermelho) */
  maxAgeHours: number;
};

const positive = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function backupConfig(env: NodeJS.ProcessEnv): BackupConfig {
  return {
    enabled: env.BACKUP_ENABLED === 'true',
    bucket: env.BACKUP_S3_BUCKET?.trim() || env.S3_BUCKET?.trim() || '',
    prefix: (env.BACKUP_S3_PREFIX?.trim() || 'backups/postgres').replace(/^\/+|\/+$/g, ''),
    retentionDays: positive(env.BACKUP_RETENTION_DAYS, 30),
    maxAgeHours: positive(env.BACKUP_MAX_AGE_HOURS, 26),
  };
}

/** backups/postgres/2026/10/05/barbershop-2026-10-05T06-30-00Z.dump */
export function backupKey(prefix: string, at: Date): string {
  const iso = at
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/:/g, '-');
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${prefix}/${y}/${m}/${d}/barbershop-${iso}.dump`;
}

/**
 * URL do Prisma → variáveis do libpq (PGHOST, PGPASSWORD…) para o pg_dump:
 * a senha não fica nos argumentos do processo, e os parâmetros que só o
 * Prisma entende (`schema=public`, `connection_limit`…) ficam de fora
 */
export function pgEnv(databaseUrl: string): Record<string, string> {
  const url = new URL(databaseUrl);
  const env: Record<string, string> = {
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, '')),
  };
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode) env.PGSSLMODE = sslmode;
  const sslrootcert = url.searchParams.get('sslrootcert');
  if (sslrootcert) env.PGSSLROOTCERT = sslrootcert;
  return env;
}

export type StoredBackup = { key: string; at: Date; sizeBytes: number };

/** Os arquivos que já passaram da guarda (o mais novo nunca sai) */
export function expiredBackups(
  items: StoredBackup[],
  now: Date,
  retentionDays: number,
): StoredBackup[] {
  if (items.length <= 1) return [];
  const newest = items.reduce((a, b) => (b.at > a.at ? b : a));
  const limit = now.getTime() - retentionDays * 86_400_000;
  return items.filter((i) => i !== newest && i.at.getTime() < limit);
}

export type BackupStatus = {
  enabled: boolean;
  lastAt: Date | null;
  sizeBytes: number | null;
  ageHours: number | null;
  maxAgeHours: number;
  /** Último mais velho que o limite (ou nenhum, com o backup ligado há mais que o limite) */
  stale: boolean;
};

export function backupStatus(
  config: BackupConfig,
  newest: StoredBackup | null,
  now: Date,
  enabledSince: Date,
): BackupStatus {
  const ageHours = newest ? (now.getTime() - newest.at.getTime()) / 3_600_000 : null;
  const sinceHours = (now.getTime() - enabledSince.getTime()) / 3_600_000;
  return {
    enabled: config.enabled,
    lastAt: newest?.at ?? null,
    sizeBytes: newest?.sizeBytes ?? null,
    ageHours: ageHours == null ? null : Math.round(ageHours * 10) / 10,
    maxAgeHours: config.maxAgeHours,
    stale:
      config.enabled &&
      (ageHours != null ? ageHours > config.maxAgeHours : sinceHours > config.maxAgeHours),
  };
}
