/** E-mail de conta: sem espaços e sem diferença de maiúsculas. */
export function normalizeEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}
