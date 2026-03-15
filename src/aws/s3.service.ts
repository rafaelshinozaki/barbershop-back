import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SmartLogger } from '../common/logger.util';

@Injectable()
export class S3Service {
  private client: S3Client;
  private bucket: string;
  private readonly logger = new Logger(S3Service.name);
  private readonly smartLogger = new SmartLogger('S3Service');

  constructor(private config: ConfigService) {
    this.client = new S3Client({
      region: this.config.get<string>('AWS_REGION'),
      credentials: {
        accessKeyId: this.config.get<string>('AWS_ACCESS_KEY_ID')!,
        secretAccessKey: this.config.get<string>('AWS_SECRET_ACCESS_KEY')!,
      },
    });
    this.bucket = this.config.get<string>('S3_BUCKET');
    this.smartLogger.log(`S3Service initialized with bucket: ${this.bucket}`);
  }

  async getUploadUrl(key: string, contentType?: string): Promise<string> {
    // Validações de segurança
    const allowedContentTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

    if (contentType && !allowedContentTypes.includes(contentType)) {
      throw new BadRequestException('Invalid content type. Only images are allowed.');
    }

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType || 'image/jpeg',
    });
    return await getSignedUrl(this.client, command, { expiresIn: 3600 });
  }

  async getDownloadUrl(key: string): Promise<string> {
    this.smartLogger.log(`Generating download URL for key: ${key}`);
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    const url = await getSignedUrl(this.client, command, { expiresIn: 3600 });
    this.smartLogger.log(`Generated download URL for key: ${key}`);
    return url;
  }
}
