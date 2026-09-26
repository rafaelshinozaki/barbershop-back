import { shiftsOverlap } from './professional';

describe('shiftsOverlap', () => {
  it('cruza turnos que se encontram no meio', () => {
    expect(shiftsOverlap('09:00', '12:00', '11:00', '14:00')).toBe(true);
    expect(shiftsOverlap('11:00', '14:00', '09:00', '12:00')).toBe(true);
  });

  it('encostar o fim no começo do outro não é sobreposição', () => {
    expect(shiftsOverlap('09:00', '12:00', '12:00', '18:00')).toBe(false);
    expect(shiftsOverlap('14:00', '18:00', '09:00', '14:00')).toBe(false);
  });
});
