import { backupConfig, backupKey, backupStatus, expiredBackups, pgEnv } from './backup';

describe('backup do Postgres (regras)', () => {
  it('configuração com padrões e o bucket das fotos como reserva', () => {
    expect(backupConfig({ S3_BUCKET: 'fotos' })).toEqual({
      enabled: false,
      bucket: 'fotos',
      prefix: 'backups/postgres',
      retentionDays: 30,
      maxAgeHours: 26,
    });
    expect(
      backupConfig({
        BACKUP_ENABLED: 'true',
        BACKUP_S3_BUCKET: 'backups',
        S3_BUCKET: 'fotos',
        BACKUP_S3_PREFIX: '/pg/',
        BACKUP_RETENTION_DAYS: '14',
        BACKUP_MAX_AGE_HOURS: 'abc',
      }),
    ).toMatchObject({
      enabled: true,
      bucket: 'backups',
      prefix: 'pg',
      retentionDays: 14,
      maxAgeHours: 26,
    });
  });

  it('nome do arquivo por data e conexão do libpq sem os parâmetros do Prisma', () => {
    expect(backupKey('backups/postgres', new Date('2026-10-05T06:30:00.123Z'))).toBe(
      'backups/postgres/2026/10/05/barbershop-2026-10-05T06-30-00Z.dump',
    );
    expect(
      pgEnv(
        'postgresql://app:s%40nha@db.example.com:6543/barbershop?schema=public&sslmode=require&connection_limit=5',
      ),
    ).toEqual({
      PGHOST: 'db.example.com',
      PGPORT: '6543',
      PGUSER: 'app',
      PGPASSWORD: 's@nha',
      PGDATABASE: 'barbershop',
      PGSSLMODE: 'require',
    });
  });

  it('guarda: apaga o que passou do prazo, mas nunca o mais novo', () => {
    const now = new Date('2026-10-05T12:00:00Z');
    const day = (n: number) => ({
      key: `k${n}`,
      at: new Date(now.getTime() - n * 86_400_000),
      sizeBytes: 1,
    });
    expect(expiredBackups([day(1), day(29), day(31), day(40)], now, 30).map((b) => b.key)).toEqual([
      'k31',
      'k40',
    ]);
    // Só sobrou backup velho (o job parou): o último fica
    expect(expiredBackups([day(40), day(45)], now, 30).map((b) => b.key)).toEqual(['k45']);
  });

  it('atrasado: último mais velho que o limite, ou nenhum depois do limite ligado', () => {
    const config = backupConfig({ BACKUP_ENABLED: 'true', S3_BUCKET: 'b' });
    const now = new Date('2026-10-05T12:00:00Z');
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
    const backup = (h: number) => ({ key: 'k', at: hoursAgo(h), sizeBytes: 10 });
    expect(backupStatus(config, backup(5), now, hoursAgo(100))).toMatchObject({
      ageHours: 5,
      stale: false,
    });
    expect(backupStatus(config, backup(30), now, hoursAgo(100))).toMatchObject({ stale: true });
    expect(backupStatus(config, null, now, hoursAgo(2)).stale).toBe(false);
    expect(backupStatus(config, null, now, hoursAgo(27)).stale).toBe(true);
    expect(backupStatus({ ...config, enabled: false }, null, now, hoursAgo(99)).stale).toBe(false);
  });
});
