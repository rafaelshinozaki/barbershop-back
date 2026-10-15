import { appointmentContactEmail } from './appointment-contact';

describe('appointment contact email', () => {
  it('prefere o e-mail digitado neste horário', () => {
    expect(
      appointmentContactEmail({
        contactEmail: ' agora@exemplo.com ',
        customer: { email: 'ficha@exemplo.com' },
      }),
    ).toBe('agora@exemplo.com');
  });

  it('usa a ficha quando este horário não tem e-mail', () => {
    expect(
      appointmentContactEmail({ contactEmail: '  ', customer: { email: 'ficha@exemplo.com' } }),
    ).toBe('ficha@exemplo.com');
    expect(appointmentContactEmail({ customer: { email: null } })).toBeNull();
  });
});
