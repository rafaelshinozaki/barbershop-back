import { phoneDigitVariants } from './phone.util';

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
