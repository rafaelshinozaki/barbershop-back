import { buildSteps, canMark, shouldShow } from './onboarding';

describe('boas-vindas por cargo (regras)', () => {
  const now = new Date('2026-10-05T12:00:00Z');
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

  it('dono: passos conferidos pelos dados; receber pelo app é opcional', () => {
    const steps = buildSteps('owner', { services: true, hours: true }, ['publicPage']);
    expect(steps.map((s) => [s.id, s.done, s.optional])).toEqual([
      ['services', true, false],
      ['hours', true, false],
      ['team', false, false],
      ['publicPage', true, false],
      ['payments', false, true],
      ['firstAppointment', false, false],
    ]);
  });

  it('marcado à mão não vale para passo automático', () => {
    const steps = buildSteps('barber', {}, ['schedule', 'myPay']);
    expect(steps.find((s) => s.id === 'schedule')?.done).toBe(false);
    expect(steps.find((s) => s.id === 'myPay')?.done).toBe(true);
    expect(canMark('barber', 'myPay')).toBe(true);
    expect(canMark('barber', 'schedule')).toBe(false);
    expect(canMark('reception', 'reports')).toBe(false);
  });

  it('aparece só nos primeiros 30 dias, não dispensado e com obrigatório pendente', () => {
    const pending = buildSteps('basic', { schedule: true }, []);
    expect(shouldShow(pending, daysAgo(3), null, now)).toBe(true);
    expect(shouldShow(pending, daysAgo(31), null, now)).toBe(false);
    expect(shouldShow(pending, daysAgo(3), daysAgo(1), now)).toBe(false);
    // Só falta o opcional: some
    const onlyOptional = buildSteps(
      'owner',
      { services: true, hours: true, team: true, firstAppointment: true },
      ['publicPage'],
    );
    expect(shouldShow(onlyOptional, daysAgo(1), null, now)).toBe(false);
  });
});
