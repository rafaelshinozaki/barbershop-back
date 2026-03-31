// src/main.ts
import { Logger, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { NestFactory } from '@nestjs/core';
import * as session from 'express-session';
import * as passport from 'passport';
import { AppModule } from './app.module';
import * as cookieParser from 'cookie-parser';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { json } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
  });
  const logger = new Logger('main');
  const configService = app.get(ConfigService);

  // Log para debug do GraphQL
  logger.log('🚀 Iniciando aplicação...');
  logger.log('📋 Verificando configuração GraphQL...');

  // Custom body parser: saves raw body on webhook route for Stripe signature verification,
  // while parsing JSON normally for all other routes.
  app.use(
    json({
      verify: (req: any, _res, buf) => {
        if (req.originalUrl === '/stripe/webhook') {
          req.rawBody = buf;
        }
      },
    }),
  );

  // Security Headers with Helmet
  app.use(
    helmet({
      // Content Security Policy
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'https:'],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          connectSrc: [
            "'self'",
            'https://api.stripe.com',
            'https://graph.facebook.com',
            'https://www.googleapis.com',
          ],
          frameSrc: ["'self'", 'https://js.stripe.com', 'https://hooks.stripe.com'],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: [],
        },
      },
      // Cross-Origin Embedder Policy
      crossOriginEmbedderPolicy: false, // Desabilitado para compatibilidade com GraphQL Playground
      // Cross-Origin Opener Policy
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      // Cross-Origin Resource Policy
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // DNS Prefetch Control
      dnsPrefetchControl: { allow: false },
      // Frameguard
      frameguard: { action: 'deny' },
      // Hide Powered-By
      hidePoweredBy: true,
      // HSTS
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      // IE No Open
      ieNoOpen: true,
      // NoSniff
      noSniff: true,
      // Origin Agent Cluster
      originAgentCluster: true,
      // Referrer Policy
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      // XSS Protection
      xssFilter: true,
    }),
  );

  // Swager/OpenAPI
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Barbershop Backend API')
    .setDescription('API documentation for the Barbershop backend')
    .setVersion('1.0')
    .addCookieAuth('Authentication')
    .build();

  // Middlewares básicos
  app.use(cookieParser());
  app.use(passport.initialize());
  // Se for usar session:
  // app.use(
  //   session({
  //     resave: false,
  //     saveUninitialized: false,
  //     name: 'session',
  //     secret: configService.get<string>('SESSION_SECRET'),
  //     cookie: {
  //       secure: false,
  //       maxAge: Number(configService.get<number>('SESSION_MAX_AGE')),
  //     },
  //   }),
  // );

  // CORS: libera localmente e os domínios de produção
  const frontendUrl = configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
  const corsOrigins = [
    frontendUrl,
    'http://localhost:5173', // front em dev
    'http://localhost:3020', // front em dev
    'http://localhost:5000', // front em dev
    'http://localhost:5174', // front em dev (porta alternativa)
    'http://localhost:5175', // front em dev (porta alternativa)
    'http://localhost:5176', // front em dev (porta alternativa)
    'http://localhost:5177', // front em dev (porta alternativa)
    'http://localhost:5178', // front em dev (porta alternativa)
    'https://barbershop-front.vercel.app', // domínio Vercel
    'https://barbershop.zeero.dev.br', // domínio de produção
    'https://zeero.dev.br', // domínio alternativo
  ];

  logger.log(`🌐 Configurando CORS para origins: ${corsOrigins.join(', ')}`);

  app.enableCors({
    origin: corsOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Authorization',
    credentials: true, // se você usar cookies ou auth
  });

  // Validação global
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { groups: ['transform'] },
    }),
  );

  // Swagger endpoint
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('swagger', app, document);

  // Start
  const port = configService.get<number>('PORT') || 3000;
  await app.listen(port);
  logger.log(`✅ Application is running on: ${await app.getUrl()}`);
  logger.log(`📋 GraphQL endpoint: ${await app.getUrl()}/graphql`);
  logger.log(`📋 Health endpoint: ${await app.getUrl()}/health`);
  logger.log(`📋 Swagger endpoint: ${await app.getUrl()}/swagger`);
}
bootstrap();
