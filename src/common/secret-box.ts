import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

/** Token cifrado em repouso. O texto antigo (sem este prefixo) ainda abre. */
const PREFIX = 'enc:v1:';
const keys = new Map<string, Buffer>();

function keyFrom(secret: string): Buffer {
  const cached = keys.get(secret);
  if (cached) return cached;
  const key = scryptSync(secret, 'barbershop-social-token', 32);
  keys.set(secret, key);
  return key;
}

export function isSealed(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

export function sealSecret(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, body]).toString('base64url');
}

/** Abre um valor cifrado. Valor sem o prefixo é o texto puro antigo. */
export function openSecret(stored: string, secret: string): string {
  if (!isSealed(stored)) return stored;
  const buf = Buffer.from(stored.slice(PREFIX.length), 'base64url');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const body = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}
