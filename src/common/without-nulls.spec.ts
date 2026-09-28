import { withoutNulls } from './without-nulls';

describe('withoutNulls', () => {
  it('tira só os campos null; mantém falsy e undefined', () => {
    const result = withoutNulls({
      name: null,
      description: 'x',
      value: 0,
      isActive: false,
      code: '',
      maxUses: undefined,
    });
    expect(result).toEqual({
      description: 'x',
      value: 0,
      isActive: false,
      code: '',
      maxUses: undefined,
    });
    expect('name' in result).toBe(false);
  });
});
