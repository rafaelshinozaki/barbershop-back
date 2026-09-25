// src/app.module.ts
import { SeoModule } from './seo/seo.module';
import { Module, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { PlanModule } from './plan/plan.module';
import { StripeModule } from './stripe/stripe.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as Joi from 'joi';
import { PaymentsModule } from './payments/payments.module';
import { AuthModule } from './auth/auth.module';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { RolesGuard } from './auth/guards/roles.guard';
import { EmailModule } from './email/email.module';
import { HealthModule } from './health/health.module';
import { AwsModule } from './aws/aws.module';
import { NotificationsModule } from './notifications/notifications.module';
import { BackofficeModule } from './backoffice/backoffice.module';
import { BarbershopModule } from './barbershop/barbershop.module';
import { queryLimitsPlugin } from './graphql/query-limits.plugin';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { join } from 'path';
import { GraphQLAppModule } from './graphql/graphql.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottleInterceptor } from './common/interceptors/throttle.interceptor';
import { SecurityHeadersMiddleware } from './common/middleware/security-headers.middleware';
import { GraphQLThrottleGuard } from './common/guards/graphql-throttle.guard';
import { RedisModule } from './redis/redis.module';
import { FailOpenRedisThrottlerStorage } from './redis/redis-throttler.storage';
import { redisUrl } from './redis/redis-url';
import { QueueModule } from './queue/queue.module';
import { RealtimeModule } from './realtime/realtime.module';
import { LocationsModule } from './locations/locations.module';
import type { IncomingMessage } from 'http';
import { isAllowedOrigin } from './common/cors-origins';
import { serializeDatesAsIso } from './graphql/date-iso.transform';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema: Joi.object({
        PORT: Joi.string().required(),
        NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
        FRONTEND_URL: Joi.string().uri().default('http://localhost:5173'),

        DB_DIALECT: Joi.string().required(),
        DB_HOST: Joi.string().required(),
        DB_PORT: Joi.string().required(),
        DB_USER: Joi.string().required(),
        DB_PASSWORD: Joi.string().required(),
        DB_NAME: Joi.string().required(),

        EMAIL_HOST: Joi.string().required(),
        EMAIL_PORT: Joi.string().required(),
        EMAIL_SECURE: Joi.string().required(),
        EMAIL_USER: Joi.string().required(),
        EMAIL_PASS: Joi.string().required(),
        EMAIL_FROM: Joi.string().required(), // valide também o EMAIL_FROM
        MAILGUN_DOMAIN: Joi.string().required(),
        MAILGUN_FROM: Joi.string().required(),

        STRIPE_SECRET_KEY: Joi.string().required(),
        STRIPE_WEBHOOK_SECRET: Joi.string().required(),

        SESSION_SECRET: Joi.string().required(),
        SESSION_MAX_AGE: Joi.string().required(),

        // Chave por plataforma em vez de uma única chave que libera/derruba
        // Google e Facebook juntos — cada provedor pode ser ligado/desligado
        // independentemente (útil pra ativar só quando as credenciais reais
        // daquela plataforma estiverem configuradas).
        ENABLE_GOOGLE_AUTH: Joi.boolean().default(true),
        ENABLE_FACEBOOK_AUTH: Joi.boolean().default(true),
        ENABLE_APPLE_AUTH: Joi.boolean().default(true),

        GOOGLE_CLIENT_ID: Joi.when('ENABLE_GOOGLE_AUTH', {
          is: true,
          then: Joi.string().required(),
          otherwise: Joi.string().allow('').optional(),
        }),
        GOOGLE_CLIENT_SECRET: Joi.when('ENABLE_GOOGLE_AUTH', {
          is: true,
          then: Joi.string().required(),
          otherwise: Joi.string().allow('').optional(),
        }),
        GOOGLE_CALLBACK_URL: Joi.when('ENABLE_GOOGLE_AUTH', {
          is: true,
          then: Joi.string().required(),
          otherwise: Joi.string().allow('').optional(),
        }),

        FACEBOOK_CLIENT_ID: Joi.when('ENABLE_FACEBOOK_AUTH', {
          is: true,
          then: Joi.string().required(),
          otherwise: Joi.string().allow('').optional(),
        }),
        FACEBOOK_CLIENT_SECRET: Joi.when('ENABLE_FACEBOOK_AUTH', {
          is: true,
          then: Joi.string().required(),
          otherwise: Joi.string().allow('').optional(),
        }),
        FACEBOOK_CALLBACK_URL: Joi.when('ENABLE_FACEBOOK_AUTH', {
          is: true,
          then: Joi.string().required(),
          otherwise: Joi.string().allow('').optional(),
        }),

        JWT_SECRET: Joi.string().required(),
        JWT_EXPIRATION: Joi.string().required(),
        AWS_ACCESS_KEY_ID: Joi.string().required(),
        AWS_SECRET_ACCESS_KEY: Joi.string().required(),
        AWS_REGION: Joi.string().required(),
        S3_BUCKET: Joi.string().required(),

        // Filas (BullMQ) e estado compartilhado entre instâncias
        REDIS_URL: Joi.string()
          .uri({ scheme: ['redis', 'rediss'] })
          .default('redis://localhost:6379'),
        EMAIL_RATE_PER_SECOND: Joi.number().integer().min(1).optional(),
        WHATSAPP_RATE_PER_SECOND: Joi.number().integer().min(1).optional(),
        // Atrás de load balancer/proxy: quantos saltos confiar no
        // X-Forwarded-For pra achar o IP real do cliente (ver main.ts)
        TRUST_PROXY: Joi.string().optional(),
      }),
    }),
    // Contadores no Redis (compartilhados entre instâncias) — ver
    // FailOpenRedisThrottlerStorage
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        storage: new FailOpenRedisThrottlerStorage(redisUrl(config.get<string>('REDIS_URL'))),
        throttlers: [
          {
            name: 'default',
            ttl: 60000, // 1 minuto
            limit: 300, // 300 requisições por minuto por IP — generoso o bastante para
            // uso normal (varias queries GraphQL em paralelo por página), mas
            // barra flood em velocidade de rede. Rotas sensíveis (login,
            // forgot-password, criação de conta, etc.) usam limites bem mais
            // restritos via @ThrottleLogin()/@ThrottleAuth()/etc., que sobrescrevem
            // este throttler 'default' (ver common/decorators/throttle.decorator.ts).
          },
        ],
      }),
    }),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      // HTTP: { req, res }. WebSocket (subscriptions, graphql-ws): o
      // request do handshake vem em extra.request — o GraphQLJwtAuthGuard lê
      // o cookie dos headers dele, igual numa requisição HTTP.
      context: ({ req, res, extra }) =>
        extra?.request ? { req: extra.request } : { req, res, user: req.user },
      subscriptions: {
        'graphql-ws': {
          path: '/graphql',
          // Recusa o socket já no handshake quando a origem não é do front
          // (o navegador não aplica CORS a WebSocket e o login é por cookie —
          // sem isso outro site abriria o socket com o cookie do usuário).
          // Sem cookie a conexão é aceita como anônima: só a subscription da
          // página pública (publicSlotsChanged) funciona; as privadas passam
          // pelo GraphQLJwtAuthGuard, que exige login e sessão ativa.
          onConnect: (ctx) => {
            const { request } = ctx.extra as { request: IncomingMessage };
            const origin = request.headers.origin;
            return (
              !origin ||
              isAllowedOrigin(origin, process.env.FRONTEND_URL, process.env.TENANT_ROOT_DOMAIN)
            );
          },
        },
      },
      formatError: (formattedError) => {
        // Evita "Converting circular structure to JSON" - retorna apenas campos serializáveis
        try {
          const ext = formattedError.extensions as Record<string, unknown> | undefined;
          const code =
            typeof ext?.code === 'string' || typeof ext?.code === 'number' ? ext.code : undefined;
          return {
            message: String(formattedError.message ?? 'Internal server error'),
            locations: formattedError.locations,
            path: formattedError.path,
            extensions: code !== undefined ? { code } : undefined,
          };
        } catch {
          return { message: 'Internal server error' };
        }
      },
      // Playground/introspection/debug expõem todo o schema (incluindo a
      // superfície de auth) e detalhes internos de erro para reconhecimento
      // de um atacante — habilitados só fora de produção.
      playground: process.env.NODE_ENV !== 'production',
      introspection: process.env.NODE_ENV !== 'production',
      debug: process.env.NODE_ENV !== 'production',
      sortSchema: true,
      // Date em campo String sai como ISO 8601 (e não ms em texto); SDL intacto
      transformSchema: serializeDatesAsIso,
      // Profundidade e nº de campos (aliases contam) por operação
      plugins: [queryLimitsPlugin()],
    }),
    RedisModule,
    QueueModule,
    RealtimeModule,
    LocationsModule,
    AuthModule,
    PrismaModule,
    PlanModule,
    EmailModule,
    AwsModule,
    StripeModule,
    PaymentsModule,
    HealthModule,
    NotificationsModule,
    BackofficeModule,
    BarbershopModule,
    SeoModule,
    GraphQLAppModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: GraphQLThrottleGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ThrottleInterceptor,
    },
  ],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(SecurityHeadersMiddleware)
      .forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }
}
