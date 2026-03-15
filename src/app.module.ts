// src/app.module.ts
import { Module, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { PlanModule } from './plan/plan.module';
import { StripeModule } from './stripe/stripe.module';
import { ConfigModule } from '@nestjs/config';
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
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { join } from 'path';
import { GraphQLAppModule } from './graphql/graphql.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottleInterceptor } from './common/interceptors/throttle.interceptor';
import { SecurityHeadersMiddleware } from './common/middleware/security-headers.middleware';

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

        DISABLE_SOCIAL_SSO: Joi.boolean().default(false),

        GOOGLE_CLIENT_ID: Joi.when('DISABLE_SOCIAL_SSO', {
          is: true,
          then: Joi.string().allow('').optional(),
          otherwise: Joi.string().required(),
        }),
        GOOGLE_CLIENT_SECRET: Joi.when('DISABLE_SOCIAL_SSO', {
          is: true,
          then: Joi.string().allow('').optional(),
          otherwise: Joi.string().required(),
        }),
        GOOGLE_CALLBACK_URL: Joi.when('DISABLE_SOCIAL_SSO', {
          is: true,
          then: Joi.string().allow('').optional(),
          otherwise: Joi.string().required(),
        }),

        FACEBOOK_CLIENT_ID: Joi.when('DISABLE_SOCIAL_SSO', {
          is: true,
          then: Joi.string().allow('').optional(),
          otherwise: Joi.string().required(),
        }),
        FACEBOOK_CLIENT_SECRET: Joi.when('DISABLE_SOCIAL_SSO', {
          is: true,
          then: Joi.string().allow('').optional(),
          otherwise: Joi.string().required(),
        }),
        FACEBOOK_CALLBACK_URL: Joi.when('DISABLE_SOCIAL_SSO', {
          is: true,
          then: Joi.string().allow('').optional(),
          otherwise: Joi.string().required(),
        }),

        JWT_SECRET: Joi.string().required(),
        JWT_EXPIRATION: Joi.string().required(),
        AWS_ACCESS_KEY_ID: Joi.string().required(),
        AWS_SECRET_ACCESS_KEY: Joi.string().required(),
        AWS_REGION: Joi.string().required(),
        S3_BUCKET: Joi.string().required(),
      }),
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 1 minuto
        limit: 100, // 100 requisições por minuto
      },
      {
        ttl: 3600000, // 1 hora
        limit: 1000, // 1000 requisições por hora
      },
    ]),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      context: ({ req, res }) => ({ req, res, user: req.user }),
      formatError: (formattedError) => {
        // Evita "Converting circular structure to JSON" - retorna apenas campos serializáveis
        try {
          const ext = formattedError.extensions as Record<string, unknown> | undefined
          const code = typeof ext?.code === 'string' || typeof ext?.code === 'number' ? ext.code : undefined
          return {
            message: String(formattedError.message ?? 'Internal server error'),
            locations: formattedError.locations,
            path: formattedError.path,
            extensions: code !== undefined ? { code } : undefined,
          }
        } catch {
          return { message: 'Internal server error' }
        }
      },
      playground: true,
      introspection: true,
      debug: true,
      sortSchema: true,
    }),
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
    GraphQLAppModule,
  ],
  providers: [
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
    consumer.apply(SecurityHeadersMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
