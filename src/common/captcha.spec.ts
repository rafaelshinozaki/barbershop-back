import { BadRequestException } from '@nestjs/common';
import { assertCaptcha } from './captcha';

describe('assertCaptcha', () => {
  const previous = process.env.RECAPTCHA_SECRET_KEY;

  afterEach(() => {
    if (previous === undefined) delete process.env.RECAPTCHA_SECRET_KEY;
    else process.env.RECAPTCHA_SECRET_KEY = previous;
  });

  it('sem chave configurada, não exige token', async () => {
    delete process.env.RECAPTCHA_SECRET_KEY;
    await expect(assertCaptcha(null)).resolves.toBeUndefined();
  });

  it('com chave, recusa token ausente ou recusado pelo Google', async () => {
    process.env.RECAPTCHA_SECRET_KEY = 'segredo';
    await expect(assertCaptcha('  ')).rejects.toBeInstanceOf(BadRequestException);
    const fetchImpl = async () => ({ json: async () => ({ success: false }) });
    await expect(assertCaptcha('tok', fetchImpl)).rejects.toBeInstanceOf(BadRequestException);
    const ok = async () => ({ json: async () => ({ success: true }) });
    await expect(assertCaptcha('tok', ok)).resolves.toBeUndefined();
  });
});
