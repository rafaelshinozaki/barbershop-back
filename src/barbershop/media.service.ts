import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../aws/s3.service';
import { BarbershopService } from './barbershop.service';

/** Fotos na galeria da página pública */
export const MAX_GALLERY_PHOTOS = 30;
const MAX_CAPTION = 140;

/**
 * Fotos da página pública (como a galeria do Booksy): capa larga, galeria
 * de trabalhos/ambiente e a foto de cada profissional. O navegador envia
 * direto pro S3 (formulário pré-assinado, com limite de tamanho) e depois
 * confirma aqui a chave — que tem de ser da própria unidade/profissional,
 * senão dava pra "apontar" pra foto de outra unidade.
 */
@Injectable()
export class BarbershopMediaService {
  private readonly logger = new Logger(BarbershopMediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly barbershopService: BarbershopService,
  ) {}

  private galleryPrefix(barbershopId: number) {
    return `barbershops/${barbershopId}/gallery/`;
  }
  private coverPrefix(barbershopId: number) {
    return `barbershops/${barbershopId}/cover-`;
  }
  private avatarPrefix(barbershopId: number, barberId: number) {
    return `barbershops/${barbershopId}/barbers/${barberId}/avatar-`;
  }

  private ensureKey(key: string, prefix: string) {
    if (!key.startsWith(prefix) || key.includes('..')) {
      throw new BadRequestException('Arquivo inválido');
    }
  }

  /** Apaga o arquivo antigo sem travar a resposta (S3 fora não impede nada) */
  private discard(key: string | null | undefined) {
    if (!key) return;
    this.s3
      .deleteObject(key)
      .catch((err) => this.logger.warn(`Não apagou ${key} do S3: ${String(err)}`));
  }

  // ---- galeria ----

  async listPhotos(userId: number, barbershopId: number) {
    await this.barbershopService.ensureAccess(userId, barbershopId, 'manager');
    return this.photosWithUrls(barbershopId);
  }

  async photosWithUrls(barbershopId: number, take = MAX_GALLERY_PHOTOS) {
    const photos = await this.prisma.barbershopPhoto.findMany({
      where: { barbershopId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      take,
    });
    return Promise.all(
      photos.map(async (p) => ({ ...p, url: await this.s3.getDownloadUrl(p.key) })),
    );
  }

  async galleryUpload(userId: number, barbershopId: number, contentType?: string) {
    await this.barbershopService.ensureAccess(userId, barbershopId, 'manager');
    const count = await this.prisma.barbershopPhoto.count({ where: { barbershopId } });
    if (count >= MAX_GALLERY_PHOTOS) {
      throw new BadRequestException(`A galeria tem no máximo ${MAX_GALLERY_PHOTOS} fotos`);
    }
    return this.s3.createImageUpload(
      `${this.galleryPrefix(barbershopId)}${randomUUID()}`,
      contentType,
    );
  }

  async addPhoto(userId: number, barbershopId: number, key: string, caption?: string | null) {
    await this.barbershopService.ensureAccess(userId, barbershopId, 'manager');
    this.ensureKey(key, this.galleryPrefix(barbershopId));
    const text = caption?.trim() || null;
    if (text && text.length > MAX_CAPTION) {
      throw new BadRequestException(`Legenda com no máximo ${MAX_CAPTION} caracteres`);
    }
    const [count, last] = await Promise.all([
      this.prisma.barbershopPhoto.count({ where: { barbershopId } }),
      this.prisma.barbershopPhoto.findFirst({
        where: { barbershopId },
        orderBy: { position: 'desc' },
        select: { position: true },
      }),
    ]);
    if (count >= MAX_GALLERY_PHOTOS) {
      throw new BadRequestException(`A galeria tem no máximo ${MAX_GALLERY_PHOTOS} fotos`);
    }
    const photo = await this.prisma.barbershopPhoto.create({
      data: { barbershopId, key, caption: text, position: (last?.position ?? -1) + 1 },
    });
    return { ...photo, url: await this.s3.getDownloadUrl(photo.key) };
  }

  async removePhoto(userId: number, barbershopId: number, photoId: number) {
    await this.barbershopService.ensureAccess(userId, barbershopId, 'manager');
    const photo = await this.prisma.barbershopPhoto.findFirst({
      where: { id: photoId, barbershopId },
    });
    if (!photo) throw new NotFoundException('Foto não encontrada');
    await this.prisma.barbershopPhoto.delete({ where: { id: photoId } });
    this.discard(photo.key);
    return true;
  }

  /** Nova ordem da galeria (ids na ordem desejada; os que faltarem vão pro fim) */
  async reorderPhotos(userId: number, barbershopId: number, ids: number[]) {
    await this.barbershopService.ensureAccess(userId, barbershopId, 'manager');
    const photos = await this.prisma.barbershopPhoto.findMany({
      where: { barbershopId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    const known = new Set(photos.map((p) => p.id));
    const order = [
      ...ids.filter((id) => known.has(id)),
      ...photos.map((p) => p.id).filter((id) => !ids.includes(id)),
    ];
    await this.prisma.$transaction(
      order.map((id, position) =>
        this.prisma.barbershopPhoto.update({ where: { id }, data: { position } }),
      ),
    );
    return this.photosWithUrls(barbershopId);
  }

  // ---- capa ----

  async coverUpload(userId: number, barbershopId: number, contentType?: string) {
    await this.barbershopService.ensureAccess(userId, barbershopId, 'manager');
    return this.s3.createImageUpload(
      `${this.coverPrefix(barbershopId)}${randomUUID()}`,
      contentType,
    );
  }

  /** Confirma a capa enviada (ou null pra tirar); devolve o link da nova capa */
  async setCover(userId: number, barbershopId: number, key: string | null) {
    await this.barbershopService.ensureAccess(userId, barbershopId, 'manager');
    if (key) this.ensureKey(key, this.coverPrefix(barbershopId));
    const shop = await this.prisma.barbershop.findUnique({
      where: { id: barbershopId },
      select: { coverKey: true },
    });
    await this.prisma.barbershop.update({ where: { id: barbershopId }, data: { coverKey: key } });
    if (shop?.coverKey && shop.coverKey !== key) this.discard(shop.coverKey);
    return key ? this.s3.getDownloadUrl(key) : null;
  }

  // ---- foto do profissional ----

  private async barberOf(userId: number, barberId: number) {
    const barber = await this.prisma.barber.findUnique({
      where: { id: barberId },
      select: { id: true, barbershopId: true, avatarKey: true },
    });
    if (!barber) throw new NotFoundException('Profissional não encontrado');
    // Gerente e dono de qualquer um; o próprio barbeiro, a dele
    await this.barbershopService.ensureCanManageBarberSchedule(
      userId,
      barber.barbershopId,
      barber.id,
    );
    return barber;
  }

  async avatarUpload(userId: number, barberId: number, contentType?: string) {
    const barber = await this.barberOf(userId, barberId);
    return this.s3.createImageUpload(
      `${this.avatarPrefix(barber.barbershopId, barber.id)}${randomUUID()}`,
      contentType,
    );
  }

  async setAvatar(userId: number, barberId: number, key: string | null) {
    const barber = await this.barberOf(userId, barberId);
    if (key) this.ensureKey(key, this.avatarPrefix(barber.barbershopId, barber.id));
    await this.prisma.barber.update({
      where: { id: barber.id },
      // Tirar a foto enviada também limpa o link antigo digitado à mão
      data: key ? { avatarKey: key } : { avatarKey: null, avatarUrl: null },
    });
    if (barber.avatarKey && barber.avatarKey !== key) this.discard(barber.avatarKey);
    return key ? this.s3.getDownloadUrl(key) : null;
  }
}
