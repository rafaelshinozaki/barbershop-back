import { clientBadges, professionalBadges, unitBadges } from './badges';

describe('selos', () => {
  it('profissional: nota alta só com volume; experiente; clientes fiéis', () => {
    expect(
      professionalBadges({
        averageRating: 5,
        reviewCount: 9,
        completed: 99,
        uniqueClients: 19,
        returningClients: 19,
      }),
    ).toEqual([]);
    expect(
      professionalBadges({
        averageRating: 4.8,
        reviewCount: 10,
        completed: 100,
        uniqueClients: 20,
        returningClients: 10,
      }),
    ).toEqual(['top_rated', 'experienced', 'loyal_clients']);
    // Nota caiu: o selo some
    expect(
      professionalBadges({
        averageRating: 4.7,
        reviewCount: 50,
        completed: 0,
        uniqueClients: 0,
        returningClients: 0,
      }),
    ).toEqual([]);
  });

  it('unidade: nota alta e procurada', () => {
    expect(unitBadges({ averageRating: 4.9, reviewCount: 12, completed: 500 })).toEqual([
      'top_rated',
      'popular',
    ]);
    expect(unitBadges({ averageRating: null, reviewCount: 0, completed: 499 })).toEqual([]);
  });

  it('cliente: comparece e pontual, só com histórico suficiente', () => {
    expect(
      clientBadges({ attendanceRate: 100, completed: 5, punctuality: 4.5, ratingCount: 3 }),
    ).toEqual(['reliable', 'punctual']);
    expect(
      clientBadges({ attendanceRate: 100, completed: 4, punctuality: 5, ratingCount: 2 }),
    ).toEqual([]);
    expect(
      clientBadges({ attendanceRate: 90, completed: 30, punctuality: 4.4, ratingCount: 30 }),
    ).toEqual([]);
  });
});
