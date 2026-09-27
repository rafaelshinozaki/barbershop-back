import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';

const RUN = `${Date.now()}`.slice(-9);
// Um ponto no meio do Atlântico, só deste teste: nenhuma unidade de verdade por perto
const ORIGIN = { lat: 1 + Number(RUN.slice(-3)) / 10_000, lng: -28 };
// ~1 km, ~8 km e ~40 km a leste
const east = (km: number) => ORIGIN.lng + km / 111.3;

/**
 * Busca por localização: raio a partir do ponto, filtros (nota, preço,
 * aberta agora), ordem e a busca de profissionais respeitando a
 * privacidade de cada um.
 */
describe('Busca por localização (integração)', () => {
  const prisma = new PrismaService();
  const stub = {} as never;
  const service = new BarbershopService(
    prisma,
    stub,
    { getDownloadUrl: async (key: string) => `https://cdn.test/${key}` } as never,
    { isConfigured: () => false } as never,
    stub,
    { email: async () => undefined, whatsapp: async () => undefined } as never,
    { notify: () => undefined } as never,
  );

  let roleId: number;
  let ownerId: number;
  let networkId: number;
  const userIds: number[] = [];
  const shops: Record<string, number> = {};
  const professionalIds: number[] = [];
  const everyDay = JSON.stringify(
    Object.fromEntries(
      ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map((d) => [
        d,
        { start: '00:00', end: '23:59' },
      ]),
    ),
  );

  const user = async (label: string, fullName: string) => {
    const u = await prisma.user.create({
      data: {
        email: `search-${label}-${RUN}@test.local`,
        password: 'x',
        fullName,
        idDocNumber: `${RUN}${label}`.slice(-20),
        phone: `+55118${RUN}${label.length}`.slice(0, 20),
        gender: 'female',
        birthdate: new Date('1990-01-01'),
        readTerms: true,
        roleId,
      },
    });
    userIds.push(u.id);
    return u;
  };

  const shop = async (label: string, km: number, price: number, open: boolean) => {
    const b = await prisma.barbershop.create({
      data: {
        name: `Busca ${label} ${RUN}`,
        slug: `busca-${label}-${RUN}`,
        address: 'Rua A, 1',
        city: `Cidade Busca ${RUN}`,
        state: 'SP',
        country: 'BR',
        postalCode: '01000000',
        phone: '11999999999',
        email: `busca-${label}-${RUN}@test.local`,
        networkId,
        ownerUserId: ownerId,
        latitude: ORIGIN.lat,
        longitude: east(km),
        timezone: 'UTC',
        // Fechada: sem nenhum dia de funcionamento
        businessHours: open ? everyDay : JSON.stringify({}),
        services: {
          create: {
            name: `Corte ${label}`,
            durationMinutes: 30,
            price,
            category: 'HAIR',
          },
        },
      },
    });
    shops[label] = b.id;
    return b;
  };

  // Profissional público atendendo numa unidade, com nota
  const professional = async (
    label: string,
    shopLabel: string,
    rating: number,
    choices: Partial<{ visibility: string; showLocations: boolean; showRating: boolean }> = {},
  ) => {
    const u = await user(label, `Pro ${label} Busca`);
    const p = await prisma.professional.create({
      data: {
        userId: u.id,
        slug: `pro-${label}-${RUN}`,
        visibility: 'public',
        isPublic: true,
        specialties: ['HAIR'],
        ...choices,
      },
    });
    professionalIds.push(p.id);
    const barber = await prisma.barber.create({
      data: {
        barbershopId: shops[shopLabel],
        name: `Pro ${label}`,
        phone: '11955555555',
        userId: u.id,
        professionalId: p.id,
      },
    });
    const customer = await prisma.customer.create({
      data: { networkId, name: `Cliente ${label}`, phone: `7${RUN}${label.length}` },
    });
    const appt = await prisma.appointment.create({
      data: {
        barbershopId: shops[shopLabel],
        customerId: customer.id,
        barberId: barber.id,
        startAt: new Date(Date.now() - 3 * 3_600_000),
        endAt: new Date(Date.now() - 2 * 3_600_000),
        status: 'COMPLETED',
      },
    });
    await prisma.professionalReview.create({
      data: {
        appointmentId: appt.id,
        barberId: barber.id,
        barbershopId: shops[shopLabel],
        professionalId: p.id,
        customerId: customer.id,
        rating,
      },
    });
    return p;
  };

  const near = { lat: ORIGIN.lat, lng: ORIGIN.lng };
  const slugs = (list: Array<{ slug: string }>) => list.map((r) => r.slug);
  const s = (label: string) => `busca-${label}-${RUN}`;
  const pro = (label: string) => `pro-${label}-${RUN}`;

  beforeAll(async () => {
    roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = (await user('owner', 'Dona Busca')).id;
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede Busca ${RUN}` } })
    ).id;
    await shop('perto', 1, 80, true);
    await shop('meio', 8, 40, false);
    await shop('longe', 40, 30, true);
    await professional('ana', 'perto', 5);
    await professional('bia', 'meio', 3);
    await professional('oculta', 'perto', 5, { visibility: 'hidden' });
    await professional('discreta', 'perto', 4, { showLocations: false, showRating: false });
  });

  afterAll(async () => {
    await prisma.barbershop.deleteMany({ where: { id: { in: Object.values(shops) } } });
    await prisma.customer.deleteMany({ where: { networkId } });
    await prisma.network.delete({ where: { id: networkId } });
    await prisma.professional.deleteMany({ where: { id: { in: professionalIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('raio: padrão de 25 km deixa a de 40 km de fora; com raio maior ela entra', async () => {
    const r = await service.searchPublicBarbershops({ ...near });
    expect(slugs(r)).toEqual([s('perto'), s('meio')]);
    expect(r[0].distanceKm).toBeCloseTo(1, 0);
    expect(r[1].distanceKm).toBeCloseTo(8, 0);

    const wide = await service.searchPublicBarbershops({ ...near, radiusKm: 50 });
    expect(slugs(wide)).toEqual([s('perto'), s('meio'), s('longe')]);
    const tight = await service.searchPublicBarbershops({ ...near, radiusKm: 5 });
    expect(slugs(tight)).toEqual([s('perto')]);
  });

  it('filtros: preço, aberta agora e busca pelo nome do serviço', async () => {
    const cheap = await service.searchPublicBarbershops({ ...near, radiusKm: 50, maxPrice: 50 });
    expect(slugs(cheap)).toEqual([s('meio'), s('longe')]);
    expect(cheap[0]).toMatchObject({ minPrice: 40, currency: 'BRL' });

    const open = await service.searchPublicBarbershops({ ...near, radiusKm: 50, openNow: true });
    expect(slugs(open)).toEqual([s('perto'), s('longe')]);
    expect(open.every((r) => r.openNow)).toBe(true);

    const byService = await service.searchPublicBarbershops({ query: `Corte longe` });
    expect(slugs(byService)).toContain(s('longe'));
  });

  it('ordem por preço e sem ponto só pela cidade', async () => {
    const byPrice = await service.searchPublicBarbershops({
      ...near,
      radiusKm: 50,
      sort: 'price',
    });
    expect(slugs(byPrice)).toEqual([s('longe'), s('meio'), s('perto')]);

    const byCity = await service.searchPublicBarbershops({ city: `Cidade Busca ${RUN}` });
    expect(byCity).toHaveLength(3);
    expect(byCity.every((r) => r.distanceKm == null)).toBe(true);
  });

  it('profissionais: só perfis públicos; nota mínima; ordem por distância', async () => {
    const all = await service.searchPublicProfessionals({ ...near, radiusKm: 50 });
    // Oculta não aparece; quem esconde as unidades não entra na busca por distância
    expect(slugs(all)).toEqual([pro('ana'), pro('bia')]);
    expect(all[0]).toMatchObject({
      name: 'Pro ana Busca',
      averageRating: 5,
      reviewCount: 1,
      shops: [{ name: `Busca perto ${RUN}`, slug: s('perto') }],
      minPrice: 80,
    });

    const good = await service.searchPublicProfessionals({ ...near, minRating: 4 });
    expect(slugs(good)).toEqual([pro('ana')]);
  });

  it('quem esconde unidades e nota aparece pela cidade, sem nota e sem onde atende', async () => {
    await prisma.professional.updateMany({
      where: { slug: pro('discreta') },
      data: { cities: [`Cidade Busca ${RUN}`] },
    });
    const list = await service.searchPublicProfessionals({ city: `Cidade Busca ${RUN}` });
    const discreta = list.find((r) => r.slug === pro('discreta'));
    expect(discreta).toMatchObject({
      shops: [],
      averageRating: null,
      reviewCount: 0,
      distanceKm: null,
    });
    expect(slugs(list)).not.toContain(pro('oculta'));
  });
});
