import { periodShare } from './payroll.service';
import { nextDateStr, zonedTimeToUtc } from '../common/timezone.util';

// Mesmas bordas do fechamento: início do dia e fim do último dia, no fuso da unidade
const range = (from: string, to: string, tz = 'America/Sao_Paulo') =>
  [
    zonedTimeToUtc(from, 0, tz),
    new Date(zonedTimeToUtc(nextDateStr(to), 0, tz).getTime() - 1),
  ] as const;

describe('fixo proporcional ao período fechado', () => {
  it('mensal: mês inteiro = 1; meio mês e um dia proporcionais; dois meses = 2', () => {
    expect(periodShare(...range('2026-08-01', '2026-08-31'), 'MONTHLY')).toBeCloseTo(1);
    expect(periodShare(...range('2026-09-01', '2026-09-15'), 'MONTHLY')).toBeCloseTo(0.5);
    expect(periodShare(...range('2026-10-01', '2026-10-01'), 'MONTHLY')).toBeCloseTo(1 / 31);
    expect(periodShare(...range('2026-08-01', '2026-09-30'), 'MONTHLY')).toBeCloseTo(2);
    // Fechar o mês dia a dia soma um salário, não 31
    let sum = 0;
    for (let d = 1; d <= 31; d++) {
      const day = `2026-10-${String(d).padStart(2, '0')}`;
      sum += periodShare(...range(day, day), 'MONTHLY');
    }
    expect(sum).toBeCloseTo(1);
  });

  it('semanal e quinzenal pelos dias', () => {
    expect(periodShare(...range('2026-08-03', '2026-08-09'), 'WEEKLY')).toBeCloseTo(1);
    expect(periodShare(...range('2026-08-03', '2026-08-16'), 'BIWEEKLY')).toBeCloseTo(1);
    expect(periodShare(...range('2026-08-03', '2026-08-16'), 'WEEKLY')).toBeCloseTo(2);
  });
});
