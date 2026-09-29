import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { GraphQLError } from 'graphql';
import { scrubEvent, scrubStreamedSpan, sentryOptions, slowRequestMs } from './sentry-options';
import { shouldReport } from './sentry.interceptor';

describe('Sentry', () => {
  it('sem SENTRY_DSN fica desligado; com ele, sem dado pessoal', () => {
    expect(sentryOptions({})).toBeUndefined();
    expect(sentryOptions({ SENTRY_DSN: '  ' })).toBeUndefined();
    const options = sentryOptions({
      SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/1',
      NODE_ENV: 'production',
      SENTRY_TRACES_SAMPLE_RATE: '5',
    });
    expect(options).toMatchObject({
      environment: 'production',
      tracesSampleRate: 1,
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpBodies: [],
        graphQL: { document: false, variables: false },
        databaseQueryData: false,
      },
    });
  });

  it('limpeza do evento: sem cookie, Authorization, corpo nem dados do usuário além do id', () => {
    const event = scrubEvent({
      request: {
        cookies: { Authentication: 'jwt' },
        data: '{"query":"mutation { login }","variables":{"password":"x"}}',
        headers: { Cookie: 'a=b', authorization: 'Bearer x', 'user-agent': 'UA' },
      },
      user: { id: 7, email: 'a@b.c', ip_address: '1.2.3.4' },
    });
    expect(event).toEqual({ request: { headers: { 'user-agent': 'UA' } }, user: { id: 7 } });
  });

  it('spans sem o texto do comando (chave do Redis leva e-mail)', () => {
    const event = scrubEvent({
      spans: [
        {
          data: { 'db.system': 'redis', 'db.query.text': 'del auth:login-fails:a@b.c' },
          attributes: { 'db.statement': 'select * from "User" where email = $1' },
        },
      ],
      contexts: { trace: { data: { 'db.query.text': 'get x' } } },
    });
    expect(JSON.stringify(event)).not.toContain('a@b.c');
    expect(event.spans?.[0].data).toEqual({ 'db.system': 'redis' });
    expect(event.contexts?.trace?.data).toEqual({});
  });

  it('span enviado em streaming também sai sem o comando', () => {
    const span = scrubStreamedSpan({
      name: 'exists',
      attributes: { 'db.system.name': 'redis', 'db.query.text': 'exists auth:login-blocked:a@b.c' },
    });
    expect(span.attributes).toEqual({ 'db.system.name': 'redis' });
  });

  it('integrações que copiam dado pessoal ficam de fora', () => {
    const options = sentryOptions({ SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/1' });
    const kept = (options?.integrations as (d: { name: string }[]) => { name: string }[])(
      ['Http', 'Express', 'LocalVariablesAsync', 'Console', 'Nest'].map((name) => ({ name })),
    ).map((i) => i.name);
    expect(kept).toEqual(['Http', 'Nest']);
  });

  it('erro esperado do usuário não vira alerta; bug sim', () => {
    expect(shouldReport(new BadRequestException())).toBe(false);
    expect(shouldReport(new ForbiddenException())).toBe(false);
    expect(shouldReport(new GraphQLError('x', { extensions: { code: 'BAD_USER_INPUT' } }))).toBe(
      false,
    );
    expect(shouldReport(new InternalServerErrorException())).toBe(true);
    expect(shouldReport(new TypeError('undefined is not a function'))).toBe(true);
    expect(shouldReport(new GraphQLError('x'))).toBe(true);
  });

  it('limite do request lento', () => {
    expect(slowRequestMs({})).toBe(2000);
    expect(slowRequestMs({ SENTRY_SLOW_REQUEST_MS: '800' })).toBe(800);
    expect(slowRequestMs({ SENTRY_SLOW_REQUEST_MS: 'x' })).toBe(2000);
  });
});
