import { cutoffBefore, deleteInBatches, RETENTION_DAYS } from './retention-policy';

describe('retention-policy', () => {
  it('o corte é exatamente N dias antes de agora', () => {
    const now = new Date('2026-09-26T03:15:00.000Z');
    expect(cutoffBefore(now, 365).toISOString()).toBe('2025-09-26T03:15:00.000Z');
    expect(cutoffBefore(now, RETENTION_DAYS.clientConductNote).toISOString()).toBe(
      '2024-09-26T03:15:00.000Z',
    );
  });

  it('para no lote incompleto e soma o que apagou', async () => {
    const pages = [[{ id: 1 }, { id: 2 }], [{ id: 3 }]];
    const removed: number[][] = [];
    const total = await deleteInBatches(
      async () => pages.shift() ?? [],
      async (ids) => {
        removed.push(ids);
        return ids.length;
      },
      2,
    );
    expect(total).toBe(3);
    expect(removed).toEqual([[1, 2], [3]]);
  });

  it('não chama a exclusão quando não há nada vencido', async () => {
    const remove = jest.fn();
    const total = await deleteInBatches(async () => [], remove, 2);
    expect(total).toBe(0);
    expect(remove).not.toHaveBeenCalled();
  });
});
