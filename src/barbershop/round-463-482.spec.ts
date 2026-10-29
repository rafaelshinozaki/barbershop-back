import { BadRequestException } from '@nestjs/common';
import { parseUserAgent } from '../auth/auth.service';
import { normalizePhoneToE164 } from '../common/phone.util';
import { geocodeBackfillWhere } from './geocoding.service';
import {
  assertMarketingCampaignInput,
  MARKETING_INACTIVE_DAYS_MESSAGE,
  MARKETING_WHATSAPP_PER_30_DAYS,
} from './barbershop.service';

describe('itens 463-482', () => {
  it('identificador de Android aparece como Android, e o Edge não vira Chrome', () => {
    const android =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
    expect(parseUserAgent(android)).toMatchObject({ os: 'Android', deviceType: 'Mobile', browser: 'Chrome' });
    const edge =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';
    expect(parseUserAgent(edge).browser).toBe('Edge');
  });

  it('inactiveDays negativo dá erro, e segmento desconhecido também', () => {
    expect(() => assertMarketingCampaignInput({ segment: 'INACTIVE', inactiveDays: -5, message: 'oi' })).toThrow(
      new BadRequestException(MARKETING_INACTIVE_DAYS_MESSAGE),
    );
    expect(() => assertMarketingCampaignInput({ segment: 'VIP', message: 'oi' })).toThrow(BadRequestException);
  });

  it('telefone sem dígito não vira E.164', () => {
    expect(normalizePhoneToE164('aaaaaaaa', '55')).toBeNull();
  });

  it('tentativa recente de geocoding fica fora do lote', () => {
    const now = new Date('2026-10-29T12:00:00Z');
    const where = geocodeBackfillWhere(now);
    const recent = new Date(now.getTime() - 86_400_000);
    const old = new Date(now.getTime() - 8 * 86_400_000);
    const window = (where.AND as { OR: Array<Record<string, unknown>> }[])[0].OR;
    expect(window).toEqual([
      { geocodeAttemptedAt: null },
      { geocodeAttemptedAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } },
    ]);
    expect(recent.getTime()).toBeGreaterThan((window[1].geocodeAttemptedAt as { lt: Date }).lt.getTime());
    expect(old.getTime()).toBeLessThan((window[1].geocodeAttemptedAt as { lt: Date }).lt.getTime());
    expect(MARKETING_WHATSAPP_PER_30_DAYS).toBe(5000);
  });
});
