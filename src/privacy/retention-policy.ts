const MS_DAY = 86_400_000;

/**
 * Prazos do item 11 do roadmap. Proposta até o jurídico confirmar: a lei não
 * fixa um número, fixa que cada dado sai quando o propósito acaba. Pagamento,
 * caixinha e nota fiscal não estão aqui — obrigação fiscal, não se apaga
 * nesta tarefa.
 */
export const RETENTION_DAYS = {
  /** Cópia do e-mail enviado (assunto, corpo, destinatário). */
  emailCopy: 365,
  /** IP, aparelho e local aproximado do login. */
  loginHistory: 365,
  /** Aviso no sininho. */
  notification: 365,
  /** Texto do chat, quando a conversa existir. */
  chatText: 365,
  /** Nota de conduta do cliente, quando existir, sem novo atendimento. */
  clientConductNote: 365 * 2,
} as const;

export function cutoffBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * MS_DAY);
}

/** Apaga em lotes para uma tabela grande não travar numa exclusão só. */
export async function deleteInBatches(
  findIds: (take: number) => Promise<{ id: number }[]>,
  remove: (ids: number[]) => Promise<number>,
  batchSize: number,
): Promise<number> {
  let total = 0;
  for (;;) {
    const rows = await findIds(batchSize);
    if (rows.length === 0) return total;
    total += await remove(rows.map((row) => row.id));
    if (rows.length < batchSize) return total;
  }
}
