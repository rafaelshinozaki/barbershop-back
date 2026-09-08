import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { normalizePhoneToE164 } from '../common/phone.util';

@Injectable()
export class AppointmentReminderService {
  private readonly logger = new Logger(AppointmentReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly whatsappService: WhatsappService,
  ) {}

  /**
   * A cada 30 minutos, envia lembrete por e-mail e (se configurado) por
   * WhatsApp para agendamentos que começam dentro das próximas 24h e ainda
   * não foram lembrados. Os dois canais são independentes — falha em um não
   * afeta o outro, e o WhatsApp só é tentado se WHATSAPP_ACCESS_TOKEN/
   * WHATSAPP_PHONE_NUMBER_ID estiverem configurados (ver .env.example).
   */
  @Cron(CronExpression.EVERY_30_MINUTES, {
    name: 'send-appointment-reminders',
    timeZone: 'America/Sao_Paulo',
  })
  async handleAppointmentReminders() {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const appointments = await this.prisma.appointment.findMany({
      where: {
        status: 'CONFIRMED',
        reminderSentAt: null,
        startAt: { gte: now, lte: windowEnd },
      },
      include: {
        customer: true,
        barbershop: true,
        services: { include: { service: true } },
      },
    });

    if (appointments.length === 0) return;
    this.logger.log(`Enviando lembrete para ${appointments.length} agendamento(s)...`);

    for (const appt of appointments) {
      try {
        const serviceNames = appt.services.map((s) => s.service?.name).filter(Boolean).join(', ');
        const appointmentDate = appt.startAt.toLocaleDateString('pt-BR', { timeZone: appt.barbershop.timezone });
        const appointmentTime = appt.startAt.toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: appt.barbershop.timezone,
        });

        if (appt.customer.email) {
          try {
            await this.emailService.sendCustomerEmail(
              appt.barbershop.ownerUserId ?? 0,
              'appointment_reminder',
              {
                CustomerName: appt.customer.name,
                BarbershopName: appt.barbershop.name,
                BarbershopAddress: `${appt.barbershop.address}, ${appt.barbershop.city} - ${appt.barbershop.state}`,
                BarbershopPhone: appt.barbershop.phone,
                ServiceNames: serviceNames || '-',
                AppointmentDate: appointmentDate,
                AppointmentTime: appointmentTime,
                Year: new Date().getFullYear(),
              },
              `Lembrete: seu horário em ${appt.barbershop.name}`,
              'appointment-reminder',
              appt.customer.email,
            );
          } catch (emailError) {
            this.logger.error(`Erro ao enviar lembrete por e-mail do agendamento #${appt.id}:`, emailError);
          }
        } else {
          this.logger.warn(`Agendamento #${appt.id}: cliente sem e-mail, lembrete por e-mail não enviado.`);
        }

        if (this.whatsappService.isConfigured()) {
          const phone = normalizePhoneToE164(appt.customer.phone);
          if (phone) {
            try {
              await this.whatsappService.sendAppointmentReminder(phone, {
                customerName: appt.customer.name,
                serviceNames: serviceNames || '-',
                barbershopName: appt.barbershop.name,
                date: appointmentDate,
                time: appointmentTime,
              });
            } catch (whatsappError) {
              this.logger.error(`Erro ao enviar lembrete por WhatsApp do agendamento #${appt.id}:`, whatsappError);
            }
          } else {
            this.logger.warn(`Agendamento #${appt.id}: telefone do cliente não normalizável para WhatsApp.`);
          }
        }
      } catch (error) {
        this.logger.error(`Erro ao processar lembrete do agendamento #${appt.id}:`, error);
      } finally {
        // Marca como processado mesmo em caso de falha/sem e-mail, para não
        // reprocessar o mesmo agendamento a cada execução do cron.
        await this.prisma.appointment.update({
          where: { id: appt.id },
          data: { reminderSentAt: new Date() },
        });
      }
    }
  }
}
