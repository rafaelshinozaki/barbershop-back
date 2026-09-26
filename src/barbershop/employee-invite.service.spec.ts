import { EmployeeInviteService } from './employee-invite.service';

/**
 * O convidado ainda não tem conta: o e-mail de convite sai na língua do
 * país da unidade, não na de quem convidou.
 */
describe('EmployeeInviteService — idioma do convite', () => {
  const sent: unknown[][] = [];
  const service = new EmployeeInviteService(
    {} as never,
    {
      sendCustomerEmail: async (...args: unknown[]) => {
        sent.push(args);
      },
    } as never,
    { get: () => 'https://app.test' } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const send = (country: string, role = 'BarbershopBarber', staffType?: string) =>
    (
      service as unknown as { sendEmployeeInviteEmail: (i: unknown) => Promise<void> }
    ).sendEmployeeInviteEmail({
      inviterId: 7,
      inviteToken: 'tok',
      role,
      email: 'novo@x.com',
      inviter: { fullName: 'Dono' },
      barbershop: { name: 'Green', country },
      barber: staffType ? { staffType } : undefined,
    });

  beforeEach(() => (sent.length = 0));

  it.each([
    ['BR', 'pt'],
    ['MX', 'es'],
    ['US', 'en'],
  ])('unidade em %s → e-mail em %s', async (country, lang) => {
    await send(country);
    const [userId, template, , , , to, sentLang] = sent[0];
    expect({ userId, template, to, sentLang }).toEqual({
      userId: 7,
      template: 'employee_invite',
      to: 'novo@x.com',
      sentLang: lang,
    });
  });

  it('manda cargo e assunto nos 3 idiomas (o EmailService escolhe)', async () => {
    await send('MX', 'BarbershopManager');
    const [, , context, subject] = sent[0] as [unknown, unknown, { RoleLabel: unknown }, unknown];
    expect(context.RoleLabel).toEqual({ pt: 'Gerente', en: 'Manager', es: 'Gerente' });
    expect(subject).toEqual({
      pt: 'Convite para ser Gerente na Green',
      en: 'Invitation to join Green as Manager',
      es: 'Invitación para ser Gerente en Green',
    });
  });

  it.each([
    ['reception', { pt: 'Recepcionista', en: 'Receptionist', es: 'Recepcionista' }],
    ['basic', { pt: 'Profissional básico', en: 'Basic professional', es: 'Profesional básico' }],
    ['barber', { pt: 'Profissional', en: 'Professional', es: 'Profesional' }],
  ])('cargo %s aparece com o nome certo no convite', async (staffType, label) => {
    await send('BR', 'BarbershopEmployee', staffType);
    const [, , context] = sent[0] as [unknown, unknown, { RoleLabel: unknown }];
    expect(context.RoleLabel).toEqual(label);
  });
});
