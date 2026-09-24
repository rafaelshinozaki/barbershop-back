import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { SmartLogger } from '../common/logger.util';

/** Tamanho máximo de imagem enviada pro S3 (fotos, logo, post). */
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
/** Validade do formulário de upload — só o tempo de o navegador enviar. */
const UPLOAD_EXPIRES_SECONDS = 10 * 60;

// Tipo aceito → extensão do arquivo salvo (a extensão não vem mais do cliente)
const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** Envio direto do navegador pro S3: POST multipart pra `url` com `fields` + o arquivo por último. */
export interface PresignedUpload {
  url: string;
  fields: { name: string; value: string }[];
  /** Chave final do arquivo no bucket (com extensão) */
  key: string;
}

@Injectable()
export class S3Service {
  private client: S3Client;
  private bucket: string;
  private readonly logger = new Logger(S3Service.name);
  private readonly smartLogger = new SmartLogger('S3Service');

  constructor(private config: ConfigService) {
    // S3 compatível local (MinIO, moto) — opcional; vazio usa a AWS
    const endpoint = this.config.get<string>('S3_ENDPOINT') || undefined;
    this.client = new S3Client({
      endpoint,
      forcePathStyle: !!endpoint,
      region: this.config.get<string>('AWS_REGION'),
      credentials: {
        accessKeyId: this.config.get<string>('AWS_ACCESS_KEY_ID')!,
        secretAccessKey: this.config.get<string>('AWS_SECRET_ACCESS_KEY')!,
      },
    });
    this.bucket = this.config.get<string>('S3_BUCKET');
    this.smartLogger.log(`S3Service initialized with bucket: ${this.bucket}`);
  }

  /**
   * Formulário pré-assinado (POST) pro navegador enviar uma imagem direto
   * pro S3. A política assinada limita o tamanho (content-length-range) e
   * fixa o tipo — o antigo link PUT não limitava tamanho nenhum (dava pra
   * subir GBs com o link, que valia 1 hora) e a extensão vinha do cliente.
   *
   * @param keyWithoutExtension ex.: `barbershops/3/photo` — a extensão sai do tipo
   */
  async createImageUpload(
    keyWithoutExtension: string,
    contentType = 'image/jpeg',
    maxBytes = UPLOAD_MAX_BYTES,
  ): Promise<PresignedUpload> {
    const type = contentType.toLowerCase();
    const extension = IMAGE_TYPES[type];
    if (!extension) {
      throw new BadRequestException(
        'Tipo de arquivo inválido. Envie uma imagem JPG, PNG, WebP ou GIF.',
      );
    }
    const normalizedType = type === 'image/jpg' ? 'image/jpeg' : type;
    const key = `${keyWithoutExtension}.${extension}`;
    const { url, fields } = await createPresignedPost(this.client, {
      Bucket: this.bucket,
      Key: key,
      Conditions: [
        ['content-length-range', 1, maxBytes],
        ['eq', '$Content-Type', normalizedType],
      ],
      Fields: { 'Content-Type': normalizedType },
      Expires: UPLOAD_EXPIRES_SECONDS,
    });
    return {
      url,
      fields: Object.entries(fields).map(([name, value]) => ({ name, value })),
      key,
    };
  }

  /** Apaga o arquivo (ex.: foto de perfil na exclusão de conta). */
  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async getDownloadUrl(key: string): Promise<string> {
    this.smartLogger.log(`Generating download URL for key: ${key}`);
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    const url = await getSignedUrl(this.client, command, { expiresIn: 3600 });
    this.smartLogger.log(`Generated download URL for key: ${key}`);
    return url;
  }
}
