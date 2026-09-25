import { dueDateOf, dueReached } from './chair-rent.service';

// 23h30 de 24/09 em São Paulo = 02h30 de 25/09 em UTC: o vencimento do
// aluguel é "hoje" no calendário do espaço, não no do servidor
describe('vencimento do aluguel no fuso do espaço', () => {
  const lateNightSP = new Date('2026-09-25T02:30:00Z');
  const SP = 'America/Sao_Paulo';

  it('o dia do vencimento é o do espaço', () => {
    expect(dueDateOf(lateNightSP, SP).toISOString()).toBe('2026-09-24T12:00:00.000Z');
    expect(dueDateOf(lateNightSP, 'UTC').toISOString()).toBe('2026-09-25T12:00:00.000Z');
  });

  it('vence no começo do dia do espaço, não ao meio-dia UTC', () => {
    expect(dueReached(new Date('2026-09-24T12:00:00Z'), SP, lateNightSP)).toBe(true);
    expect(dueReached(new Date('2026-09-25T12:00:00Z'), SP, lateNightSP)).toBe(false);
    expect(dueReached(new Date('2026-09-25T12:00:00Z'), SP, new Date('2026-09-25T03:01:00Z'))).toBe(
      true,
    );
  });
});
