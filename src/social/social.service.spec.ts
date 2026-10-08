import { BadRequestException } from '@nestjs/common';
import { SocialService } from './social.service';

describe('SocialService.handleOAuthCallback', () => {
  const json = (body: unknown) => ({ json: async () => body });

  function build(ensureAccess: () => Promise<unknown>) {
    const upsert = jest.fn();
    const createChoice = jest.fn(async ({ data }: { data: { token: string; userToken: string } }) => data);
    const prisma = {
      socialConnection: { upsert },
      socialPageChoice: { deleteMany: jest.fn(), create: createChoice },
    };
    const service = new SocialService(
      prisma as never,
      { get: (key: string) => (key === 'JWT_SECRET' ? 'jwt-test' : undefined) } as never,
      { verify: () => ({ barbershopId: 4, userId: 9 }) } as never,
      {} as never,
      { ensureAccess } as never,
    );
    return { service, upsert, createChoice };
  }

  afterEach(() => jest.restoreAllMocks());

  it('não troca o código se a pessoa já não administra a unidade', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const { service, upsert } = build(async () => {
      throw new Error('forbidden');
    });
    const result = await service.handleOAuthCallback('code', 'state');
    expect(result.barbershopId).toBe(4);
    expect(result.error).toBeTruthy();
    expect(result.pick).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('com várias Páginas não grava a primeira', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('grant_type')) return json({ access_token: 'long' }) as never;
      if (url.includes('/oauth/access_token')) return json({ access_token: 'short' }) as never;
      return json({
        data: [
          { id: 'p1', name: 'Uma', access_token: 't1' },
          { id: 'p2', name: 'Outra', access_token: 't2' },
        ],
      }) as never;
    });
    const { service, upsert, createChoice } = build(async () => ({}));
    const result = await service.handleOAuthCallback('code', 'state');
    expect(result.pick).toEqual(expect.any(String));
    expect(result.error).toBeUndefined();
    expect(upsert).not.toHaveBeenCalled();
    const stored = createChoice.mock.calls[0][0].data.userToken;
    expect(stored.startsWith('enc:v1:')).toBe(true);
    expect(stored).not.toContain('long');
  });

  it('com uma Página conecta essa', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('grant_type')) return json({ access_token: 'long' }) as never;
      if (url.includes('/oauth/access_token')) return json({ access_token: 'short' }) as never;
      if (url.includes('/me/accounts')) {
        return json({ data: [{ id: 'p1', name: 'Só essa', access_token: 't1' }] }) as never;
      }
      return json({ instagram_business_account: { id: 'ig', username: 'loja' } }) as never;
    });
    const { service, upsert } = build(async () => ({}));
    const result = await service.handleOAuthCallback('code', 'state');
    expect(result).toEqual({ barbershopId: 4 });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ facebookPageId: 'p1', facebookPageName: 'Só essa' }),
      }),
    );
  });
});

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
