import { Logger } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';

describe('WhatsappService', () => {
  const config = {
    get: (key: string) => {
      if (key === 'WHATSAPP_ACCESS_TOKEN') return 'token';
      if (key === 'WHATSAPP_PHONE_NUMBER_ID') return '999';
      if (key === 'WHATSAPP_REMINDER_TEMPLATE_LANG') return 'pt_BR';
      return undefined;
    },
  };

  it('unidade em inglês usa o modelo en_US e o log não leva o telefone inteiro', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => '',
    } as Response);
    const service = new WhatsappService(config as never);
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await service.sendAppointmentReminder(
      '+14155551234',
      {
        customerName: 'Ana',
        serviceNames: 'Cut',
        barbershopName: 'Shop',
        date: '10/21/2026',
        time: '10:00 AM',
      },
      'en',
    );
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(body.template.language.code).toBe('en_US');
    expect(body.to).toBe('14155551234');
    const line = String(log.mock.calls[0][0]);
    expect(line).toContain('1234');
    expect(line).not.toContain('14155551234');
    expect(line).not.toContain('+14155551234');
  });
});
