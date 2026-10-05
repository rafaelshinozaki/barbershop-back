import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { spawn } from 'child_process';
import { createReadStream } from 'fs';
import { mkdtemp, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { BACKUP_QUEUE } from '../queue/queue.constants';
import { registerSchedulers } from '../queue/register-schedulers';
import {
  backupConfig,
  backupKey,
  backupStatus,
  expiredBackups,
  pgEnv,
  type BackupStatus,
  type StoredBackup,
} from './backup';

/** O status lê o S3; a tela e as métricas pedem a cada minuto */
const STATUS_CACHE_MS = 10 * 60_000;

function s3Client(env: NodeJS.ProcessEnv): S3Client {
  const endpoint = env.S3_ENDPOINT || undefined;
  return new S3Client({
    endpoint,
    forcePathStyle: !!endpoint,
    region: env.AWS_REGION,
    credentials:
      env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
        ? { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY }
        : undefined,
  });
}

/**
 * Backup diário do Postgres (horizonte "Registros e estabilidade"): pg_dump
 * no formato do pg_restore, enviado para um bucket S3 privado. É a segunda
 * cópia, fora do provedor do banco (que tem os backups dele); protege contra
 * perder a conta do provedor, apagar o banco por engano ou uma migração
 * ruim. Só roda com BACKUP_ENABLED=true. Guarda BACKUP_RETENTION_DAYS dias.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  readonly config = backupConfig(process.env);
  /** Trocado nos testes */
  s3: S3Client = s3Client(process.env);
  private readonly enabledSince = new Date();
  private cached: { at: number; status: BackupStatus } | null = null;

  /** Faz o backup agora: pg_dump → arquivo temporário → S3; depois apaga os vencidos */
  async run(now = new Date()): Promise<StoredBackup> {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL não configurada');
    if (!this.config.bucket)
      throw new Error('Sem bucket para o backup (BACKUP_S3_BUCKET ou S3_BUCKET)');

    const dir = await mkdtemp(join(tmpdir(), 'pg-backup-'));
    const file = join(dir, 'backup.dump');
    const started = Date.now();
    try {
      await this.dump(pgEnv(databaseUrl), file);
      const { size } = await stat(file);
      const key = backupKey(this.config.prefix, now);
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          Body: createReadStream(file),
          ContentLength: size,
          ContentType: 'application/octet-stream',
          // Criptografado no S3 da AWS; S3 compatível local (MinIO) não tem
          ...(process.env.S3_ENDPOINT ? {} : { ServerSideEncryption: 'AES256' as const }),
        }),
      );
      this.logger.log(
        `Backup enviado: s3://${this.config.bucket}/${key} (${(size / 1048576).toFixed(
          1,
        )} MB em ${Math.round((Date.now() - started) / 1000)} s)`,
      );
      this.cached = null;
      await this.prune(now);
      return { key, at: now, sizeBytes: size };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private dump(pg: Record<string, string>, file: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        'pg_dump',
        ['--format=custom', '--no-owner', '--no-privileges', '--file', file],
        { env: { ...process.env, ...pg }, stdio: ['ignore', 'ignore', 'pipe'] },
      );
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-2000);
      });
      child.on('error', (err) =>
        reject(
          new Error(`pg_dump não pôde rodar (${err.message}); a imagem tem o postgresql-client?`),
        ),
      );
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`pg_dump saiu com ${code}: ${stderr.trim()}`)),
      );
    });
  }

  /** Todos os backups guardados (ordem do S3) */
  async list(): Promise<StoredBackup[]> {
    const items: StoredBackup[] = [];
    let token: string | undefined;
    do {
      const page = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: `${this.config.prefix}/`,
          ContinuationToken: token,
        }),
      );
      for (const o of page.Contents ?? []) {
        if (o.Key && o.LastModified && o.Key.endsWith('.dump')) {
          items.push({ key: o.Key, at: o.LastModified, sizeBytes: o.Size ?? 0 });
        }
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return items;
  }

  private async prune(now: Date) {
    const expired = expiredBackups(await this.list(), now, this.config.retentionDays);
    if (!expired.length) return;
    await this.s3.send(
      new DeleteObjectsCommand({
        Bucket: this.config.bucket,
        Delete: { Objects: expired.map((e) => ({ Key: e.key })), Quiet: true },
      }),
    );
    this.logger.log(
      `${expired.length} backup(s) com mais de ${this.config.retentionDays} dias apagados`,
    );
  }

  /** Último backup, para a tela Saúde do sistema e o alerta (lê o S3 no máximo a cada 10 min) */
  async status(now = new Date()): Promise<BackupStatus> {
    if (!this.config.enabled || !this.config.bucket) {
      return backupStatus(this.config, null, now, now);
    }
    if (this.cached && now.getTime() - this.cached.at < STATUS_CACHE_MS) {
      return backupStatus(
        this.config,
        this.cached.status.lastAt
          ? { key: '', at: this.cached.status.lastAt, sizeBytes: this.cached.status.sizeBytes ?? 0 }
          : null,
        now,
        this.enabledSince,
      );
    }
    const items = await this.list();
    const newest = items.length ? items.reduce((a, b) => (b.at > a.at ? b : a)) : null;
    const status = backupStatus(this.config, newest, now, this.enabledSince);
    this.cached = { at: now.getTime(), status };
    return status;
  }
}

@Injectable()
export class BackupScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(BACKUP_QUEUE) private readonly queue: Queue,
    private readonly backups: BackupService,
  ) {}

  onModuleInit() {
    if (!this.backups.config.enabled) return;
    // De madrugada, depois da guarda dos dados (03:15)
    registerSchedulers(this.queue, [
      { id: 'pg-backup', repeat: { pattern: '0 30 3 * * *', tz: 'America/Sao_Paulo' } },
    ]);
  }

  /** "Fazer backup agora" (admin) */
  async enqueueNow() {
    await this.queue.add('pg-backup', {}, { attempts: 1, removeOnComplete: { count: 50 } });
  }
}

@Processor(BACKUP_QUEUE)
export class BackupProcessor extends WorkerHost {
  constructor(private readonly backups: BackupService) {
    super();
  }

  async process(job: Job) {
    if (job.name === 'pg-backup') return this.backups.run();
  }
}
