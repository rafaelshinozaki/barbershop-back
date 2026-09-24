import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { langForCountry, LOCALE } from '../email/language';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationQueueService } from '../queue/notification-queue.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { normalizePhoneToE164 } from '../common/phone.util';
import { APPOINTMENT_REMINDERS_QUEUE } from '../queue/queue.constants';
import { registerSchedulers } from '../queue/register-schedulers';
import { appointmentManageUrl } from './appointment-link';
import { ReviewRequestService } from './review-request.service';
import type { Job } from 'bullmq';

// Quantos agendamentos processa por execução — o resto fica pra próxima
// (a cada 5 min), sem carregar milhares de linhas de uma vez
const BATCH_SIZE = 500;

@Injectable()
export class AppointmentReminderService {
  private readonly logger = new Logger(AppointmentReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationQueue: NotificationQueueService,
    private readonly whatsappService: WhatsappService,
  ) {}

  /**
   * Enfileira lembrete (e-mail e, se configurado, WhatsApp) dos agendamentos
   * que começam nas próximas 24h e ainda não foram lembrados.
   *
   * Antes enviava um por um dentro do cron e marcava como lembrado mesmo se
   * o envio falhasse — quem pegava uma instabilidade do Mailgun nunca
   * recebia. Agora cada agendamento é "reservado" com um update condicional
   * (reminderSentAt ainda null), então duas execuções simultâneas nunca
   * enviam o mesmo lembrete, e o envio em si fica na fila com novas
   * tentativas.
   */
  async enqueueDueReminders() {
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
        barbershop: { include: { network: { select: { lateCancellationWindowHours: true } } } },
        services: { include: { service: true } },
      },
      orderBy: { startAt: 'asc' },
      take: BATCH_SIZE,
    });
    if (appointments.length === 0) return 0;

    let enqueued = 0;
    for (const appt of appointments) {
      const claimed = await this.prisma.appointment.updateMany({
        where: { id: appt.id, reminderSentAt: null },
        data: { reminderSentAt: new Date() },
      });
      if (claimed.count === 0) continue; // outra execução já pegou

      const serviceNames =
        appt.services
          .map((s) => s.service?.name)
          .filter(Boolean)
          .join(', ') || '-';
      // Cliente não tem idioma salvo: língua do país da unidade
      const lang = langForCountry(appt.barbershop.country);
      const appointmentDate = appt.startAt.toLocaleDateString(LOCALE[lang], {
        timeZone: appt.barbershop.timezone,
      });
      const appointmentTime = appt.startAt.toLocaleTimeString(LOCALE[lang], {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: appt.barbershop.timezone,
      });

      try {
        if (appt.customer.email) {
          await this.notificationQueue.email(
            {
              kind: 'customer',
              loggedAgainstUserId: appt.barbershop.ownerUserId ?? 0,
              template: 'appointment_reminder',
              context: {
                CustomerName: appt.customer.name,
                BarbershopName: appt.barbershop.name,
                BarbershopAddress: `${appt.barbershop.address}, ${appt.barbershop.city} - ${appt.barbershop.state}`,
                BarbershopPhone: appt.barbershop.phone,
                ServiceNames: serviceNames,
                AppointmentDate: appointmentDate,
                AppointmentTime: appointmentTime,
                // Link pra cancelar/remarcar sem login (até a janela da política)
                CancellationWindowHours: appt.barbershop.network.lateCancellationWindowHours,
                ManageURL: appointmentManageUrl(appt.id),
                Year: new Date().getFullYear(),
              },
              subject: {
                pt: `Lembrete: seu horário em ${appt.barbershop.name}`,
                en: `Reminder: your appointment at ${appt.barbershop.name}`,
                es: `Recordatorio: tu cita en ${appt.barbershop.name}`,
              },
              lang,
              meta: 'appointment-reminder',
              to: appt.customer.email,
            },
            `appointment-reminder-email-${appt.id}`,
          );
        }

        const phone = this.whatsappService.isConfigured()
          ? normalizePhoneToE164(appt.customer.phone)
          : null;
        if (phone) {
          await this.notificationQueue.whatsapp(
            {
              kind: 'appointment-reminder',
              to: phone,
              params: {
                customerName: appt.customer.name,
                serviceNames,
                barbershopName: appt.barbershop.name,
                date: appointmentDate,
                time: appointmentTime,
              },
            },
            `appointment-reminder-whatsapp-${appt.id}`,
          );
        }
        enqueued++;
      } catch (error) {
        // Não conseguiu nem enfileirar (Redis fora): libera a reserva pra
        // próxima execução tentar de novo
        this.logger.error(`Erro ao enfileirar lembrete do agendamento #${appt.id}:`, error);
        await this.prisma.appointment
          .update({ where: { id: appt.id }, data: { reminderSentAt: null } })
          .catch(() => undefined);
      }
    }

    this.logger.log(`Lembretes enfileirados: ${enqueued}`);
    return enqueued;
  }
}

/** Registra a execução periódica — uma só no cluster, não uma por instância. */
@Injectable()
export class AppointmentReminderScheduler implements OnModuleInit {
  constructor(@InjectQueue(APPOINTMENT_REMINDERS_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    registerSchedulers(this.queue, [
      { id: 'enqueue-due-reminders', repeat: { every: 5 * 60 * 1000 } },
      // "Como foi?" depois do atendimento (ver ReviewRequestService)
      { id: 'enqueue-review-requests', repeat: { every: 15 * 60 * 1000 } },
    ]);
  }
}

@Processor(APPOINTMENT_REMINDERS_QUEUE)
export class AppointmentReminderProcessor extends WorkerHost {
  constructor(
    private readonly reminders: AppointmentReminderService,
    private readonly reviewRequests: ReviewRequestService,
  ) {
    super();
  }

  async process(job: Job) {
    if (job.name === 'enqueue-review-requests') return this.reviewRequests.enqueueDueRequests();
    return this.reminders.enqueueDueReminders();
  }
}
