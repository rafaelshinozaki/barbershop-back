import {
  BadRequestException,
  HttpException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import { EmailService } from '@/email/email.service';
import { RedisService } from '@/redis/redis.service';
import { normalizeEmail } from '@/common/email';
import { LOGIN_CODE_MAX_ATTEMPTS } from '@/common';
import { supportEmail } from '../common/app-urls';

// Cadastro com senha (equipe e cliente): o e-mail é confirmado por código
// antes de a conta existir. O código prova que a pessoa tem a caixa de
// entrada, então vale para os dois cadastros do mesmo e-mail.
export const SIGNUP_CODE_EXPIRY_MINUTES = 15;
export const SIGNUP_CODE_RESEND_SECONDS = 60;
export const SIGNUP_CODE_INVALID_MESSAGE =
  'Invalid or expired email verification code. Request a new code.';
export const SIGNUP_CODE_WAIT_MESSAGE =
  'A code was just sent to this email. Wait a minute before requesting another.';

const KEY = {
  code: (email: string) => `auth:signup-code:${email}`,
  attempts: (email: string) => `auth:signup-code-attempts:${email}`,
  sent: (email: string) => `auth:signup-code-sent:${email}`,
};

export class SignupCodes {
  private readonly logger = new Logger(SignupCodes.name);

  constructor(
    private readonly redis: RedisService | undefined,
    private readonly emailService: EmailService,
  ) {}

  // O código não tem como funcionar sem o Redis: erro claro em vez da
  // mensagem interna do ioredis
  private async withRedis<T>(fn: (redis: RedisService) => Promise<T>): Promise<T> {
    try {
      if (!this.redis) throw new Error('Redis não configurado');
      return await fn(this.redis);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Redis indisponível: ${error.message}`);
      throw new ServiceUnavailableException(
        'Verification temporarily unavailable. Please try again in a few minutes.',
      );
    }
  }

  /**
   * Manda o código. Responde igual para e-mail com ou sem conta (o cadastro
   * em si é que recusa o duplicado, e só depois do código certo).
   */
  async send(rawEmail: string, lang = 'pt') {
    const email = normalizeEmail(rawEmail);
    if (!email) throw new BadRequestException('Invalid email');

    // Um envio por minuto para o mesmo e-mail: o endpoint é público e
    // mandaria e-mail para qualquer endereço quantas vezes quisessem
    const fresh = await this.withRedis((r) =>
      r.client.set(KEY.sent(email), '1', 'EX', SIGNUP_CODE_RESEND_SECONDS, 'NX'),
    );
    if (fresh !== 'OK') {
      throw new HttpException(SIGNUP_CODE_WAIT_MESSAGE, 429);
    }

    const code = randomInt(100000, 1000000).toString();
    // Código novo substitui o anterior e zera as tentativas
    await this.withRedis(async (r) => {
      await r.client.set(KEY.code(email), code, 'EX', SIGNUP_CODE_EXPIRY_MINUTES * 60);
      await r.client.del(KEY.attempts(email));
    });

    try {
      await this.emailService.sendCustomerEmail(
        null,
        'verification_code',
        {
          FullName: '',
          AppName: 'Barbershop',
          VerificationCode: code,
          SupportEmail: supportEmail(),
          Year: new Date().getFullYear(),
        },
        { pt: 'Código de verificação', en: 'Verification code', es: 'Código de verificación' },
        'signup-code',
        email,
        ['pt', 'en', 'es'].includes(lang) ? lang : 'pt',
      );
    } catch (error) {
      this.logger.error(`Failed to send signup code email: ${error.message}`);
      // Mesmo cuidado do código de login: o código só vai pro log fora de produção
      if (process.env.NODE_ENV !== 'production') {
        this.logger.warn(`DEVELOPMENT: signup code for ${email} is ${code}`);
      }
    }
    return true;
  }

  /**
   * Confere o código sem consumir (as validações do cadastro vêm depois e um
   * erro nelas, ex. senha fraca, não deve queimar o código). Erros contam
   * tentativas como no código de login; no limite o código some.
   */
  async check(rawEmail: string, code: string | undefined) {
    const email = normalizeEmail(rawEmail);
    const codeKey = KEY.code(email);
    const attemptsKey = KEY.attempts(email);
    if (!code || !/^\d{6}$/.test(code.trim())) {
      throw new BadRequestException(SIGNUP_CODE_INVALID_MESSAGE);
    }
    const stored = await this.withRedis(async (r) => {
      const used = Number((await r.client.get(attemptsKey)) ?? 0);
      if (used >= LOGIN_CODE_MAX_ATTEMPTS) {
        await r.client.del(codeKey, attemptsKey);
        return null;
      }
      return r.client.get(codeKey);
    });
    if (stored && stored === code.trim()) return;
    if (stored) {
      await this.withRedis(async (r) => {
        const n = await r.client.incr(attemptsKey);
        if (n === 1) {
          const ttl = await r.client.ttl(codeKey);
          if (ttl > 0) await r.client.expire(attemptsKey, ttl);
        }
        if (n >= LOGIN_CODE_MAX_ATTEMPTS) await r.client.del(codeKey, attemptsKey);
      });
    }
    throw new BadRequestException(SIGNUP_CODE_INVALID_MESSAGE);
  }

  /** Uso único: só o primeiro cadastro com o código certo o consome */
  async consume(rawEmail: string) {
    const email = normalizeEmail(rawEmail);
    const removed = await this.withRedis((r) => r.client.del(KEY.code(email)));
    // Dois cadastros simultâneos com o mesmo código: só um passa
    if (removed === 0) throw new BadRequestException(SIGNUP_CODE_INVALID_MESSAGE);
    await this.redis?.client.del(KEY.attempts(email), KEY.sent(email)).catch(() => undefined);
  }
}
