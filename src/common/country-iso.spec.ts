import { BadRequestException } from '@nestjs/common';
import { countryIso } from './place-locale';
import { callingCodeForCountry } from './phone.util';
import { langForCountry } from '../email/language';
import { normalizeShopTexts, SHOP_COUNTRY_INVALID_MESSAGE } from '../barbershop/barbershop.service';

describe('país da unidade como código ISO (item 267)', () => {
  it('o nome vira o código; o que não é país é recusado', () => {
    expect(countryIso('Brasil')).toBe('BR');
    expect(countryIso(' brazil ')).toBe('BR');
    expect(countryIso('pt')).toBe('PT');
    expect(countryIso('Narnia')).toBeNull();
    expect(normalizeShopTexts({ country: 'Brasil' }, false).country).toBe('BR');
    expect(() => normalizeShopTexts({ country: 'Narnia' }, false)).toThrow(
      new BadRequestException(SHOP_COUNTRY_INVALID_MESSAGE),
    );
  });

  it('unidade antiga gravada com o nome tem WhatsApp e e-mail em português', () => {
    expect(callingCodeForCountry('Brasil')).toBe('55');
    expect(langForCountry('Brasil')).toBe('pt');
    expect(langForCountry('México')).toBe('es');
    expect(langForCountry('US')).toBe('en');
  });
});
