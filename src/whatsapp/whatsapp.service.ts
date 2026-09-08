import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface AppointmentReminderParams {
  customerName: string;
  serviceNames: string;
  barbershopName: string;
  date: string;
  time: string;
}

// Integração com a WhatsApp Cloud API (Meta), direto — sem Twilio no meio.
// Mensagem de negócio pra cliente fora da janela de atendimento (lembrete
// de agendamento) exige um "template" pré-aprovado pela Meta; não dá pra
// criar/aprovar isso por código, precisa ser submetido no Meta Business
// Manager. Ver .env.example pro texto sugerido do template.
//
// Sem as credenciais configuradas, o serviço fica "desligado" (isConfigured
// retorna false) e quem chama (AppointmentReminderService) simplesmente pula
// o envio por WhatsApp, mantendo só o lembrete por e-mail — nada quebra pra
// quem ainda não configurou.
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return !!(this.config.get<string>('WHATSAPP_ACCESS_TOKEN') && this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID'));
  }

  async sendAppointmentReminder(to: string, params: AppointmentReminderParams): Promise<void> {
    const templateName = this.config.get<string>('WHATSAPP_REMINDER_TEMPLATE_NAME') || 'appointment_reminder';
    const languageCode = this.config.get<string>('WHATSAPP_REMINDER_TEMPLATE_LANG') || 'pt_BR';
    await this.sendTemplateMessage(to, templateName, languageCode, [
      params.customerName,
      params.serviceNames,
      params.barbershopName,
      params.date,
      params.time,
    ]);
  }

  private async sendTemplateMessage(
    to: string,
    templateName: string,
    languageCode: string,
    bodyParams: string[],
  ): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('WhatsApp não configurado (faltam WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID)');
    }
    const phoneNumberId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const accessToken = this.config.get<string>('WHATSAPP_ACCESS_TOKEN');
    const apiVersion = this.config.get<string>('WHATSAPP_API_VERSION') || 'v21.0';
    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        // A Cloud API espera o número sem o "+" (só dígitos, com DDI) no
        // campo "to", mesmo formatando com "+" em outros lugares como E.164.
        to: to.replace(/^\+/, ''),
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode },
          components: [
            {
              type: 'body',
              parameters: bodyParams.map((text) => ({ type: 'text', text })),
            },
          ],
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`WhatsApp API respondeu ${response.status}: ${errorBody}`);
    }
    this.logger.log(`Mensagem de WhatsApp (${templateName}) enviada para ${to}`);
  }
}
