import { createHmac, timingSafeEqual } from 'crypto';
import { BackofficeArea } from './backoffice-areas';
import { Role } from './interfaces/roles';
import { gatewayAllowed } from './gateway';

/**
 * Equipe da plataforma vinda da API do backoffice (S2 de "Tirar o backoffice
 * do projeto principal"). A equipe entra no barbershop-backoffice-back, que
 * tem as contas (StaffUser) e as sessões; aqui chega só uma afirmação
 * assinada de quem é, junto com o segredo do gateway:
 *
 *   x-backoffice-staff: <payload base64url>.<HMAC-SHA256 base64url>
 *
 * A assinatura usa o BACKOFFICE_GATEWAY_SECRET e vale por pouco tempo (exp).
 * Sem o segredo configurado, nunca vale. Até a S3 (operações no
 * backoffice-back), o cargo vira o papel e as áreas antigos aqui; a
 * permissão fina de cada cargo é conferida na própria API do backoffice.
 */
export const STAFF_HEADER = 'x-backoffice-staff';

/** Cargos dos funcionários (ver "Cargos dos funcionários da plataforma") */
export const STAFF_ROLES = [
  'super_admin',
  'admin',
  'coordinator',
  'support_n1',
  'support_n2',
  'moderator',
  'finance',
  'growth',
  'analyst',
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export type StaffAssertion = {
  /** StaffUser.id */
  sid: number;
  email: string;
  name: string;
  role: StaffRole;
  /** User da conta antiga (migrada), se houver: avisos e preferências dela */
  uid: number | null;
  /** Expira (segundos desde 1970) */
  exp: number;
};

const A = BackofficeArea;
/**
 * Papel e áreas antigos de cada cargo, até as operações irem para a API do
 * backoffice. Grosso de propósito: o que o cargo só lê (ex.: o Coordenador
 * no Financeiro) é barrado lá, pela permissão da operação.
 */
export const LEGACY_ACCESS: Record<StaffRole, { role: Role; areas: BackofficeArea[] }> = {
  super_admin: { role: Role.SYSTEM_ADMIN, areas: [] },
  admin: { role: Role.SYSTEM_ADMIN, areas: [] },
  coordinator: {
    role: Role.SYSTEM_MANAGER,
    areas: [A.SUPPORT, A.MODERATION, A.USERS, A.FINANCE, A.OPERATIONS],
  },
  support_n1: { role: Role.SYSTEM_MANAGER, areas: [A.SUPPORT, A.USERS] },
  support_n2: { role: Role.SYSTEM_MANAGER, areas: [A.SUPPORT, A.USERS] },
  moderator: { role: Role.SYSTEM_MANAGER, areas: [A.MODERATION, A.SUPPORT, A.USERS] },
  finance: { role: Role.SYSTEM_MANAGER, areas: [A.FINANCE, A.USERS] },
  growth: { role: Role.SYSTEM_MANAGER, areas: [A.OPERATIONS] },
  analyst: { role: Role.SYSTEM_MANAGER, areas: [A.OPERATIONS] },
};

const b64 = (buf: Buffer) => buf.toString('base64url');
const mac = (secret: string, payload: string) =>
  createHmac('sha256', secret).update(payload).digest();

/** Assina (usado pela API do backoffice e nos testes) */
export function signStaffAssertion(payload: StaffAssertion, secret: string): string {
  const body = b64(Buffer.from(JSON.stringify(payload)));
  return `${body}.${b64(mac(secret, body))}`;
}

const positiveInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;

/** Confere assinatura, prazo e formato; senão null */
export function verifyStaffAssertion(
  header: unknown,
  secret: string | undefined,
  now = Date.now(),
): StaffAssertion | null {
  if (!secret || typeof header !== 'string') return null;
  const [body, sig] = header.split('.');
  if (!body || !sig) return null;
  const expected = mac(secret, body);
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!positiveInt(data.sid) || typeof data.email !== 'string' || typeof data.name !== 'string')
    return null;
  if (!STAFF_ROLES.includes(data.role as StaffRole)) return null;
  if (typeof data.exp !== 'number' || data.exp * 1000 < now) return null;
  const uid = data.uid == null ? null : positiveInt(data.uid) ? data.uid : undefined;
  if (uid === undefined) return null;
  return {
    sid: data.sid,
    email: data.email,
    name: data.name,
    role: data.role as StaffRole,
    uid,
    exp: data.exp,
  };
}

type Headers = Record<string, string | string[] | undefined>;

/** A afirmação da equipe deste request (só com o segredo do gateway certo) */
export function staffFromHeaders(
  headers: Headers | undefined,
  secret = process.env.BACKOFFICE_GATEWAY_SECRET,
): StaffAssertion | null {
  if (!secret || !headers) return null;
  if (!gatewayAllowed(secret, headers['x-backoffice-gateway'])) return null;
  return verifyStaffAssertion(headers[STAFF_HEADER], secret);
}

/** Quem está agindo numa operação de sistema (no lugar do User) */
export type StaffPrincipal = {
  id: number;
  email: string;
  fullName: string;
  role: { name: string };
  backofficeAreas: string[];
  isActive: true;
  staff: { id: number; role: StaffRole; legacyUserId: number | null };
};

export function staffPrincipal(a: StaffAssertion): StaffPrincipal {
  const access = LEGACY_ACCESS[a.role];
  return {
    id: a.sid,
    email: a.email,
    fullName: a.name,
    role: { name: access.role },
    backofficeAreas: [...access.areas],
    isActive: true,
    staff: { id: a.sid, role: a.role, legacyUserId: a.uid },
  };
}
