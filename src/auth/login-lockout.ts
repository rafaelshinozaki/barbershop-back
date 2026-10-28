import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { LOGIN_BLOCK_MINUTES, LOGIN_MAX_ATTEMPTS } from '@/common/contants';
import { normalizeEmail } from '@/common/email';

/**
 * Bloqueio por tentativas de senha da conta da equipe, por e-mail. Vale para
 * o login da equipe e para o login do cliente que confere a senha da equipe
 * (item 484): antes o segundo só tinha limite por IP, e com vários IPs dava
 * pra chutar a senha de dono e gerente por ali.
 *
 * Conta falhas por e-mail; na LOGIN_MAX_ATTEMPTS-ésima dentro da janela,
 * bloqueia por LOGIN_BLOCK_MINUTES. As chaves expiram sozinhas. Com o Redis
 * fora, o login por senha continua funcionando — só o contador fica
 * suspenso (logado). Derrubar o login de todo mundo seria pior.
 */
export const LOGIN_LOCKOUT_KEY = {
  fails: (email: string) => `auth:login-fails:${email}`,
  blocked: (email: string) => `auth:login-blocked:${email}`,
};

const logger = new Logger('LoginLockout');
const key = normalizeEmail;

export async function isLoginBlocked(redis: Redis, email: string): Promise<boolean> {
  try {
    return (await redis.exists(LOGIN_LOCKOUT_KEY.blocked(key(email)))) === 1;
  } catch (error) {
    logger.error(`Redis indisponível (bloqueio de login ignorado): ${(error as Error).message}`);
    return false;
  }
}

export async function recordFailedLogin(redis: Redis, email: string) {
  const failsKey = LOGIN_LOCKOUT_KEY.fails(key(email));
  try {
    const fails = await redis.incr(failsKey);
    if (fails === 1) await redis.expire(failsKey, LOGIN_BLOCK_MINUTES * 60);
    if (fails >= LOGIN_MAX_ATTEMPTS) {
      await redis
        .multi()
        .set(LOGIN_LOCKOUT_KEY.blocked(key(email)), '1', 'EX', LOGIN_BLOCK_MINUTES * 60)
        .del(failsKey)
        .exec();
    }
  } catch (error) {
    logger.error(
      `Redis indisponível (tentativa de login não contada): ${(error as Error).message}`,
    );
  }
}

/** Senha certa: zera o contador deste e-mail */
export async function clearFailedLogins(redis: Redis, email: string) {
  await redis.del(LOGIN_LOCKOUT_KEY.fails(key(email))).catch(() => undefined);
}
