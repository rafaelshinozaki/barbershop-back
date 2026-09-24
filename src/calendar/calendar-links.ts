import { appointmentManageUrl } from '../barbershop/appointment-link';
import { googleCalendarUrl, IcsEvent, outlookCalendarUrl } from './ics';

// Evento de calendário do agendamento e os links "adicionar à agenda".
// Arquivo à parte (sem depender de BarbershopService) pra o serviço de
// agendamentos usar nos e-mails sem import circular.

export type AppointmentForEvent = {
  id: number;
  startAt: Date;
  endAt: Date;
  status: string;
  updatedAt: Date;
  barbershop: { name: string; address: string; city: string; state: string };
  barber: { name: string };
  services: Array<{ service: { name: string } | null }>;
};

export function appointmentEvent(a: AppointmentForEvent): IcsEvent {
  const services = a.services
    .map((s) => s.service?.name)
    .filter(Boolean)
    .join(', ');
  const manage = appointmentManageUrl(a.id);
  return {
    uid: `appointment-${a.id}@barbershop`,
    start: a.startAt,
    end: a.endAt,
    summary: `${services || 'Horário'} — ${a.barbershop.name}`,
    description: `Com ${a.barber.name}\nRemarcar ou cancelar: ${manage}`,
    location: `${a.barbershop.name}, ${a.barbershop.address}, ${a.barbershop.city} - ${a.barbershop.state}`,
    url: manage,
    // Remarcou: o app troca o evento (SEQUENCE maior vence)
    sequence: Math.floor(a.updatedAt.getTime() / 1000),
    updatedAt: a.updatedAt,
    cancelled: a.status === 'CANCELLED',
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
