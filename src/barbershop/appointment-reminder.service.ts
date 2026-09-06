import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class AppointmentReminderService {
  private readonly logger = new Logger(AppointmentReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * A cada 30 minutos, envia lembrete por e-mail para agendamentos que começam
   * dentro das próximas 24h e ainda não foram lembrados. WhatsApp fica para
   * uma integração futura com um provedor externo (não implementado agora).
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
        if (appt.customer.email) {
          const serviceNames = appt.services.map((s) => s.service?.name).filter(Boolean).join(', ');
          await this.emailService.sendCustomerEmail(
            appt.barbershop.ownerUserId ?? 0,
            'appointment_reminder',
            {
              CustomerName: appt.customer.name,
              BarbershopName: appt.barbershop.name,
              BarbershopAddress: `${appt.barbershop.address}, ${appt.barbershop.city} - ${appt.barbershop.state}`,
              BarbershopPhone: appt.barbershop.phone,
              ServiceNames: serviceNames || '-',
              AppointmentDate: appt.startAt.toLocaleDateString('pt-BR', { timeZone: appt.barbershop.timezone }),
              AppointmentTime: appt.startAt.toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: appt.barbershop.timezone,
              }),
              Year: new Date().getFullYear(),
            },
            `Lembrete: seu horário em ${appt.barbershop.name}`,
            'appointment-reminder',
            appt.customer.email,
          );
        } else {
          this.logger.warn(`Agendamento #${appt.id}: cliente sem e-mail, lembrete não enviado.`);
        }
      } catch (error) {
        this.logger.error(`Erro ao enviar lembrete do agendamento #${appt.id}:`, error);
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
