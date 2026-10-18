import { BadRequestException } from '@nestjs/common';
import { SocialService } from './social.service';

describe('SocialService.handleOAuthCallback', () => {
  const json = (body: unknown) => ({ json: async () => body });

  function build(ensureAccess: () => Promise<unknown>) {
    const upsert = jest.fn();
    const createChoice = jest.fn(
      async ({ data }: { data: { token: string; userToken: string } }) => data,
    );
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

describe('SocialService: chave do token da Página', () => {
  const { sealSecret, openSecret } = jest.requireActual('../common/secret-box');

  function build(env: Record<string, string | undefined>, stored: string) {
    const updateConnection = jest.fn(async () => undefined);
    const updatePost = jest.fn(async () => undefined);
    const prisma = {
      socialPost: {
        findUnique: async () => ({
          id: 1,
          status: 'SCHEDULED',
          barbershopId: 4,
          imageKey: 'social-posts/4/x.jpg',
          caption: 'oi',
          postToFacebook: true,
          postToInstagram: false,
        }),
        update: updatePost,
      },
      barbershop: { findUnique: async () => ({ closedAt: null }) },
      socialConnection: {
        findUnique: async () => ({ id: 7, facebookPageId: 'p1', facebookAccessToken: stored }),
        update: updateConnection,
      },
    };
    const service = new SocialService(
      prisma as never,
      { get: (key: string) => env[key] } as never,
      {} as never,
      { getDownloadUrl: async () => 'https://img' } as never,
      { ensureAccess: async () => ({}) } as never,
    );
    return { service, updateConnection, updatePost };
  }

  afterEach(() => jest.restoreAllMocks());

  it('em produção sem SOCIAL_TOKEN_KEY nem começa a conexão', async () => {
    const { service } = build(
      { NODE_ENV: 'production', JWT_SECRET: 'jwt', META_APP_ID: 'a', META_APP_SECRET: 'b' },
      '',
    );
    await expect(service.getConnectUrl(9, 4)).rejects.toThrow('SOCIAL_TOKEN_KEY');
  });

  it('token cifrado com o JWT_SECRET abre e é cifrado de novo com a chave própria', async () => {
    const old = sealSecret('page-token', 'jwt');
    const { service, updateConnection } = build(
      { NODE_ENV: 'production', JWT_SECRET: 'jwt', SOCIAL_TOKEN_KEY: 'own' },
      old,
    );
    jest.spyOn(global, 'fetch').mockResolvedValue({ json: async () => ({ id: 'x' }) } as never);
    await (service as any).publishPost(1);
    const resealed = (updateConnection.mock.calls[0] as any)[0].data.facebookAccessToken;
    expect(openSecret(resealed, 'own')).toBe('page-token');
  });

  it('token que nenhuma chave abre: o post falha pedindo pra conectar de novo', async () => {
    const lost = sealSecret('page-token', 'chave-que-sumiu');
    const { service, updatePost } = build({ JWT_SECRET: 'jwt', SOCIAL_TOKEN_KEY: 'own' }, lost);
    const fetchSpy = jest.spyOn(global, 'fetch');
    await (service as any).publishPost(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(updatePost).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({
        status: 'FAILED',
        errorMessage: expect.stringContaining('de novo'),
      }),
    });
  });
});
