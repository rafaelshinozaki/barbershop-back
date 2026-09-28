/**
 * Garante que o valor existe. Para os casos em que o fluxo já garante (achado
 * logo antes, checado por outra condição), mas o tipo não sabe: se um dia
 * deixar de valer, falha com uma mensagem clara em vez de seguir com undefined.
 */
export function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`${what} ausente`);
  return value;
}
