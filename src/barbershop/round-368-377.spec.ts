import { compareClientPackagesForUse, currentManagers } from './barbershop.service';

const pack = (
  overrides: Partial<{
    status: string;
    usedSessions: number;
    totalSessions: number;
    expiresAt: Date | null;
    createdAt: Date;
  }>,
) => ({
  status: 'ACTIVE',
  usedSessions: 0,
  totalSessions: 4,
  expiresAt: null as Date | null,
  createdAt: new Date('2026-01-01'),
  ...overrides,
});

describe('Itens 374 e 377', () => {
  it('gerente fora do período não entra no filtro dos avisos', () => {
    const now = new Date('2026-10-29T15:00:00Z');
    expect(currentManagers(now)).toEqual({
      isActive: true,
      staffType: 'manager',
      userId: { not: null },
      AND: [
        { OR: [{ accessStartsAt: null }, { accessStartsAt: { lte: now } }] },
        { OR: [{ accessEndsAt: null }, { accessEndsAt: { gte: now } }] },
      ],
    });
  });

  it('o pacote que vence primeiro vem na frente; sem validade por último; empate, o mais antigo', () => {
    const now = new Date('2026-10-29T15:00:00Z');
    const soon = pack({
      expiresAt: new Date('2026-11-08T15:00:00Z'),
      createdAt: new Date('2026-01-01'),
    });
    const later = pack({
      expiresAt: new Date('2027-04-29T15:00:00Z'),
      createdAt: new Date('2026-10-01'),
    });
    const open = pack({ expiresAt: null, createdAt: new Date('2025-01-01') });
    const olderTie = pack({
      expiresAt: new Date('2026-11-08T15:00:00Z'),
      createdAt: new Date('2025-06-01'),
    });
    const ordered = [later, open, soon, olderTie].sort((a, b) =>
      compareClientPackagesForUse(a, b, now.getTime()),
    );
    expect(ordered).toEqual([olderTie, soon, later, open]);
  });
});
