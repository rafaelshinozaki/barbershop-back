import {
  boundingBox,
  clampRadius,
  DEFAULT_RADIUS_KM,
  haversineKm,
  isOpenAt,
  lngInBox,
  MAX_RADIUS_KM,
  rankResults,
} from './search';

describe('busca por localização', () => {
  // Praça da Sé e Avenida Paulista (SP): ~2,5 km; SP–Rio: ~360 km
  const se = { lat: -23.5505, lng: -46.6333 };
  const paulista = { lat: -23.5614, lng: -46.6559 };
  const rio = { lat: -22.9068, lng: -43.1729 };

  it('distância em km', () => {
    expect(haversineKm(se.lat, se.lng, paulista.lat, paulista.lng)).toBeCloseTo(2.6, 0);
    expect(haversineKm(se.lat, se.lng, rio.lat, rio.lng)).toBeGreaterThan(350);
    expect(haversineKm(se.lat, se.lng, rio.lat, rio.lng)).toBeLessThan(370);
  });

  it('raio: padrão sem valor, teto no máximo', () => {
    expect(clampRadius(undefined)).toBe(DEFAULT_RADIUS_KM);
    expect(clampRadius(0)).toBe(DEFAULT_RADIUS_KM);
    expect(clampRadius(5)).toBe(5);
    expect(clampRadius(10_000)).toBe(MAX_RADIUS_KM);
  });

  it('o retângulo contém o círculo: o que está no raio passa no corte do banco', () => {
    const box = boundingBox(se.lat, se.lng, 5);
    expect(paulista.lat).toBeGreaterThanOrEqual(box.minLat);
    expect(paulista.lat).toBeLessThanOrEqual(box.maxLat);
    expect(lngInBox(paulista.lng, box)).toBe(true);
    expect(rio.lat > box.maxLat || !lngInBox(rio.lng, box)).toBe(true);
  });

  it('retângulo que cruza o antimeridiano (±180)', () => {
    const box = boundingBox(-17.7, 179.9, 50);
    expect(box.maxLng).toBeGreaterThan(180);
    expect(lngInBox(-179.8, box)).toBe(true);
    expect(lngInBox(179.95, box)).toBe(true);
    expect(lngInBox(0, box)).toBe(false);
  });

  describe('aberta agora (no fuso da unidade)', () => {
    const shop = {
      timezone: 'America/Sao_Paulo',
      businessHours: JSON.stringify({ monday: { start: '09:00', end: '18:00' } }),
    };
    // Segunda, 2026-09-28: 10h em São Paulo = 13h UTC
    const mondayAt = (utcHour: number) => new Date(Date.UTC(2026, 8, 28, utcHour, 0));

    it('pelo horário da semana', () => {
      expect(isOpenAt(shop, mondayAt(13))).toBe(true);
      expect(isOpenAt(shop, mondayAt(11))).toBe(false); // 8h
      expect(isOpenAt(shop, mondayAt(21))).toBe(false); // 18h: já fechou
      // Terça sem horário cadastrado: fechada
      expect(isOpenAt(shop, new Date(Date.UTC(2026, 8, 29, 13)))).toBe(false);
    });

    it('fechamento do dia e horário especial valem por cima', () => {
      const closed = {
        ...shop,
        closures: [{ date: '2026-09-28', openTime: null, closeTime: null }],
      };
      expect(isOpenAt(closed, mondayAt(13))).toBe(false);
      const special = {
        ...shop,
        closures: [{ date: '2026-09-28', openTime: '12:00', closeTime: '14:00' }],
      };
      expect(isOpenAt(special, mondayAt(13))).toBe(false); // 10h
      expect(isOpenAt(special, mondayAt(16))).toBe(true); // 13h
    });

    it('sem horário da unidade usa o padrão (domingo fechado)', () => {
      const plain = { timezone: 'America/Sao_Paulo' };
      expect(isOpenAt(plain, mondayAt(13))).toBe(true);
      expect(isOpenAt(plain, new Date(Date.UTC(2026, 8, 27, 13)))).toBe(false);
    });
  });

  describe('ordem', () => {
    const item = (
      name: string,
      extra: Partial<{
        isFeatured: boolean;
        distanceKm: number | null;
        averageRating: number | null;
        reviewCount: number;
        minPrice: number | null;
      }> = {},
    ) => ({
      name,
      isFeatured: false,
      distanceKm: null,
      averageRating: null,
      reviewCount: 0,
      minPrice: null,
      ...extra,
    });
    const names = (list: Array<{ name: string }>) => list.map((i) => i.name);
    const list = [
      item('Longe', { distanceKm: 9, averageRating: 5, reviewCount: 40, minPrice: 30 }),
      item('Perto', { distanceKm: 1, averageRating: 4, reviewCount: 3, minPrice: 80 }),
      item('Destaque', { isFeatured: true, distanceKm: 5, minPrice: 50 }),
      item('Sem ponto'),
    ];

    it('relevância com ponto: destaque primeiro, depois o mais perto', () => {
      expect(names(rankResults(list, 'relevance', true))).toEqual([
        'Destaque',
        'Perto',
        'Longe',
        'Sem ponto',
      ]);
    });

    it('relevância sem ponto: nota com peso pela quantidade de avaliações', () => {
      const noPoint = [
        item('Uma avaliação 5', { averageRating: 5, reviewCount: 1 }),
        item('Muitas 4,7', { averageRating: 4.7, reviewCount: 80 }),
        item('Sem nota'),
      ];
      expect(names(rankResults(noPoint, 'relevance', false))).toEqual([
        'Muitas 4,7',
        'Uma avaliação 5',
        'Sem nota',
      ]);
    });

    it('distância, nota e preço: só o critério escolhido (destaque não fura)', () => {
      expect(names(rankResults(list, 'distance', true))).toEqual([
        'Perto',
        'Destaque',
        'Longe',
        'Sem ponto',
      ]);
      expect(names(rankResults(list, 'rating', true))).toEqual([
        'Longe',
        'Perto',
        'Destaque',
        'Sem ponto',
      ]);
      expect(names(rankResults(list, 'price', true))).toEqual([
        'Longe',
        'Destaque',
        'Perto',
        'Sem ponto',
      ]);
    });
  });
});
