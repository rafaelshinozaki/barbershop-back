import { appointmentLinkMode, createAppointmentToken, createReviewToken } from './appointment-link';

process.env.JWT_SECRET ??= 'appointment-link-test';

const appt = {
  id: 10,
  endAt: new Date('2026-10-20T15:00:00Z'),
  linkVersion: 1,
};
const now = new Date('2026-10-16T12:00:00Z');

describe('appointmentLinkMode', () => {
  it('a versão atual abre para gerenciar', () => {
    expect(appointmentLinkMode(createAppointmentToken(10, 1), 'appointment-manage', appt, now)).toBe(
      'current',
    );
  });

  it('a versão de antes do cancelamento abre só para consulta', () => {
    expect(appointmentLinkMode(createAppointmentToken(10, 0), 'appointment-manage', appt, now)).toBe(
      'previous',
    );
  });

  it('uma versão mais antiga não abre', () => {
    expect(
      appointmentLinkMode(createAppointmentToken(10, 0), 'appointment-manage', { ...appt, linkVersion: 2 }, now),
    ).toBeNull();
  });

  it('o link de avaliação não aceita a versão anterior', () => {
    expect(appointmentLinkMode(createReviewToken(10, 0), 'appointment-review', appt, now)).toBeNull();
  });

  it('passado o prazo, nem a versão anterior abre', () => {
    const late = new Date('2026-12-20T15:00:00Z');
    expect(appointmentLinkMode(createAppointmentToken(10, 0), 'appointment-manage', appt, late)).toBeNull();
  });
});
