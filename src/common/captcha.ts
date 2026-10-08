import { BadRequestException } from '@nestjs/common';

/**
 * reCAPTCHA do "Fale com a gente". Sem `RECAPTCHA_SECRET_KEY` (dev e teste)
 * o pedido segue; com a chave, o token é obrigatório e conferido no Google.
 */
type CaptchaFetch = (
  url: string,
  init?: RequestInit,
) => Promise<{ json: () => Promise<{ success?: boolean }> }>;

export async function assertCaptcha(
  token: string | null | undefined,
  fetchImpl: CaptchaFetch = fetch,
): Promise<void> {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) return;
  if (!token?.trim()) throw new BadRequestException('Confirme que você não é um robô.');
  const res = await fetchImpl('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: token }),
  });
  const data = (await res.json()) as { success?: boolean };
  if (!data.success) throw new BadRequestException('Captcha inválido.');
}
