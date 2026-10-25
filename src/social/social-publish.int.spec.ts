/**
 * Item 266, contra o Postgres de verdade (a Meta simulada): imagem de post
 * ocultado não volta, duas execuções ao mesmo tempo publicam uma vez só, post
 * vencido há mais de um dia não sai sozinho e a nova tentativa vai só para a
 * rede que falhou.
 */
import { PrismaService } from '../prisma/prisma.service';
import { SocialService, SOCIAL_IMAGE_HIDDEN_MESSAGE } from './social.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const HOUR = 3_600_000;

describe('Posts nas redes sociais (integração)', () => {
  const prisma = new PrismaService();
  const service = new SocialService(
    prisma,
    { get: (key: string) => (key === 'JWT_SECRET' ? 'jwt' : undefined) } as never,
    {} as never,
    { getDownloadUrl: async () => 'https://img' } as never,
    { ensureAccess: async () => ({}) } as never,
  );
  let ownerId: number;
  let networkId: number;
  let shopId: number;
  const calls: string[] = [];

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = (
      await prisma.user.create({
        data: {
          email: `social-${RUN}@test.local`,
          isActive: true,
          password: 'x',
          fullName: 'Dona',
          idDocNumber: `soc${RUN}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'female',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      })
    ).id;
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede social ${RUN}` } })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: 'Social',
          slug: `social-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `social-shop-${RUN}@test.local`,
          networkId,
          ownerUserId: ownerId,
        },
      })
    ).id;
    await prisma.socialConnection.create({
      data: {
        barbershopId: shopId,
        facebookPageId: 'page1',
        facebookPageName: 'Página',
        facebookAccessToken: 'plain-token',
        instagramBusinessAccountId: 'ig1',
        connectedByUserId: ownerId,
      },
    });
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE id = ${ownerId}`;
    await prisma.$disconnect();
  });

  let failInstagram = false;
  beforeEach(() => {
    calls.length = 0;
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      calls.push(url);
      // Um pouco de demora, como a rede de verdade
      await new Promise((r) => setTimeout(r, 20));
      if (url.includes('/media_publish')) {
        return {
          json: async () =>
            failInstagram ? { error: { message: 'IG fora' } } : { id: 'ig-media' },
        } as never;
      }
      if (url.includes('/media')) return { json: async () => ({ id: 'container' }) } as never;
      return { json: async () => ({ post_id: 'fb-post' }) } as never;
    });
  });

  const post = (data: Record<string, unknown> = {}) =>
    prisma.socialPost.create({
      data: {
        barbershopId: shopId,
        createdByUserId: ownerId,
        caption: 'Oi',
        imageKey: `social-posts/${shopId}/${Math.random()}.jpg`,
        scheduledFor: new Date(Date.now() - 60_000),
        postToFacebook: true,
        postToInstagram: false,
        ...data,
      },
    });

  it('imagem de post ocultado pela moderação não volta num post novo', async () => {
    const hidden = await post({ status: 'PUBLISHED', hiddenAt: new Date() });
    await expect(
      service.createPost(ownerId, shopId, {
        caption: 'De novo',
        imageKey: hidden.imageKey,
        scheduledFor: new Date(Date.now() + HOUR).toISOString(),
        postToFacebook: true,
        postToInstagram: false,
      }),
    ).rejects.toThrow(SOCIAL_IMAGE_HIDDEN_MESSAGE);
  });

  it('duas execuções ao mesmo tempo publicam o post uma vez só', async () => {
    const due = await post();
    await Promise.all([service.publishDuePosts(), service.publishDuePosts()]);
    expect(calls.filter((c) => c.includes('/photos'))).toHaveLength(1);
    const row = await prisma.socialPost.findUniqueOrThrow({ where: { id: due.id } });
    expect(row.status).toBe('PUBLISHED');
    // Não pode ser excluído enquanto publica (nem depois de publicado)
    await prisma.socialPost.update({ where: { id: due.id }, data: { status: 'PUBLISHING' } });
    await expect(service.deletePost(ownerId, shopId, due.id)).rejects.toThrow(
      'ainda não publicados',
    );
    await prisma.socialPost.update({ where: { id: due.id }, data: { status: 'PUBLISHED' } });
  });

  it('post vencido há mais de um dia (unidade estava suspensa) vira falha com o motivo', async () => {
    const late = await post({ scheduledFor: new Date(Date.now() - 3 * 24 * HOUR) });
    await service.publishDuePosts();
    const row = await prisma.socialPost.findUniqueOrThrow({ where: { id: late.id } });
    expect(row.status).toBe('FAILED');
    expect(row.errorMessage).toContain('Reagende');
    expect(calls).toHaveLength(0);
  });

  it('saiu no Facebook e falhou no Instagram: a nova tentativa vai só para o Instagram', async () => {
    failInstagram = true;
    const both = await post({ postToInstagram: true });
    await service.publishDuePosts();
    let row = await prisma.socialPost.findUniqueOrThrow({ where: { id: both.id } });
    expect(row).toMatchObject({
      status: 'PUBLISHED',
      facebookPostId: 'fb-post',
      instagramMediaId: null,
    });

    // A tela sabe em qual rede já saiu (para oferecer só a que falhou)
    const listed = (await service.getPosts(ownerId, shopId)).find((p) => p.id === both.id);
    expect(listed).toMatchObject({ publishedToFacebook: true, publishedToInstagram: false });

    failInstagram = false;
    await service.retryPost(ownerId, shopId, both.id, new Date(Date.now() + 1_000).toISOString());
    await prisma.socialPost.update({
      where: { id: both.id },
      data: { scheduledFor: new Date(Date.now() - 1_000) },
    });
    calls.length = 0;
    await service.publishDuePosts();
    expect(calls.some((c) => c.includes('/photos'))).toBe(false);
    row = await prisma.socialPost.findUniqueOrThrow({ where: { id: both.id } });
    expect(row).toMatchObject({
      status: 'PUBLISHED',
      facebookPostId: 'fb-post',
      instagramMediaId: 'ig-media',
      errorMessage: null,
    });
  });
});
