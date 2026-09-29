import { BadRequestException } from '@nestjs/common';
import { SocialService } from './social.service';

/**
 * Post agendado: a imagem tem de ser uma enviada pra esta unidade. A
 * listagem assina um link de download pra chave do post; sem a checagem,
 * dava pra apontar pra qualquer arquivo do bucket.
 */
describe('SocialService.createPost: chave da imagem', () => {
  const created: unknown[] = [];
  const service = new SocialService(
    {
      socialConnection: {
        findUnique: async () => ({ instagramBusinessAccountId: 'ig' }),
      },
      socialPost: {
        create: async ({ data }: { data: unknown }) => {
          created.push(data);
          return data;
        },
      },
    } as never,
    { get: () => undefined } as never,
    {} as never,
    {} as never,
    { ensureAccess: async () => ({}) } as never,
  );
  const post = (imageKey: string) =>
    service.createPost(1, 7, {
      caption: 'Oi',
      imageKey,
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
      postToFacebook: true,
      postToInstagram: false,
    });

  it('recusa arquivo de fora da pasta da unidade', async () => {
    for (const key of [
      'users/1/foto.jpg',
      'social-posts/8/outra-unidade.jpg',
      'social-posts/7/../../users/1/foto.jpg',
      '',
    ]) {
      await expect(post(key)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(created).toHaveLength(0);
  });

  it('aceita a imagem enviada pra esta unidade', async () => {
    await expect(post('social-posts/7/123-abc.jpg')).resolves.toMatchObject({
      imageKey: 'social-posts/7/123-abc.jpg',
    });
  });
});
