/**
 * Cargos da equipe (Barber.staffType), como no Booksy. O que cada um pode
 * está em AccessLevel (barbershop.service.ts).
 */
export const STAFF_TYPES = ['basic', 'barber', 'reception', 'manager'] as const;
export type StaffType = (typeof STAFF_TYPES)[number];

export function isStaffType(value: unknown): value is StaffType {
  return typeof value === 'string' && (STAFF_TYPES as readonly string[]).includes(value);
}

/** Nome do cargo em cada idioma (minúsculo, pra usar no meio da frase) */
export const STAFF_ROLE_LABEL: Record<StaffType, { pt: string; en: string; es: string }> = {
  basic: { pt: 'profissional básico', en: 'basic professional', es: 'profesional básico' },
  barber: { pt: 'profissional', en: 'professional', es: 'profesional' },
  reception: { pt: 'recepcionista', en: 'receptionist', es: 'recepcionista' },
  manager: { pt: 'gerente', en: 'manager', es: 'gerente' },
};

export function staffRoleLabel(staffType: string | null | undefined) {
  return STAFF_ROLE_LABEL[isStaffType(staffType) ? staffType : 'barber'];
}

/**
 * Atende clientes? O campo explícito vale; vazio segue o cargo (recepção não
 * atende, os demais atendem).
 */
export function takesAppointments(b: {
  takesAppointments?: boolean | null;
  staffType?: string | null;
}): boolean {
  return b.takesAppointments ?? b.staffType !== 'reception';
}
