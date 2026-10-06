import { Role } from '../auth/interfaces/roles';
import type { UserDTO } from '../auth/users/dto/user.dto';

/** Quem da equipe está agindo (conta antiga ou equipe assinada pela API do backoffice) */
export type StaffActor = { id: number; email: string; role: string; admin: boolean };

export function staffActor(user: UserDTO | undefined): StaffActor {
  const staff = (user as { staff?: { role?: string } } | undefined)?.staff;
  const legacy = user?.role?.name ?? '';
  return {
    id: user?.id ?? 0,
    email: user?.email ?? '',
    // Cargo da equipe (S2) quando houver; senão o papel antigo
    role: staff?.role ?? legacy,
    admin: legacy.toLowerCase() === Role.SYSTEM_ADMIN.toLowerCase(),
  };
}
