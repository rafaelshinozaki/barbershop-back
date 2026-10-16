import { WORK_MINIMUM_AGE, completedYears } from './work-age';

describe('completedYears', () => {
  const today = new Date(2026, 9, 16);

  it('31/12/2013 em outubro de 2026 ainda não fez 13', () => {
    expect(completedYears('2013-12-31', today)).toBe(12);
  });

  it('faz a idade mínima no dia do aniversário', () => {
    expect(completedYears('2010-10-16', today)).toBe(WORK_MINIMUM_AGE);
    expect(completedYears('2010-10-17', today)).toBe(WORK_MINIMUM_AGE - 1);
  });

  it('recusa dia que não existe', () => {
    expect(completedYears('2010-02-31', today)).toBeNull();
    expect(completedYears('não é data', today)).toBeNull();
  });
});
