/**
 * Backup contra o Postgres de verdade: o pg_dump gera o arquivo, ele vai
 * para o "S3" (em memória), o status mostra o último, os vencidos saem, e o
 * arquivo volta com pg_restore num banco novo com os mesmos dados.
 */
import 'dotenv/config';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Readable } from 'stream';
import { BackupService } from './backup.service';
import { pgEnv } from './backup';

type Stored = { body: Buffer; at: Date };

function fakeS3(store: Map<string, Stored>, clock: () => Date) {
  return {
    async send(cmd: unknown) {
      if (cmd instanceof PutObjectCommand) {
        const chunks: Buffer[] = [];
        for await (const c of cmd.input.Body as Readable) chunks.push(Buffer.from(c));
        store.set(cmd.input.Key!, { body: Buffer.concat(chunks), at: clock() });
        return {};
      }
      if (cmd instanceof ListObjectsV2Command) {
        return {
          Contents: [...store.entries()]
            .filter(([k]) => k.startsWith(cmd.input.Prefix ?? ''))
            .map(([Key, v]) => ({ Key, LastModified: v.at, Size: v.body.length })),
          IsTruncated: false,
        };
      }
      if (cmd instanceof DeleteObjectsCommand) {
        for (const o of cmd.input.Delete?.Objects ?? []) store.delete(o.Key!);
        return {};
      }
      throw new Error('comando não esperado');
    },
  } as unknown as S3Client;
}

describe('Backup do Postgres (integração)', () => {
  const env = { ...process.env };
  const restoreDb = `barbershop_restore_${Date.now()}`;
  const store = new Map<string, Stored>();
  let now = new Date('2026-10-05T06:30:00Z');

  beforeAll(() => {
    process.env.BACKUP_ENABLED = 'true';
    process.env.BACKUP_S3_BUCKET = 'backups-test';
    process.env.BACKUP_RETENTION_DAYS = '30';
  });

  afterAll(() => {
    process.env = env;
    const pg = pgEnv(process.env.DATABASE_URL!);
    execFileSync('dropdb', ['--if-exists', restoreDb], { env: { ...process.env, ...pg } });
  });

  it('faz o backup, mostra no status, apaga os vencidos e o arquivo volta com pg_restore', async () => {
    const backups = new BackupService();
    backups.s3 = fakeS3(store, () => now);
    // Um backup antigo, de antes da guarda, para sair
    store.set('backups/postgres/2026/08/01/barbershop-2026-08-01T06-30-00Z.dump', {
      body: Buffer.from('velho'),
      at: new Date('2026-08-01T06:30:00Z'),
    });

    const done = await backups.run(now);
    expect(done.key).toBe('backups/postgres/2026/10/05/barbershop-2026-10-05T06-30-00Z.dump');
    expect(done.sizeBytes).toBeGreaterThan(1000);
    expect([...store.keys()]).toEqual([done.key]);

    now = new Date('2026-10-05T10:30:00Z');
    expect(await backups.status(now)).toMatchObject({
      enabled: true,
      lastAt: new Date('2026-10-05T06:30:00Z'),
      sizeBytes: done.sizeBytes,
      ageHours: 4,
      stale: false,
    });

    // Restaura num banco novo e confere uma tabela
    const pg = { ...process.env, ...pgEnv(process.env.DATABASE_URL!) };
    const dir = mkdtempSync(join(tmpdir(), 'restore-'));
    try {
      const file = join(dir, 'b.dump');
      writeFileSync(file, store.get(done.key)!.body);
      execFileSync('createdb', [restoreDb], { env: pg });
      execFileSync('pg_restore', ['--no-owner', '--dbname', restoreDb, file], { env: pg });
      const count = (db: string) =>
        execFileSync('psql', ['-Atc', 'SELECT count(*) FROM "_prisma_migrations"', db], {
          env: pg,
        })
          .toString()
          .trim();
      expect(count(restoreDb)).toBe(count(pg.PGDATABASE ?? ''));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('desligado: status sem backup e sem atraso', async () => {
    process.env.BACKUP_ENABLED = 'false';
    const off = new BackupService();
    expect(await off.status()).toMatchObject({ enabled: false, lastAt: null, stale: false });
    process.env.BACKUP_ENABLED = 'true';
  });
});
