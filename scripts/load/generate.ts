/**
 * Dados em volume para o teste de carga (NUNCA em produção: recusa com
 * NODE_ENV=production e exige LOAD_TEST_DB=true). Roda num banco próprio,
 * já migrado:
 *
 *   LOAD_TEST_DB=true DATABASE_URL=postgresql://.../barbershop_load \
 *     npx ts-node --transpile-only scripts/load/generate.ts
 *
 * Tamanho por variável: LOAD_SHOPS (3000), LOAD_BARBERS (3 por unidade),
 * LOAD_APPOINTMENTS (40 por profissional, de -20 a +20 dias). Metade das
 * unidades fica em São Paulo, para ter uma cidade densa (mais de 500
 * unidades no raio de 25 km).
 */
import { Prisma, PrismaClient, TreatmentCategory } from '@prisma/client';
import { must } from '../../src/common/must';
import * as bcrypt from 'bcryptjs';

const SHOPS = Number(process.env.LOAD_SHOPS ?? 3000);
const BARBERS = Number(process.env.LOAD_BARBERS ?? 3);
const APPOINTMENTS = Number(process.env.LOAD_APPOINTMENTS ?? 40);
const BATCH = 5000;

const CITIES = [
  { city: 'São Paulo', state: 'SP', lat: -23.5505, lng: -46.6333, weight: 50 },
  { city: 'Rio de Janeiro', state: 'RJ', lat: -22.9068, lng: -43.1729, weight: 12 },
  { city: 'Belo Horizonte', state: 'MG', lat: -19.9167, lng: -43.9345, weight: 8 },
  { city: 'Campinas', state: 'SP', lat: -22.9099, lng: -47.0626, weight: 6 },
  { city: 'Curitiba', state: 'PR', lat: -25.4284, lng: -49.2733, weight: 6 },
  { city: 'Porto Alegre', state: 'RS', lat: -30.0346, lng: -51.2177, weight: 5 },
  { city: 'Salvador', state: 'BA', lat: -12.9777, lng: -38.5016, weight: 5 },
  { city: 'Recife', state: 'PE', lat: -8.0476, lng: -34.877, weight: 4 },
  { city: 'São José dos Campos', state: 'SP', lat: -23.1896, lng: -45.8841, weight: 4 },
];
const SERVICES: { name: string; category: TreatmentCategory; minutes: number; price: number }[] = [
  { name: 'Corte', category: 'HAIR', minutes: 30, price: 45 },
  { name: 'Barba', category: 'BEARD', minutes: 30, price: 35 },
  { name: 'Corte + Barba', category: 'COMBO', minutes: 60, price: 70 },
  { name: 'Sobrancelha', category: 'BROWS_LASHES', minutes: 15, price: 20 },
  { name: 'Pé e mão', category: 'NAILS', minutes: 60, price: 60 },
];
const HOURS = JSON.stringify({
  sunday: null,
  monday: { start: '09:00', end: '19:00' },
  tuesday: { start: '09:00', end: '19:00' },
  wednesday: { start: '09:00', end: '19:00' },
  thursday: { start: '09:00', end: '20:00' },
  friday: { start: '09:00', end: '20:00' },
  saturday: { start: '08:00', end: '16:00' },
});

// Pseudoaleatório com semente: o mesmo tamanho gera sempre os mesmos dados
let seed = 20260928;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const cityFor = () => {
  const total = CITIES.reduce((s, c) => s + c.weight, 0);
  let r = rand() * total;
  for (const c of CITIES) if ((r -= c.weight) <= 0) return c;
  return CITIES[0];
};

async function inBatches<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += BATCH) await insert(rows.slice(i, i + BATCH));
}

async function main() {
  if (process.env.NODE_ENV === 'production' || process.env.LOAD_TEST_DB !== 'true') {
    throw new Error(
      'Só num banco de teste de carga: defina LOAD_TEST_DB=true (nunca em produção).',
    );
  }
  const prisma = new PrismaClient();
  const t0 = Date.now();
  const role =
    (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
    (await prisma.role.create({ data: { name: 'BarbershopOwner' } }));
  const password = bcrypt.hashSync('load-test-password', 4);
  const run = Date.now().toString(36);

  // Donos (um por unidade) e profissionais (contas próprias, página pública)
  const users: Prisma.UserCreateManyInput[] = [];
  for (let s = 0; s < SHOPS; s++) {
    for (let b = 0; b < BARBERS; b++) {
      users.push({
        email: `load-${run}-${s}-${b}@load.test`,
        password,
        fullName: `Profissional ${s}-${b}`,
        idDocNumber: `${s}${b}`.padStart(11, '0'),
        phone: `+55119${String(s * 10 + b).padStart(8, '0')}`,
        gender: 'male',
        birthdate: new Date('1990-01-01T12:00:00Z'),
        readTerms: true,
        isActive: true,
        roleId: role.id,
      });
    }
  }
  await inBatches(users, (data) => prisma.user.createMany({ data }));
  const userRows = await prisma.user.findMany({
    where: { email: { startsWith: `load-${run}-` } },
    select: { id: true, email: true },
  });
  const userId = new Map(userRows.map((u) => [u.email, u.id]));
  const uid = (s: number, b: number) =>
    must(userId.get(`load-${run}-${s}-${b}@load.test`), `conta ${s}-${b}`);
  console.log(`users: ${userRows.length} (${Date.now() - t0} ms)`);

  await inBatches(
    Array.from({ length: SHOPS }, (_, s) => ({ ownerUserId: uid(s, 0), name: `Rede ${run}-${s}` })),
    (data) => prisma.network.createMany({ data }),
  );
  const networks = await prisma.network.findMany({
    where: { name: { startsWith: `Rede ${run}-` } },
    select: { id: true, name: true },
  });
  const networkId = new Map(networks.map((n) => [n.name, n.id]));

  const now = new Date();
  await inBatches(
    Array.from({ length: SHOPS }, (_, s) => {
      const c = cityFor();
      return {
        name: `Barbearia ${s}`,
        slug: `load-${run}-${s}`,
        address: `Rua ${s}, ${100 + s}`,
        city: c.city,
        state: c.state,
        country: 'BR',
        postalCode: '01000-000',
        phone: '(11) 3000-0000',
        email: `shop-${run}-${s}@load.test`,
        networkId: must(networkId.get(`Rede ${run}-${s}`), `rede ${s}`),
        ownerUserId: uid(s, 0),
        latitude: c.lat + (rand() - 0.5) * 0.3,
        longitude: c.lng + (rand() - 0.5) * 0.3,
        businessHours: HOURS,
        featuredUntil: rand() < 0.05 ? new Date(now.getTime() + 20 * 86_400_000) : null,
      };
    }),
    (data) => prisma.barbershop.createMany({ data }),
  );
  const shops = await prisma.barbershop.findMany({
    where: { slug: { startsWith: `load-${run}-` } },
    select: { id: true, slug: true, networkId: true },
    orderBy: { id: 'asc' },
  });
  console.log(`shops: ${shops.length} (${Date.now() - t0} ms)`);

  await inBatches(
    shops.flatMap((shop) =>
      SERVICES.map((sv, i) => ({
        barbershopId: shop.id,
        name: sv.name,
        category: sv.category,
        durationMinutes: sv.minutes,
        price: sv.price + Math.round(rand() * 20),
        displayOrder: i,
      })),
    ),
    (data) => prisma.barbershopService.createMany({ data }),
  );

  // Profissionais: perfil público; o dono também atende
  await inBatches(
    shops.flatMap((shop, s) =>
      Array.from({ length: BARBERS }, (_, b) => ({
        userId: uid(s, b),
        slug: `load-${run}-${s}-${b}`,
        visibility: 'public',
        isPublic: true,
        roles: ['barber'],
        specialties: [pick(SERVICES).category],
        openToWork: rand() < 0.3,
      })),
    ),
    (data) => prisma.professional.createMany({ data }),
  );
  const pros = await prisma.professional.findMany({
    where: { slug: { startsWith: `load-${run}-` } },
    select: { id: true, userId: true },
  });
  const proOf = new Map(pros.map((p) => [p.userId, p.id]));
  await inBatches(
    shops.flatMap((shop, s) =>
      Array.from({ length: BARBERS }, (_, b) => ({
        barbershopId: shop.id,
        userId: uid(s, b),
        professionalId: proOf.get(uid(s, b)),
        name: `Profissional ${s}-${b}`,
        phone: '(11) 90000-0000',
        staffType: b === 0 ? 'owner' : 'barber',
        isActive: true,
      })),
    ),
    (data) => prisma.barber.createMany({ data }),
  );
  const barbers = await prisma.barber.findMany({
    where: { barbershopId: { in: shops.map((s) => s.id) } },
    select: { id: true, barbershopId: true },
  });
  console.log(`barbers: ${barbers.length} (${Date.now() - t0} ms)`);

  // Clientes (20 por rede) e avaliações (5 por unidade)
  await inBatches(
    shops.flatMap((shop) =>
      Array.from({ length: 20 }, (_, i) => ({
        networkId: shop.networkId,
        name: `Cliente ${i}`,
        phone: `(11) 9${String(shop.id * 100 + i).padStart(8, '0')}`,
      })),
    ),
    (data) => prisma.customer.createMany({ data }),
  );
  const customers = await prisma.customer.findMany({
    where: { networkId: { in: shops.map((s) => s.networkId) } },
    select: { id: true, networkId: true },
  });
  const customersOf = new Map<number, number[]>();
  for (const c of customers) {
    customersOf.set(c.networkId, [...(customersOf.get(c.networkId) ?? []), c.id]);
  }
  await inBatches(
    shops.flatMap((shop) =>
      (customersOf.get(shop.networkId) ?? []).slice(0, 5).map((customerId) => ({
        barbershopId: shop.id,
        customerId,
        rating: 3 + Math.floor(rand() * 3),
        comment: 'Atendimento ótimo',
      })),
    ),
    (data) => prisma.review.createMany({ data }),
  );

  // Agenda: horários de 30 min, de -20 a +20 dias, das 9h às 18h (Brasília)
  const shopOf = new Map(shops.map((s) => [s.id, s]));
  const appts: Prisma.AppointmentCreateManyInput[] = [];
  for (const barber of barbers) {
    const shop = must(shopOf.get(barber.barbershopId), 'unidade');
    const clients = customersOf.get(shop.networkId) ?? [];
    for (let i = 0; i < APPOINTMENTS; i++) {
      const day = Math.floor(rand() * 41) - 20;
      const slot = Math.floor(rand() * 18);
      const start = new Date(now);
      start.setUTCDate(start.getUTCDate() + day);
      start.setUTCHours(12 + Math.floor(slot / 2), (slot % 2) * 30, 0, 0);
      appts.push({
        barbershopId: shop.id,
        barberId: barber.id,
        customerId: pick(clients),
        startAt: start,
        endAt: new Date(start.getTime() + 30 * 60_000),
        status: day < 0 ? 'COMPLETED' : 'CONFIRMED',
        source: 'STAFF',
      });
    }
  }
  await inBatches(appts, (data) => prisma.appointment.createMany({ data }));
  console.log(`appointments: ${appts.length} (${Date.now() - t0} ms)`);
  console.log(`run=${run} password=load-test-password owner=load-${run}-0-0@load.test`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
