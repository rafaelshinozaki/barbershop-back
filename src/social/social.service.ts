import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '@/prisma/prisma.service';
import { PresignedUpload, S3Service } from '@/aws/s3.service';
import { randomUUID } from 'crypto';
import { BarbershopService } from '@/barbershop/barbershop.service';

interface OAuthStatePayload {
  barbershopId: number;
  userId: number;
}

// Publica posts agendados no Instagram/Facebook via Graph API — chamadas
// diretas com fetch, sem SDK, mesmo padrão do WhatsappService. Diferente do
// WhatsApp (token estático de sistema, um só pra plataforma inteira), aqui
// cada barbearia conecta a própria Página do Facebook via OAuth (Login do
// Facebook pra Empresas) — o token fica salvo em SocialConnection e nunca é
// exposto no GraphQL.
@Injectable()
export class SocialService {
  private readonly logger = new Logger(SocialService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jwtService: JwtService,
    private readonly s3Service: S3Service,
    private readonly barbershopService: BarbershopService,
  ) {}

  isConfigured(): boolean {
    return !!(this.config.get<string>('META_APP_ID') && this.config.get<string>('META_APP_SECRET'));
  }

  private apiVersion(): string {
    return this.config.get<string>('META_GRAPH_API_VERSION') || 'v21.0';
  }

  private graphUrl(path: string): string {
    return `https://graph.facebook.com/${this.apiVersion()}${path}`;
  }

  // ============ OAUTH ============

  async getConnectUrl(userId: number, barbershopId: number): Promise<string> {
    await this.barbershopService.getBarbershop(userId, barbershopId);
    if (!this.isConfigured()) {
      throw new BadRequestException('Integração com Meta não configurada nesta instância.');
    }
    const state = this.jwtService.sign({ barbershopId, userId } as OAuthStatePayload, {
      secret: this.config.get<string>('JWT_SECRET'),
      expiresIn: '10m',
    });
    const redirectUri = this.config.get<string>('META_OAUTH_REDIRECT_URI');
    const scope = [
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_posts',
      'instagram_basic',
      'instagram_content_publish',
      'business_management',
    ].join(',');
    const params = new URLSearchParams({
      client_id: this.config.get<string>('META_APP_ID'),
      redirect_uri: redirectUri,
      state,
      scope,
      response_type: 'code',
    });
    return `https://www.facebook.com/${this.apiVersion()}/dialog/oauth?${params.toString()}`;
  }

  // Troca o code pelo token, resolve a Página e a conta do Instagram
  // vinculada, e salva a conexão. Retorna o barbershopId (pra montar o
  // redirect de volta ao frontend) e uma mensagem de erro amigável, se
  // algo falhar no meio do caminho — não deixa exceção estourar até o
  // controller porque o usuário está no meio de um redirect do navegador,
  // não numa chamada GraphQL que ele veria o erro estruturado.
  async handleOAuthCallback(
    code: string,
    state: string,
  ): Promise<{ barbershopId: number; error?: string }> {
    let payload: OAuthStatePayload;
    try {
      payload = this.jwtService.verify(state, { secret: this.config.get<string>('JWT_SECRET') });
    } catch {
      throw new BadRequestException(
        'Link de conexão expirado ou inválido. Tente conectar de novo.',
      );
    }
    const { barbershopId } = payload;

    try {
      const redirectUri = this.config.get<string>('META_OAUTH_REDIRECT_URI');
      const appId = this.config.get<string>('META_APP_ID');
      const appSecret = this.config.get<string>('META_APP_SECRET');

      const shortLivedRes = await fetch(
        this.graphUrl('/oauth/access_token') +
          `?${new URLSearchParams({
            client_id: appId,
            redirect_uri: redirectUri,
            client_secret: appSecret,
            code,
          })}`,
      );
      const shortLived = await shortLivedRes.json();
      if (!shortLived.access_token) {
        throw new Error(
          shortLived.error?.message || 'Falha ao trocar o código pelo token de acesso.',
        );
      }

      const longLivedRes = await fetch(
        this.graphUrl('/oauth/access_token') +
          `?${new URLSearchParams({
            grant_type: 'fb_exchange_token',
            client_id: appId,
            client_secret: appSecret,
            fb_exchange_token: shortLived.access_token,
          })}`,
      );
      const longLived = await longLivedRes.json();
      const userToken = longLived.access_token || shortLived.access_token;

      const pagesRes = await fetch(
        this.graphUrl('/me/accounts') + `?${new URLSearchParams({ access_token: userToken })}`,
      );
      const pagesData = await pagesRes.json();
      const page = pagesData.data?.[0];
      if (!page) {
        throw new Error(
          'Nenhuma Página do Facebook encontrada nessa conta. Você precisa ser admin de uma Página pra conectar.',
        );
      }

      const igRes = await fetch(
        this.graphUrl(`/${page.id}`) +
          `?${new URLSearchParams({
            fields: 'instagram_business_account{id,username}',
            access_token: page.access_token,
          })}`,
      );
      const igData = await igRes.json();
      const igAccount = igData.instagram_business_account;

      await this.prisma.socialConnection.upsert({
        where: { barbershopId },
        create: {
          barbershopId,
          facebookPageId: page.id,
          facebookPageName: page.name,
          facebookAccessToken: page.access_token,
          instagramBusinessAccountId: igAccount?.id ?? null,
          instagramUsername: igAccount?.username ?? null,
          connectedByUserId: payload.userId,
        },
        update: {
          facebookPageId: page.id,
          facebookPageName: page.name,
          facebookAccessToken: page.access_token,
          instagramBusinessAccountId: igAccount?.id ?? null,
          instagramUsername: igAccount?.username ?? null,
          connectedByUserId: payload.userId,
        },
      });

      return { barbershopId };
    } catch (err) {
      this.logger.error(`Erro ao conectar rede social da barbearia #${barbershopId}:`, err);
      return {
        barbershopId,
        error: err instanceof Error ? err.message : 'Erro ao conectar conta.',
      };
    }
  }

  async getConnection(userId: number, barbershopId: number) {
    await this.barbershopService.getBarbershop(userId, barbershopId);
    const connection = await this.prisma.socialConnection.findUnique({ where: { barbershopId } });
    if (!connection) return null;
    return {
      facebookPageName: connection.facebookPageName,
      instagramUsername: connection.instagramUsername,
      connectedAt: connection.createdAt.toISOString(),
    };
  }

  async disconnect(userId: number, barbershopId: number) {
    await this.barbershopService.getBarbershop(userId, barbershopId);
    await this.prisma.socialConnection.deleteMany({ where: { barbershopId } });
    return true;
  }

  // ============ POSTS ============

  async getPostImageUploadUrl(
    userId: number,
    barbershopId: number,
    contentType?: string,
  ): Promise<PresignedUpload> {
    await this.barbershopService.getBarbershop(userId, barbershopId);
    return this.s3Service.createImageUpload(
      `social-posts/${barbershopId}/${Date.now()}-${randomUUID().slice(0, 8)}`,
      contentType,
    );
  }

  async createPost(
    userId: number,
    barbershopId: number,
    data: {
      caption: string;
      imageKey: string;
      scheduledFor: string;
      postToFacebook: boolean;
      postToInstagram: boolean;
    },
  ) {
    await this.barbershopService.getBarbershop(userId, barbershopId);
    if (!data.postToFacebook && !data.postToInstagram) {
      throw new BadRequestException('Escolha pelo menos uma rede social.');
    }
    const connection = await this.prisma.socialConnection.findUnique({ where: { barbershopId } });
    if (!connection) {
      throw new BadRequestException('Conecte uma conta antes de agendar um post.');
    }
    if (data.postToInstagram && !connection.instagramBusinessAccountId) {
      throw new BadRequestException('Nenhuma conta do Instagram vinculada à Página conectada.');
    }
    const scheduledFor = new Date(data.scheduledFor);
    if (Number.isNaN(scheduledFor.getTime()) || scheduledFor.getTime() < Date.now()) {
      throw new BadRequestException('Data de agendamento inválida.');
    }
    return this.prisma.socialPost.create({
      data: {
        barbershopId,
        createdByUserId: userId,
        caption: data.caption,
        imageKey: data.imageKey,
        postToFacebook: data.postToFacebook,
        postToInstagram: data.postToInstagram,
        scheduledFor,
      },
    });
  }

  async getPosts(userId: number, barbershopId: number) {
    await this.barbershopService.getBarbershop(userId, barbershopId);
    const posts = await this.prisma.socialPost.findMany({
      where: { barbershopId },
      orderBy: { scheduledFor: 'desc' },
    });
    return Promise.all(
      posts.map(async (p) => ({
        ...p,
        scheduledFor: p.scheduledFor.toISOString(),
        publishedAt: p.publishedAt?.toISOString(),
        createdAt: p.createdAt.toISOString(),
        imageUrl: await this.s3Service.getDownloadUrl(p.imageKey),
      })),
    );
  }

  async deletePost(userId: number, barbershopId: number, id: number) {
    await this.barbershopService.getBarbershop(userId, barbershopId);
    const post = await this.prisma.socialPost.findFirst({ where: { id, barbershopId } });
    if (!post) throw new NotFoundException('Post não encontrado');
    if (post.status !== 'SCHEDULED') {
      throw new BadRequestException('Só é possível excluir posts ainda não publicados.');
    }
    await this.prisma.socialPost.delete({ where: { id } });
    return true;
  }

  // ============ PUBLICAÇÃO (chamado pelo cron) ============

  async publishDuePosts(): Promise<void> {
    const due = await this.prisma.socialPost.findMany({
      where: { status: 'SCHEDULED', scheduledFor: { lte: new Date() } },
    });
    for (const post of due) {
      await this.publishPost(post.id).catch((err) =>
        this.logger.error(`Erro ao publicar post social #${post.id}:`, err),
      );
    }
  }

  private async publishPost(postId: number): Promise<void> {
    const post = await this.prisma.socialPost.findUnique({ where: { id: postId } });
    if (!post || post.status !== 'SCHEDULED') return;
    const connection = await this.prisma.socialConnection.findUnique({
      where: { barbershopId: post.barbershopId },
    });
    if (!connection) {
      await this.prisma.socialPost.update({
        where: { id: postId },
        data: { status: 'FAILED', errorMessage: 'Conta desconectada antes da publicação.' },
      });
      return;
    }

    const imageUrl = await this.s3Service.getDownloadUrl(post.imageKey);
    const errors: string[] = [];
    let facebookPostId: string | undefined;
    let instagramMediaId: string | undefined;

    if (post.postToFacebook) {
      try {
        const res = await fetch(this.graphUrl(`/${connection.facebookPageId}/photos`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: imageUrl,
            caption: post.caption,
            access_token: connection.facebookAccessToken,
          }),
        });
        const json = await res.json();
        if (!json.post_id && !json.id)
          throw new Error(json.error?.message || 'Falha ao publicar no Facebook.');
        facebookPostId = json.post_id || json.id;
      } catch (err) {
        errors.push(`Facebook: ${err instanceof Error ? err.message : 'erro desconhecido'}`);
      }
    }

    if (post.postToInstagram && connection.instagramBusinessAccountId) {
      try {
        const containerRes = await fetch(
          this.graphUrl(`/${connection.instagramBusinessAccountId}/media`),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image_url: imageUrl,
              caption: post.caption,
              access_token: connection.facebookAccessToken,
            }),
          },
        );
        const containerJson = await containerRes.json();
        if (!containerJson.id)
          throw new Error(containerJson.error?.message || 'Falha ao preparar mídia do Instagram.');

        const publishRes = await fetch(
          this.graphUrl(`/${connection.instagramBusinessAccountId}/media_publish`),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              creation_id: containerJson.id,
              access_token: connection.facebookAccessToken,
            }),
          },
        );
        const publishJson = await publishRes.json();
        if (!publishJson.id)
          throw new Error(publishJson.error?.message || 'Falha ao publicar no Instagram.');
        instagramMediaId = publishJson.id;
      } catch (err) {
        errors.push(`Instagram: ${err instanceof Error ? err.message : 'erro desconhecido'}`);
      }
    }

    const requestedBoth = post.postToFacebook && post.postToInstagram;
    const failed = requestedBoth ? errors.length === 2 : errors.length > 0;

    await this.prisma.socialPost.update({
      where: { id: postId },
      data: failed
        ? { status: 'FAILED', errorMessage: errors.join(' | ') }
        : {
            status: 'PUBLISHED',
            publishedAt: new Date(),
            facebookPostId,
            instagramMediaId,
            errorMessage: errors.length > 0 ? errors.join(' | ') : null,
          },
    });
  }
}
