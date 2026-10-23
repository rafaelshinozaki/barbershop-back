import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeLang, type Lang } from '../email/language';

export interface AppointmentReminderParams {
  customerName: string;
  serviceNames: string;
  barbershopName: string;
  date: string;
  time: string;
}

export interface WaitlistSlotAvailableParams {
  customerName: string;
  barbershopName: string;
  date: string;
  time: string;
}

/** O mesmo nome de modelo existe em cada idioma aprovado na Meta. */
const TEMPLATE_LANG: Record<Lang, string> = { pt: 'pt_BR', en: 'en_US', es: 'es_ES' };

function templateLang(lang?: string | null): string {
  return TEMPLATE_LANG[normalizeLang(lang)];
}

/** O log não guarda o telefone inteiro do cliente. */
function maskPhone(to: string): string {
  const digits = to.replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return `+${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
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
    return !!(
      this.config.get<string>('WHATSAPP_ACCESS_TOKEN') &&
      this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID')
    );
  }

  async sendAppointmentReminder(
    to: string,
    params: AppointmentReminderParams,
    lang?: string | null,
  ): Promise<void> {
    const templateName =
      this.config.get<string>('WHATSAPP_REMINDER_TEMPLATE_NAME') || 'appointment_reminder';
    await this.sendTemplateMessage(to, templateName, templateLang(lang), [
      params.customerName,
      params.serviceNames,
      params.barbershopName,
      params.date,
      params.time,
    ]);
  }

  async sendWaitlistSlotAvailable(
    to: string,
    params: WaitlistSlotAvailableParams,
    lang?: string | null,
  ): Promise<void> {
    const templateName =
      this.config.get<string>('WHATSAPP_WAITLIST_TEMPLATE_NAME') || 'waitlist_slot_available';
    await this.sendTemplateMessage(to, templateName, templateLang(lang), [
      params.customerName,
      params.barbershopName,
      params.date,
      params.time,
    ]);
  }

  // Campanha de marketing (Message Blast) — texto livre que o staff escreve
  // vira o único parâmetro do corpo de um template genérico pré-aprovado
  // (a Cloud API não aceita texto livre puro pra mensagem de negócio fora
  // da janela de atendimento, só templates).
  async sendMarketingBlast(to: string, message: string, lang?: string | null): Promise<void> {
    const templateName =
      this.config.get<string>('WHATSAPP_MARKETING_TEMPLATE_NAME') || 'marketing_blast';
    await this.sendTemplateMessage(to, templateName, templateLang(lang), [message]);
  }

  /**
   * Resposta dentro da janela de 24 h (a pessoa acabou de escrever).
   * Texto livre, sem modelo. Sem credencial, não faz nada.
   */
  async sendSessionText(to: string, body: string): Promise<void> {
    if (!this.isConfigured()) return;
    await this.postMessage({
      messaging_product: 'whatsapp',
      to: to.replace(/^\+/, ''),
      type: 'text',
      text: { body, preview_url: false },
    });
    this.logger.log(`Resposta de WhatsApp enviada para ${maskPhone(to)}`);
  }

  private async sendTemplateMessage(
    to: string,
    templateName: string,
    languageCode: string,
    bodyParams: string[],
  ): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error(
        'WhatsApp não configurado (faltam WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID)',
      );
    }
    await this.postMessage({
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
    });
    this.logger.log(`Mensagem de WhatsApp (${templateName}) enviada para ${maskPhone(to)}`);
  }

  private async postMessage(payload: Record<string, unknown>): Promise<void> {
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
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`WhatsApp API respondeu ${response.status}: ${errorBody}`);
    }
  }
}
