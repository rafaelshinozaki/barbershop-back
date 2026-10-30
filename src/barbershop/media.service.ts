import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../aws/s3.service';
import { BarbershopService } from './barbershop.service';

/** Fotos na galeria da página pública */
export const MAX_GALLERY_PHOTOS = 30;
const MAX_CAPTION = 140;
export const PHOTO_KEY_USED_MESSAGE = 'Essa foto já foi enviada. Envie o arquivo de novo.';

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
      photos.map(async (p) => ({
        ...p,
        hidden: p.hiddenAt != null,
        url: await this.s3.getDownloadUrl(p.key),
      })),
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
    // Cada envio tem uma chave nova: confirmar de novo a de uma foto que existe
    // (inclusive a ocultada pela moderação) traria a foto de volta à galeria
    if (await this.prisma.barbershopPhoto.findFirst({ where: { barbershopId, key } })) {
      throw new BadRequestException(PHOTO_KEY_USED_MESSAGE);
    }
    const photo = await this.prisma.barbershopPhoto
      .create({
        data: { barbershopId, key, caption: text, position: (last?.position ?? -1) + 1 },
      })
      .catch((err: unknown) => {
        if ((err as { code?: string }).code === 'P2002') {
          throw new BadRequestException(PHOTO_KEY_USED_MESSAGE);
        }
        throw err;
      });
    return { ...photo, hidden: false, url: await this.s3.getDownloadUrl(photo.key) };
  }

  async removePhoto(userId: number, barbershopId: number, photoId: number) {
    await this.barbershopService.ensureAccess(userId, barbershopId, 'manager');
    const photo = await this.prisma.barbershopPhoto.findFirst({
      where: { id: photoId, barbershopId },
    });
    if (!photo) throw new NotFoundException('Foto não encontrada');
    await this.prisma.barbershopPhoto.delete({ where: { id: photoId } });
    if (photo.hiddenAt) {
      // A ocultada pela moderação sai do S3 antes de responder: confirmar a
      // chave de novo não pode trazer o arquivo de volta
      await this.s3
        .deleteObject(photo.key)
        .catch((err) =>
          this.logger.error(`Não apagou a foto ocultada ${photo.key}: ${String(err)}`),
        );
    } else {
      this.discard(photo.key);
    }
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
      select: { coverKey: true, coverHiddenAt: true, hiddenCoverKeys: true },
    });
    const hidden = shop?.hiddenCoverKeys ?? [];
    if (key && (hidden.includes(key) || (shop?.coverHiddenAt && key === shop.coverKey))) {
      throw new BadRequestException(PHOTO_KEY_USED_MESSAGE);
    }
    const retired =
      shop?.coverHiddenAt && shop.coverKey && shop.coverKey !== key ? shop.coverKey : null;
    if (retired) {
      await this.s3
        .deleteObject(retired)
        .catch((err) => this.logger.error(`Não apagou a capa ocultada ${retired}: ${String(err)}`));
    }
    await this.prisma.barbershop.update({
      where: { id: barbershopId },
      data: {
        coverKey: key,
        ...(key !== shop?.coverKey ? { coverHiddenAt: null } : {}),
        ...(retired && !hidden.includes(retired) ? { hiddenCoverKeys: { push: retired } } : {}),
      },
    });
    if (shop?.coverKey && shop.coverKey !== key && !retired) this.discard(shop.coverKey);
    return key ? this.s3.getDownloadUrl(key) : null;
  }

  // ---- foto do profissional ----

  private async barberOf(userId: number, barberId: number) {
    const barber = await this.prisma.barber.findUnique({
      where: { id: barberId },
      select: { id: true, barbershopId: true, avatarKey: true, avatarHiddenAt: true, hiddenAvatarKeys: true },
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
    const hidden = barber.hiddenAvatarKeys ?? [];
    if (key && (hidden.includes(key) || (barber.avatarHiddenAt && key === barber.avatarKey))) {
      throw new BadRequestException(PHOTO_KEY_USED_MESSAGE);
    }
    const retired =
      barber.avatarHiddenAt && barber.avatarKey && barber.avatarKey !== key ? barber.avatarKey : null;
    if (retired) {
      await this.s3
        .deleteObject(retired)
        .catch((err) =>
          this.logger.error(`Não apagou a foto ocultada ${retired}: ${String(err)}`),
        );
    }
    await this.prisma.barber.update({
      where: { id: barber.id },
      data: {
        ...(key ? { avatarKey: key } : { avatarKey: null, avatarUrl: null }),
        ...(key !== barber.avatarKey ? { avatarHiddenAt: null } : {}),
        ...(retired && !hidden.includes(retired) ? { hiddenAvatarKeys: { push: retired } } : {}),
      },
    });
    if (barber.avatarKey && barber.avatarKey !== key && !retired) this.discard(barber.avatarKey);
    return key ? this.s3.getDownloadUrl(key) : null;
  }
}
