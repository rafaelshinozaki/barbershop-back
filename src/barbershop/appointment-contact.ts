/** E-mail deste horário: o digitado no agendamento online, senão o da ficha. */
export function appointmentContactEmail(appt: {
  contactEmail?: string | null;
  customer?: { email?: string | null } | null;
}): string | null {
  const typed = appt.contactEmail?.trim();
  if (typed) return typed;
  const saved = appt.customer?.email?.trim();
  return saved || null;
}
