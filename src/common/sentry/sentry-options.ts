import { withStreamedSpan, type NodeOptions } from '@sentry/nestjs';

/** O que a limpeza mexe no evento do Sentry (erro ou transação) */
type SpanFields = { data?: Record<string, unknown>; attributes?: Record<string, unknown> };
type Scrubbable = {
  request?: { cookies?: unknown; data?: unknown; headers?: Record<string, string> };
  user?: { id?: string | number } & Record<string, unknown>;
  spans?: SpanFields[];
  contexts?: { trace?: SpanFields };
};

/**
 * Texto de comando do banco e do Redis nos spans: a chave do Redis leva o
 * e-mail (ex.: auth:login-blocked:<e-mail>) e o SQL pode levar valores.
 */
const SPAN_SECRET_FIELDS = ['db.query.text', 'db.statement', 'db.query.summary'];

function scrubSpan(span: SpanFields | undefined) {
  for (const bag of [span?.data, span?.attributes]) {
    if (!bag) continue;
    for (const field of SPAN_SECRET_FIELDS) delete bag[field];
  }
}

/** Integrações padrão que ficam de fora (ver sentryOptions) */
const DROPPED_INTEGRATIONS = ['Express', 'LocalVariables', 'LocalVariablesAsync', 'Console'];

/** Cabeçalhos que nunca saem pro Sentry */
// x-backoffice-staff: quem da equipe pediu (e-mail e nome), assinado e
// reaproveitável até vencer
const SECRET_HEADERS = [
  'cookie',
  'authorization',
  'x-backoffice-gateway',
  'x-backoffice-staff',
  'set-cookie',
];

/** Span enviado em streaming (padrão do Sentry 11): sai sem o texto do comando */
export function scrubStreamedSpan<T extends { attributes?: Record<string, unknown> }>(span: T): T {
  scrubSpan(span);
  return span;
}

/**
 * Tira do evento o que é dado pessoal ou segredo: cookie, Authorization,
 * corpo da requisição (GraphQL leva e-mail, telefone, texto de chat) e
 * qualquer coisa do usuário além do id.
 */
export function scrubEvent<T extends object>(input: T): T {
  const event = input as T & Scrubbable;
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    if (event.request.headers) {
      for (const name of Object.keys(event.request.headers)) {
        if (SECRET_HEADERS.includes(name.toLowerCase())) delete event.request.headers[name];
      }
    }
  }
  if (event.user) event.user = event.user.id != null ? { id: event.user.id } : undefined;
  event.spans?.forEach(scrubSpan);
  scrubSpan(event.contexts?.trace);
  return event;
}

/**
 * Opções do Sentry; sem SENTRY_DSN, nada (o Sentry fica desligado e a API
 * segue igual, como o WhatsApp sem token).
 */
export function sentryOptions(env: NodeJS.ProcessEnv): NodeOptions | undefined {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) return undefined;
  const rate = Number(env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1');
  return {
    dsn,
    environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV || 'development',
    release: env.SENTRY_RELEASE || undefined,
    // Nada de dado pessoal: sem usuário automático, cookie, cabeçalho ou
    // corpo das requisições (a limpeza em beforeSend é a segunda camada)
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { deny: SECRET_HEADERS }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      // Nem o texto da consulta (pode ter valor literal) nem as variáveis;
      // a operação vai no nome do span e na tag "operation"
      graphQL: { document: false, variables: false },
      databaseQueryData: false,
      // Dados dos jobs da fila levam e-mail e nome
      queues: false,
    },
    tracesSampleRate: Number.isFinite(rate) ? Math.min(Math.max(rate, 0), 1) : 0.1,
    // A do Express põe um listener por middleware em cada resposta (aviso de
    // MaxListeners em todo request); o Nest já dá os spans e os erros vêm
    // pelo SentryInterceptor
    // LocalVariables copia variáveis da pilha no erro (senha, e-mail); Console
    // vira breadcrumb do log inteiro
    integrations: (defaults) => defaults.filter((i) => !DROPPED_INTEGRATIONS.includes(i.name)),
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
    // Spans vão em lote, fora da transação: limpeza própria
    beforeSendSpan: withStreamedSpan((span) => scrubStreamedSpan(span)),
  };
}

/** Acima disso a requisição vira aviso de "request lento" no Sentry */
export function slowRequestMs(env: NodeJS.ProcessEnv): number {
  const ms = Number(env.SENTRY_SLOW_REQUEST_MS ?? '2000');
  return Number.isFinite(ms) && ms > 0 ? ms : 2000;
}
