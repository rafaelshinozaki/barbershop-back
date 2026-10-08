import { closureAffectsAppointment } from './closure.service';

describe('closureAffectsAppointment', () => {
  const tz = 'America/Sao_Paulo';
  const now = new Date('2026-10-08T15:00:00-03:00');
  const earlier = new Date('2026-10-08T09:00:00-03:00');
  const earlierEnd = new Date('2026-10-08T09:30:00-03:00');
  const later = new Date('2026-10-08T16:00:00-03:00');
  const laterEnd = new Date('2026-10-08T16:30:00-03:00');

  it('não cancela atendimento confirmado que já começou', () => {
    expect(
      closureAffectsAppointment('CONFIRMED', earlier, earlierEnd, now, tz, null, null),
    ).toBe(false);
    expect(closureAffectsAppointment('CONFIRMED', later, laterEnd, now, tz, null, null)).toBe(
      true,
    );
  });

  it('expira a reserva de sinal mesmo de um horário que já passou', () => {
    expect(
      closureAffectsAppointment('PENDING_PAYMENT', earlier, earlierEnd, now, tz, null, null),
    ).toBe(true);
  });

  it('horário especial só pega quem fica de fora da janela', () => {
    expect(
      closureAffectsAppointment('CONFIRMED', later, laterEnd, now, tz, '14:00', '18:00'),
    ).toBe(false);
    const morning = new Date('2026-10-08T18:30:00-03:00');
    expect(
      closureAffectsAppointment(
        'CONFIRMED',
        morning,
        new Date('2026-10-08T19:00:00-03:00'),
        now,
        tz,
        '14:00',
        '18:00',
      ),
    ).toBe(true);
  });
});
