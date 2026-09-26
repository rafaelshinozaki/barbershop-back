import {
  buildCareerOverview,
  firstNameOnly,
  pickCommissionPercent,
  slugifyName,
  visiblePastVisit,
} from './career';

const place = {
  barberId: 1,
  shopId: 10,
  shopName: 'A',
  staffType: 'barber',
  active: true,
  startedAt: new Date('2024-01-01'),
  endedAt: null,
  commissionPercent: 40,
};

describe('histórico de quem já saiu', () => {
  it('fica só o primeiro nome', () => {
    expect(firstNameOnly('Cayo Carlos')).toBe('Cayo');
    expect(firstNameOnly('  Maria da Silva  ')).toBe('Maria');
    expect(
      visiblePastVisit({
        shopName: 'Antiga',
        occurredAt: new Date('2024-03-12T15:00:00Z'),
        customerName: 'Cayo Carlos',
      }),
    ).toEqual({
      shopName: 'Antiga',
      occurredAt: new Date('2024-03-12T15:00:00Z'),
      firstName: 'Cayo',
    });
  });

  it('o endereço público sai do nome, sem acento', () => {
    expect(slugifyName('João da Silva')).toBe('joao-da-silva');
    expect(slugifyName('   ')).toBe('profissional');
  });
});

describe('pickCommissionPercent', () => {
  const rules = [
    { barberId: 1, barbershopId: 10, itemType: 'ALL', percentage: 30 },
    { barberId: 1, barbershopId: 10, itemType: 'SERVICE', percentage: 45 },
    { barberId: null, barbershopId: 10, itemType: 'SERVICE', percentage: 20 },
  ];

  it('prefere a regra de serviço do próprio vínculo', () => {
    expect(pickCommissionPercent(rules, 1, 10)).toBe(45);
  });

  it('cai na regra da unidade quando o vínculo não tem', () => {
    expect(pickCommissionPercent(rules, 2, 10)).toBe(20);
  });

  it('sem regra, não inventa percentual', () => {
    expect(pickCommissionPercent([], 1, 10)).toBeNull();
  });
});

describe('buildCareerOverview', () => {
  it('junta as duas unidades e só conta concluído em faturamento e retorno', () => {
    const overview = buildCareerOverview({
      places: [
        place,
        {
          ...place,
          barberId: 2,
          shopId: 11,
          shopName: 'B',
          active: false,
          startedAt: new Date('2023-01-01'),
          endedAt: new Date('2023-12-01'),
        },
      ],
      visits: [
        {
          customerId: 7,
          status: 'COMPLETED',
          hour: 14,
          currency: 'BRL',
          services: [{ name: 'Corte', quantity: 1, unitPrice: 50 }],
        },
        {
          customerId: 7,
          status: 'COMPLETED',
          hour: 14,
          currency: 'BRL',
          services: [{ name: 'Barba', quantity: 1, unitPrice: 30 }],
        },
        {
          customerId: 8,
          status: 'COMPLETED',
          hour: 9,
          currency: 'BRL',
          services: [{ name: 'Corte', quantity: 1, unitPrice: 40 }],
        },
        {
          customerId: 9,
          status: 'NO_SHOW',
          hour: 11,
          currency: 'BRL',
          services: [{ name: 'Corte', quantity: 1, unitPrice: 50 }],
        },
        {
          customerId: 10,
          status: 'CANCELLED',
          hour: 16,
          currency: 'BRL',
          services: [{ name: 'Corte', quantity: 1, unitPrice: 50 }],
        },
      ],
      payouts: [{ currency: 'BRL', total: 32, commission: 28, tips: 4 }],
    });

    expect(overview.places.map((row) => row.shopName)).toEqual(['A', 'B']);
    expect(overview.completedAppointments).toBe(3);
    expect(overview.noShows).toBe(1);
    expect(overview.uniqueClients).toBe(2);
    expect(overview.returningClients).toBe(1);
    expect(overview.busiestHour).toBe(14);
    expect(overview.topServices[0]).toEqual({ name: 'Corte', count: 2 });
    expect(overview.byCurrency).toEqual([
      { currency: 'BRL', revenue: 120, paid: 32, commission: 28, tips: 4 },
    ]);
  });

  it('no empate de horário, fica o mais cedo', () => {
    const visit = (hour: number) => ({
      customerId: hour,
      status: 'COMPLETED',
      hour,
      currency: 'BRL',
      services: [{ name: 'Corte', quantity: 1, unitPrice: 10 }],
    });
    const overview = buildCareerOverview({
      places: [place],
      visits: [visit(18), visit(10)],
      payouts: [],
    });
    expect(overview.busiestHour).toBe(10);
  });
});
