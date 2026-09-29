// Carregado antes de tudo em main.ts: o Sentry precisa instrumentar HTTP,
// Express e Prisma antes de eles serem importados.
import * as Sentry from '@sentry/nestjs';
import { sentryOptions } from './common/sentry/sentry-options';

const options = sentryOptions(process.env);
if (options) Sentry.init(options);
