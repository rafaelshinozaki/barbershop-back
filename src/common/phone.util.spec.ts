import { phoneDigitVariants, phoneForWhatsapp } from './phone.util';

describe('phoneDigitVariants', () => {
  it('o mesmo telefone escrito de jeitos diferentes tem variantes em comum', () => {
    const a = phoneDigitVariants('(11) 99999-0000');
    const b = phoneDigitVariants('+55 11 99999-0000');
    const c = phoneDigitVariants('11999990000');
    expect(a).toEqual(expect.arrayContaining(['11999990000', '5511999990000']));
    expect(b).toEqual(expect.arrayContaining(['11999990000', '5511999990000']));
    expect(c).toEqual(expect.arrayContaining(['11999990000', '5511999990000']));
  });

  it('vazio não acha nada', () => {
    expect(phoneDigitVariants('')).toEqual([]);
    expect(phoneDigitVariants(null)).toEqual([]);
  });
});

describe('WhatsApp no país da unidade', () => {
  it('unidade dos EUA usa o DDI 1', () => {
    expect(phoneForWhatsapp('415 555 1234', 'US')).toBe('+14155551234');
    expect(phoneForWhatsapp('+1 415 555 1234', 'US')).toBe('+14155551234');
    expect(phoneForWhatsapp('14155551234', 'US')).toBe('+14155551234');
  });

  it('número brasileiro sem DDI não sai para uma unidade dos EUA', () => {
    expect(phoneForWhatsapp('11999990000', 'US')).toBeNull();
    expect(phoneForWhatsapp('415555', 'US')).toBeNull();
  });

  it('unidade do Brasil continua com o DDI 55', () => {
    expect(phoneForWhatsapp('(11) 99999-0000', 'BR')).toBe('+5511999990000');
    expect(phoneForWhatsapp('+55 11 99999-0000', 'BR')).toBe('+5511999990000');
  });

  it('número dos EUA com o 1 na frente chega numa unidade do Brasil', () => {
    expect(phoneForWhatsapp('1 415 555 1234', 'BR')).toBe('+14155551234');
    expect(phoneForWhatsapp('+1 415 555 1234', 'BR')).toBe('+14155551234');
  });

  it('dez dígitos sem DDI numa unidade do Brasil não vai para Curitiba nem para os EUA', () => {
    expect(phoneForWhatsapp('415 555 1234', 'BR')).toBeNull();
    expect(phoneForWhatsapp('41 3333-4444', 'BR')).toBeNull();
  });

  it('país desconhecido não recebe WhatsApp', () => {
    expect(phoneForWhatsapp('4155551234', 'ZZ')).toBeNull();
    expect(phoneForWhatsapp('11999990000', null)).toBeNull();
  });
});
