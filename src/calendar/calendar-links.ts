import { appointmentManageUrl } from '../barbershop/appointment-link';
import { buildCalendar, googleCalendarUrl, IcsEvent, outlookCalendarUrl } from './ics';

// Evento de calendário do agendamento e os links "adicionar à agenda".
// Arquivo à parte (sem depender de BarbershopService) pra o serviço de
// agendamentos usar nos e-mails sem import circular.

export type AppointmentForEvent = {
  id: number;
  startAt: Date;
  endAt: Date;
  status: string;
  updatedAt: Date;
  linkVersion?: number;
  barbershop: { name: string; address: string; city: string; state: string };
  barber: { name: string };
  services: Array<{ service: { name: string } | null }>;
};

export function appointmentEvent(a: AppointmentForEvent): IcsEvent {
  const services = a.services
    .map((s) => s.service?.name)
    .filter(Boolean)
    .join(', ');
  const manage = appointmentManageUrl(a.id, a.linkVersion ?? 0);
  return {
    uid: `appointment-${a.id}@barbershop`,
    start: a.startAt,
    end: a.endAt,
    // O nome do serviço é o título do evento na agenda do cliente (a unidade
    // vai no local). Sem isso o Gmail chegava a chamar de "Consulta médica"
    summary: services || `Horário em ${a.barbershop.name}`,
    description: `Com ${a.barber.name}\nRemarcar ou cancelar: ${manage}`,
    location: `${a.barbershop.name}, ${a.barbershop.address}, ${a.barbershop.city} - ${a.barbershop.state}`,
    url: manage,
    // Remarcou: o app troca o evento (SEQUENCE maior vence)
    sequence: Math.floor(a.updatedAt.getTime() / 1000),
    updatedAt: a.updatedAt,
    cancelled: a.status === 'CANCELLED',
  };
}

/**
 * Convite do agendamento anexado aos e-mails (confirmação, remarcação,
 * lembrete e cancelamento). Mesmo UID do "adicionar à agenda": o app troca
 * o evento quando o horário muda e apaga quando é cancelado.
 */
export function appointmentInvite(
  a: AppointmentForEvent,
  customer: { name: string; email: string },
): { filename: string; content: string; contentType: string } {
  const from = process.env.EMAIL_FROM || 'noreply@barbershop.app';
  const cancelled = a.status === 'CANCELLED';
  const method = cancelled ? 'CANCEL' : 'REQUEST';
  const content = buildCalendar(
    [
      {
        ...appointmentEvent(a),
        organizer: { name: a.barbershop.name, email: from },
        attendee: customer,
      },
    ],
    { method },
  );
  return {
    filename: 'invite.ics',
    content,
    contentType: `text/calendar; charset=utf-8; method=${method}`,
  };
}

/** Links "adicionar à agenda" do agendamento (e-mails). */
export function appointmentCalendarLinks(a: AppointmentForEvent, token: string) {
  const event = appointmentEvent(a);
  const api = process.env.PUBLIC_API_URL?.replace(/\/$/, '');
  return {
    GoogleCalendarURL: googleCalendarUrl(event),
    OutlookCalendarURL: outlookCalendarUrl(event),
    // .ics precisa da URL pública da API (Apple, celular, outros apps)
    IcsURL: api ? `${api}/calendar/appointment.ics?t=${encodeURIComponent(token)}` : null,
  };
}
