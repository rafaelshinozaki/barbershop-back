// Dados de demonstração pro seed: deixa cada tela do app com conteúdo real pra
// navegar (agenda, caixa, vendas, relatórios, estoque, fidelidade, avaliações,
// notificações, busca pública etc.), em vez de só o esqueleto
// usuário/barbearia/1 serviço que o seed base cria.
//
// Idempotente como o resto do seed: cada bloco checa se já rodou (por slug,
// e-mail ou "a unidade já tem agendamentos?") e pula se sim, então rodar de
// novo não duplica nada. Datas são relativas a "agora", então a agenda sempre
// tem passado recente e próximos dias, não importa quando o seed rodar.
import { Prisma, PrismaClient, TreatmentCategory } from '@prisma/client';
import { faker } from '@faker-js/faker';
import * as bcrypt from 'bcryptjs';

const SEED_PASSWORD = bcrypt.hashSync('pwned', 10);

// Unidades ficam em America/Sao_Paulo (UTC-3, sem horário de verão desde
// 2019); o banco guarda UTC. atBrt(-2, 14, 30) = anteontem às 14:30 de Brasília.
function atBrt(dayOffset: number, hour: number, minute = 0): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + dayOffset);
  d.setUTCHours(hour + 3, minute, 0, 0);
  return d;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

// CPF com dígitos verificadores válidos a partir de 9 dígitos base, pra passar
// em qualquer validação de documento do front.
export function cpf(base9: string): string {
  const digits = base9.split('').map(Number);
  for (const len of [9, 10]) {
    const sum = digits.slice(0, len).reduce((acc, d, i) => acc + d * (len + 1 - i), 0);
    const rest = (sum * 10) % 11;
    digits.push(rest === 10 ? 0 : rest);
  }
  return digits.join('');
}

const money = (n: number) => Math.round(n * 100) / 100;

const BUSINESS_HOURS = JSON.stringify({
  sunday: null,
  monday: { start: '09:00', end: '19:00' },
  tuesday: { start: '09:00', end: '19:00' },
  wednesday: { start: '09:00', end: '19:00' },
  thursday: { start: '09:00', end: '20:00' },
  friday: { start: '09:00', end: '20:00' },
  saturday: { start: '08:00', end: '16:00' },
});

// Pares estado/cidade/bairro/CEP reais (nomes exatamente como no
// country-state-city, que o front usa pros selects de endereço).
export const BR_LOCATIONS = [
  {
    state: 'SP',
    city: 'São José dos Campos',
    neighborhood: 'Jardim Aquarius',
    zipcode: '12246-000',
  },
  { state: 'SP', city: 'São Paulo', neighborhood: 'Pinheiros', zipcode: '05422-000' },
  { state: 'SP', city: 'Campinas', neighborhood: 'Cambuí', zipcode: '13024-000' },
  { state: 'SP', city: 'Taubaté', neighborhood: 'Centro', zipcode: '12020-000' },
  { state: 'RJ', city: 'Rio de Janeiro', neighborhood: 'Botafogo', zipcode: '22250-040' },
  { state: 'MG', city: 'Belo Horizonte', neighborhood: 'Savassi', zipcode: '30140-000' },
];

// Perfis fixos dos usuários-semente. O seed antigo gerava endereço com faker
// (country "Brazil", estado/cidade inventados) — o front usa códigos ISO do
// country-state-city ("BR", "SP") e nome exato da cidade, então País/Estado/
// Cidade apareciam vazios no perfil.
const SEED_USER_PROFILES: Record<
  string,
  {
    phone: string;
    cpfBase: string;
    birthdate: string;
    gender: string;
    address: Prisma.AddressUncheckedCreateInput;
  }
> = {
  'rafael.sinosaki@barbershop.com': {
    phone: '+5512991110001',
    cpfBase: '529982247',
    birthdate: '1990-03-14',
    gender: 'male',
    address: {
      userId: 0,
      zipcode: '12246-260',
      street: 'Avenida Cassiano Ricardo, 601',
      neighborhood: 'Jardim Aquarius',
      city: 'São José dos Campos',
      state: 'SP',
      country: 'BR',
      complement1: 'Apto 142',
    },
  },
  'jacqueline.mariane@barbershop.com': {
    phone: '+5511991110002',
    cpfBase: '111444777',
    birthdate: '1992-07-22',
    gender: 'female',
    address: {
      userId: 0,
      zipcode: '01310-100',
      street: 'Avenida Paulista, 1578',
      neighborhood: 'Bela Vista',
      city: 'São Paulo',
      state: 'SP',
      country: 'BR',
      complement1: 'Conjunto 81',
    },
  },
  'cayo.carlos@barbershop.com': {
    phone: '+5512991110003',
    cpfBase: '390533447',
    birthdate: '1987-11-02',
    gender: 'male',
    address: {
      userId: 0,
      zipcode: '12243-000',
      street: 'Rua Paulo Setúbal, 220',
      neighborhood: 'Vila Ema',
      city: 'São José dos Campos',
      state: 'SP',
      country: 'BR',
    },
  },
  'bianca.silverio@barbershop.com': {
    phone: '+5512991110004',
    cpfBase: '153509460',
    birthdate: '1995-05-09',
    gender: 'female',
    address: {
      userId: 0,
      zipcode: '12020-030',
      street: 'Rua XV de Novembro, 88',
      neighborhood: 'Centro',
      city: 'Taubaté',
      state: 'SP',
      country: 'BR',
    },
  },
  'julia.recepcao@barbershop.com': {
    phone: '+5512991110008',
    cpfBase: '274913580',
    birthdate: '1998-03-14',
    gender: 'female',
    address: {
      userId: 0,
      zipcode: '12243-000',
      street: 'Rua Paulo Setúbal, 310',
      neighborhood: 'Vila Adyana',
      city: 'São José dos Campos',
      state: 'SP',
      country: 'BR',
    },
  },
  'pedro.basico@barbershop.com': {
    phone: '+5512991110009',
    cpfBase: '381604725',
    birthdate: '2003-08-22',
    gender: 'male',
    address: {
      userId: 0,
      zipcode: '12236-000',
      street: 'Rua Ana Gonçalves da Cunha, 45',
      neighborhood: 'Parque Industrial',
      city: 'São José dos Campos',
      state: 'SP',
      country: 'BR',
    },
  },
  'minion.cayo@barbershop.com': {
    phone: '+5512991110005',
    cpfBase: '862415730',
    birthdate: '2000-01-30',
    gender: 'male',
    address: {
      userId: 0,
      zipcode: '12230-001',
      street: 'Avenida Andrômeda, 1200',
      neighborhood: 'Jardim Satélite',
      city: 'São José dos Campos',
      state: 'SP',
      country: 'BR',
      complement1: 'Casa 2',
    },
  },
};

async function fixSeedUserProfiles(prisma: PrismaClient) {
  console.log('Fixing seed user profiles (address ISO codes, phone, CPF)...');
  for (const [email, profile] of Object.entries(SEED_USER_PROFILES)) {
    const user = await prisma.user.findUnique({
      where: { email_provider: { email, provider: 'local' } },
      include: { address: true },
    });
    if (!user) continue;
    // Só corrige o que ainda é o dado gerado pelo faker (endereço fora do
    // padrão ISO) — não sobrescreve um perfil que alguém já editou pela tela.
    if (user.address?.country === 'BR') continue;
    // complement1/2 explícitos: sem isso o upsert mantinha o complemento
    // gerado pelo faker (ex.: "Suite 514") quando o perfil não define um.
    const { userId: _ignored, ...rest } = profile.address;
    const address = { complement1: null, complement2: null, ...rest };
    await prisma.address.upsert({
      where: { userId: user.id },
      create: { ...address, userId: user.id },
      update: address,
    });
    await prisma.user.update({
      where: { id: user.id },
      data: {
        phone: profile.phone,
        idDocNumber: cpf(profile.cpfBase),
        birthdate: new Date(`${profile.birthdate}T12:00:00Z`),
        gender: profile.gender,
      },
    });
  }
}

async function ensurePremiumForOwner(prisma: PrismaClient, ownerId: number) {
  const active = await prisma.subscription.findFirst({
    where: { userId: ownerId, status: 'ACTIVE' },
  });
  if (active) return;
  const premium = await prisma.plan.findFirst({
    where: { name: 'Premium', billingCycle: 'MONTHLY' },
  });
  if (!premium) return;
  console.log('Giving Cayo an active Premium subscription (unlocks every module)...');
  const subscription = await prisma.subscription.create({
    data: { userId: ownerId, planId: premium.id, startSubDate: atBrt(-95, 10), status: 'ACTIVE' },
  });
  for (let month = 3; month >= 0; month--) {
    await prisma.payment.create({
      data: {
        subscriptionId: subscription.id,
        amount: premium.price,
        paymentDate: atBrt(-30 * month - 5, 10),
        nextPaymentDate: atBrt(-30 * month + 25, 10),
        paymentMethod: 'Credit Card',
        transactionId: `seed_txn_${ownerId}_${month}`,
        status: 'COMPLETED',
      },
    });
  }
  await prisma.user.update({ where: { id: ownerId }, data: { membership: 'PAID' } });
}

type NotificationSeed = {
  title: string;
  message: string;
  type: string;
  isRead?: boolean;
  actionUrl?: string;
  actionText?: string;
  daysAgo: number;
};

const COMMON_NOTIFICATIONS: NotificationSeed[] = [
  {
    title: 'Bem-vindo à plataforma!',
    message: 'Complete seu perfil para aproveitar todos os recursos.',
    type: 'info',
    isRead: true,
    actionUrl: '/edit-profile',
    actionText: 'Completar perfil',
    daysAgo: 60,
  },
  {
    title: 'Novo acesso detectado',
    message:
      'Detectamos um login a partir de um novo dispositivo em São José dos Campos. Se não foi você, troque sua senha.',
    type: 'warning',
    actionUrl: '/reset-password',
    actionText: 'Trocar senha',
    daysAgo: 2,
  },
  {
    title: 'Manutenção programada',
    message: 'O sistema ficará indisponível no domingo das 02:00 às 03:00 para manutenção.',
    type: 'info',
    daysAgo: 1,
  },
];

const ROLE_NOTIFICATIONS: Record<string, NotificationSeed[]> = {
  'rafael.sinosaki@barbershop.com': [
    {
      title: 'Nova barbearia cadastrada',
      message: 'Studio Navalha acabou de se cadastrar em Campinas.',
      type: 'success',
      actionUrl: '/backoffice/manage-users',
      actionText: 'Ver usuários',
      daysAgo: 3,
    },
    {
      title: 'Falha em pagamento recorrente',
      message: '2 assinaturas tiveram a cobrança recusada neste mês.',
      type: 'error',
      actionUrl: '/backoffice/recurring-payments',
      actionText: 'Ver pagamentos',
      daysAgo: 0,
    },
  ],
  'jacqueline.mariane@barbershop.com': [
    {
      title: 'Pedido de destaque',
      message: 'Barbearia Vintage pediu posicionamento "Destaque" na busca.',
      type: 'info',
      actionUrl: '/backoffice/featured-barbershops',
      actionText: 'Revisar',
      daysAgo: 1,
    },
  ],
  'cayo.carlos@barbershop.com': [
    {
      title: 'Pagamento confirmado',
      message: 'Sua assinatura Premium foi renovada com sucesso.',
      type: 'success',
      isRead: true,
      actionUrl: '/payment-history',
      actionText: 'Ver histórico',
      daysAgo: 5,
    },
    {
      title: 'Estoque baixo',
      message: 'Pomada Modeladora Matte está abaixo do estoque mínimo.',
      type: 'warning',
      actionUrl: '/barbershops/{shop}/inventory',
      actionText: 'Ver estoque',
      daysAgo: 0,
    },
    {
      title: 'Nova avaliação ⭐⭐⭐⭐⭐',
      message: 'Lucas Ferreira avaliou a Green Barbershop com 5 estrelas.',
      type: 'success',
      actionUrl: '/u/green-barbershop',
      actionText: 'Ver página',
      daysAgo: 1,
    },
    {
      title: 'Taxa de no-show pendente',
      message: 'Há taxas de não comparecimento aguardando cobrança.',
      type: 'warning',
      actionUrl: '/barbershops/{shop}/no-show-charges',
      actionText: 'Ver taxas',
      daysAgo: 2,
    },
  ],
  'bianca.silverio@barbershop.com': [
    {
      title: 'Vaga aberta na agenda',
      message: 'Um cliente cancelou amanhã às 15:00 — há alguém na lista de espera.',
      type: 'info',
      actionUrl: '/barbershops/{shop}/waitlist',
      actionText: 'Ver lista de espera',
      daysAgo: 0,
    },
    {
      title: 'Caixa aberto',
      message: 'O caixa de hoje foi aberto com saldo inicial de R$ 200,00.',
      type: 'success',
      isRead: true,
      actionUrl: '/barbershops/{shop}/cashier',
      actionText: 'Ver caixa',
      daysAgo: 0,
    },
  ],
  'julia.recepcao@barbershop.com': [
    {
      title: 'Novo agendamento',
      message: 'Um cliente agendou pela página pública para amanhã às 10:00.',
      type: 'info',
      actionUrl: '/barbershops/{shop}/appointments',
      actionText: 'Ver agenda',
      daysAgo: 0,
    },
  ],
  'pedro.basico@barbershop.com': [
    {
      title: 'Agenda de amanhã',
      message: 'Você tem 3 atendimentos marcados para amanhã.',
      type: 'info',
      actionUrl: '/barbershops/{shop}/appointments',
      actionText: 'Ver agenda',
      daysAgo: 0,
    },
  ],
  'minion.cayo@barbershop.com': [
    {
      title: 'Agenda de amanhã',
      message: 'Você tem 5 atendimentos marcados para amanhã.',
      type: 'info',
      actionUrl: '/barbershops/{shop}/appointments',
      actionText: 'Ver agenda',
      daysAgo: 0,
    },
    {
      title: 'Férias aprovadas',
      message: 'Suas férias foram registradas na agenda da unidade.',
      type: 'success',
      isRead: true,
      daysAgo: 4,
    },
  ],
};

async function seedNotifications(prisma: PrismaClient, shopId: number) {
  for (const [email, extra] of Object.entries(ROLE_NOTIFICATIONS)) {
    const user = await prisma.user.findUnique({
      where: { email_provider: { email, provider: 'local' } },
    });
    if (!user) continue;
    if ((await prisma.userNotification.count({ where: { userId: user.id } })) > 0) continue;
    console.log(`Creating notifications for ${email}...`);
    for (const n of [...COMMON_NOTIFICATIONS, ...extra]) {
      const createdAt = atBrt(-n.daysAgo, 9 + (n.title.length % 8), n.title.length % 60);
      await prisma.userNotification.create({
        data: {
          userId: user.id,
          title: n.title,
          message: n.message,
          type: n.type,
          isRead: n.isRead ?? false,
          isNew: !(n.isRead ?? false),
          actionUrl: n.actionUrl?.replace('{shop}', String(shopId)),
          actionText: n.actionText,
          createdAt,
        },
      });
    }
  }
}

const CLIENT_ACCOUNTS = [
  { email: 'lucas.ferreira@cliente.com', name: 'Lucas Ferreira', phone: '(12) 98111-2233' },
  { email: 'mariana.costa@cliente.com', name: 'Mariana Costa', phone: '(12) 98222-3344' },
  { email: 'pedro.almeida@cliente.com', name: 'Pedro Almeida', phone: '(11) 98333-4455' },
  { email: 'rafaela.souza@cliente.com', name: 'Rafaela Souza', phone: '(19) 98444-5566' },
];

async function ensureClientAccounts(prisma: PrismaClient) {
  const accounts = [];
  for (const c of CLIENT_ACCOUNTS) {
    let account = await prisma.clientAccount.findUnique({ where: { email: c.email } });
    if (!account) {
      console.log(`Creating client account ${c.email}...`);
      account = await prisma.clientAccount.create({ data: { ...c, password: SEED_PASSWORD } });
    }
    accounts.push(account);
  }
  return accounts;
}

const REVIEW_COMMENTS = [
  'Melhor corte que já fiz na cidade, atendimento impecável.',
  'Ambiente muito agradável e o barbeiro caprichou na barba.',
  'Pontuais e cuidadosos. Voltarei com certeza!',
  'Bom atendimento, só achei o preço um pouco salgado.',
];

const SERVICES: {
  name: string;
  icon: string;
  category: TreatmentCategory;
  durationMinutes: number;
  price: number;
  description: string;
  depositAmount?: number;
}[] = [
  {
    name: 'Corte masculino',
    icon: '✂️',
    category: 'HAIR',
    durationMinutes: 30,
    price: 45,
    description: 'Corte tradicional ou moderno, com lavagem e finalização.',
  },
  {
    name: 'Barba completa',
    icon: '🧔',
    category: 'BEARD',
    durationMinutes: 30,
    price: 35,
    description: 'Barba com toalha quente, navalha e hidratação.',
  },
  {
    name: 'Corte + Barba',
    icon: '💈',
    category: 'COMBO',
    durationMinutes: 60,
    price: 70,
    description: 'Combo completo com desconto.',
  },
  {
    name: 'Degradê (fade)',
    icon: '🔥',
    category: 'HAIR',
    durationMinutes: 45,
    price: 55,
    description: 'Fade na máquina e navalha, do zero ao topo.',
  },
  {
    name: 'Pigmentação de barba',
    icon: '🎨',
    category: 'COLORING',
    durationMinutes: 40,
    price: 50,
    description: 'Preenche falhas e uniformiza a cor da barba.',
  },
  {
    name: 'Platinado',
    icon: '⚡',
    category: 'COLORING',
    durationMinutes: 120,
    price: 180,
    description: 'Descoloração global com matização.',
    depositAmount: 50,
  },
  {
    name: 'Sobrancelha',
    icon: '👁️',
    category: 'BROWS_LASHES',
    durationMinutes: 15,
    price: 20,
    description: 'Design de sobrancelha na navalha ou pinça.',
  },
  {
    name: 'Limpeza de pele',
    icon: '🧖',
    category: 'SKIN',
    durationMinutes: 40,
    price: 60,
    description: 'Limpeza profunda com esfoliação e máscara.',
  },
];

const PRODUCT_CATEGORIES = [
  { name: 'Cabelo', icon: '💇', color: '#16a34a' },
  { name: 'Barba', icon: '🧔', color: '#ca8a04' },
  { name: 'Bebidas', icon: '🥤', color: '#2563eb' },
];

const PRODUCTS = [
  {
    name: 'Pomada Modeladora Matte',
    sku: 'POM-MATTE',
    category: 'Cabelo',
    icon: '🫙',
    salePrice: 49.9,
    costPrice: 22,
    stock: 3,
    min: 5,
  },
  {
    name: 'Pomada Efeito Molhado',
    sku: 'POM-WET',
    category: 'Cabelo',
    icon: '🫙',
    salePrice: 45.9,
    costPrice: 20,
    stock: 14,
    min: 5,
  },
  {
    name: 'Shampoo Anticaspa 250ml',
    sku: 'SHA-250',
    category: 'Cabelo',
    icon: '🧴',
    salePrice: 39.9,
    costPrice: 16,
    stock: 10,
    min: 4,
  },
  {
    name: 'Óleo para Barba 30ml',
    sku: 'OLE-30',
    category: 'Barba',
    icon: '💧',
    salePrice: 42,
    costPrice: 17,
    stock: 9,
    min: 4,
  },
  {
    name: 'Balm para Barba',
    sku: 'BAL-60',
    category: 'Barba',
    icon: '🫙',
    salePrice: 38,
    costPrice: 15,
    stock: 2,
    min: 3,
  },
  {
    name: 'Minoxidil 5%',
    sku: 'MIN-5',
    category: 'Barba',
    icon: '🧪',
    salePrice: 89.9,
    costPrice: 45,
    stock: 6,
    min: 2,
  },
  {
    name: 'Cerveja artesanal',
    sku: 'BEB-CERV',
    category: 'Bebidas',
    icon: '🍺',
    salePrice: 15,
    costPrice: 7,
    stock: 36,
    min: 12,
  },
  {
    name: 'Refrigerante lata',
    sku: 'BEB-REFRI',
    category: 'Bebidas',
    icon: '🥤',
    salePrice: 7,
    costPrice: 3,
    stock: 40,
    min: 12,
  },
];

const CUSTOMER_NAMES = [
  'Lucas Ferreira',
  'Mariana Costa',
  'Gabriel Santos',
  'Matheus Oliveira',
  'Rafael Lima',
  'Bruno Carvalho',
  'Felipe Rocha',
  'Gustavo Martins',
  'Thiago Ribeiro',
  'André Gomes',
  'Diego Araújo',
  'Leonardo Barbosa',
  'Vinícius Pereira',
  'Eduardo Nunes',
  'Caio Mendes',
  'Rodrigo Teixeira',
  'Henrique Cardoso',
  'Daniel Moreira',
  'Fernanda Dias',
  'Juliana Castro',
  'Ricardo Freitas',
  'Paulo Vieira',
  'Marcelo Azevedo',
  'Igor Pinto',
];

// Operação completa de uma unidade: serviços, produtos, estoque, equipe com
// agenda e comissão, clientes, ~2 meses de agendamentos com vendas, caixa,
// despesas, lista de espera, fila de walk-in, pacotes, assinaturas do cliente,
// campanhas, indicações, taxas de no-show, cartões-presente e avaliações.
async function seedGreenOperations(
  prisma: PrismaClient,
  shopId: number,
  clientAccounts: { id: number; email: string; name: string }[],
) {
  const shop = await prisma.barbershop.findUniqueOrThrow({
    where: { id: shopId },
    include: { network: true },
  });
  if ((await prisma.appointment.count({ where: { barbershopId: shopId } })) > 0) {
    console.log('Green Barbershop already has operational data, skipping...');
    return;
  }
  console.log('Creating Green Barbershop operational demo data...');
  faker.seed(2026);
  const networkId = shop.networkId;
  const ownerId = shop.ownerUserId!;
  const staffUser = await prisma.user.findFirst({
    where: { email: 'bianca.silverio@barbershop.com' },
  });
  const operatorId = staffUser?.id ?? ownerId;

  // Rede: identidade, fidelidade, indicação e política de no-show
  await prisma.network.update({
    where: { id: networkId },
    data: {
      name: 'Green Barbershop',
      city: 'São José dos Campos',
      description: 'Barbearia clássica com pegada moderna, no coração do Jardim Aquarius.',
      mission: 'Entregar o melhor corte da cidade com atendimento de verdade.',
      foundationYear: 2018,
      loyaltyEnabled: true,
      loyaltyPointsPerCurrencyUnit: 1,
      loyaltyPointValue: 0.05,
      referralBonusPoints: 100,
      noShowFeeEnabled: true,
      noShowFeeType: 'PERCENTAGE',
      noShowFeeValue: 50,
      lateCancellationWindowHours: 12,
    },
  });

  // Serviços (o seed base já cria "Corte masculino")
  const services: Prisma.BarbershopServiceGetPayload<object>[] = [];
  for (const [i, s] of SERVICES.entries()) {
    const existing = await prisma.barbershopService.findFirst({
      where: { barbershopId: shopId, name: s.name },
    });
    services.push(
      existing
        ? await prisma.barbershopService.update({
            where: { id: existing.id },
            data: { ...s, displayOrder: i },
          })
        : await prisma.barbershopService.create({
            data: { ...s, barbershopId: shopId, displayOrder: i },
          }),
    );
  }
  const svc = (name: string) => services.find((s) => s.name === name)!;
  const bookable = services.filter((s) => s.name !== 'Platinado');

  // Produtos + estoque
  const categories = [];
  for (const [i, c] of PRODUCT_CATEGORIES.entries()) {
    categories.push(
      await prisma.productCategory.create({
        data: { ...c, barbershopId: shopId, displayOrder: i },
      }),
    );
  }
  const products = [];
  for (const p of PRODUCTS) {
    const product = await prisma.barbershopProduct.create({
      data: {
        barbershopId: shopId,
        categoryId: categories.find((c) => c.name === p.category)!.id,
        name: p.name,
        sku: p.sku,
        icon: p.icon,
        salePrice: p.salePrice,
        costPrice: p.costPrice,
      },
    });
    const initial = p.stock + 10;
    const item = await prisma.inventoryItem.create({
      data: {
        barbershopId: shopId,
        productId: product.id,
        quantity: p.stock,
        minQuantity: p.min,
        location: p.category === 'Bebidas' ? 'Frigobar' : 'Prateleira do balcão',
        lastCountedAt: atBrt(-7, 18),
      },
    });
    await prisma.inventoryMovement.createMany({
      data: [
        {
          inventoryItemId: item.id,
          movementType: 'PURCHASE',
          quantityChange: initial,
          quantityBefore: 0,
          quantityAfter: initial,
          referenceType: 'MANUAL',
          notes: 'Compra inicial do fornecedor',
          createdAt: atBrt(-60, 10),
        },
        {
          inventoryItemId: item.id,
          movementType: 'SALE',
          quantityChange: -10,
          quantityBefore: initial,
          quantityAfter: p.stock,
          referenceType: 'SALE',
          notes: 'Vendas do período',
          createdAt: atBrt(-1, 18),
        },
      ],
    });
    products.push({ ...product, price: p.salePrice });
  }

  // Recursos (cadeiras)
  const resources = [];
  for (const name of ['Cadeira 1', 'Cadeira 2', 'Cadeira 3']) {
    resources.push(
      await prisma.resource.create({ data: { barbershopId: shopId, name, type: 'CHAIR' } }),
    );
  }
  await prisma.resource.create({
    data: { barbershopId: shopId, name: 'Sala de estética', type: 'ROOM' },
  });

  // Equipe: os barbeiros-semente + 2 profissionais sem login
  const existingStaff = await prisma.barber.findMany({ where: { barbershopId: shopId } });
  for (const b of existingStaff) {
    const specialties: TreatmentCategory[] =
      b.staffType === 'manager' || b.staffType === 'reception'
        ? []
        : b.name === 'Cayo Carlos'
        ? ['HAIR', 'BEARD', 'COMBO']
        : ['HAIR', 'COLORING'];
    await prisma.barber.update({
      where: { id: b.id },
      data: { specialties, hireDate: atBrt(-700, 9) },
    });
  }
  const newStaff = [
    {
      name: 'Diego Navalha',
      specialization: 'Barba e navalha',
      specialties: ['BEARD', 'COMBO'] as TreatmentCategory[],
      phone: '(12) 99700-1001',
    },
    {
      name: 'Camila Rocha',
      specialization: 'Estética e sobrancelha',
      specialties: ['BROWS_LASHES', 'SKIN'] as TreatmentCategory[],
      phone: '(12) 99700-1002',
    },
  ];
  for (const s of newStaff) {
    await prisma.barber.create({
      data: {
        barbershopId: shopId,
        staffType: 'barber',
        email: `${s.name.split(' ')[0].toLowerCase()}@greenbarbershop.com`,
        hireDate: atBrt(-300, 9),
        ...s,
      },
    });
  }
  const barbers = await prisma.barber.findMany({
    // Quem atende: gerente e recepção não têm agenda
    where: { barbershopId: shopId, staffType: { notIn: ['manager', 'reception'] } },
  });

  // Agenda semanal (seg-sáb) com almoço, e férias do Minion no mês que vem
  for (const b of barbers) {
    for (let day = 1; day <= 6; day++) {
      await prisma.barberSchedule.create({
        data: {
          barberId: b.id,
          dayOfWeek: day,
          startTime: day === 6 ? '08:00' : '09:00',
          endTime: day === 6 ? '16:00' : '19:00',
          breakStart: day === 6 ? null : '12:00',
          breakEnd: day === 6 ? null : '13:00',
        },
      });
    }
  }
  const minion = barbers.find((b) => b.name === 'Minion Cayo');
  if (minion) {
    await prisma.barberTimeOff.create({
      data: {
        barberId: minion.id,
        startAt: atBrt(20, 0),
        endAt: atBrt(30, 23),
        reason: 'VACATION',
      },
    });
  }

  // Comissões: padrão da unidade + regra própria do Minion
  await prisma.commissionRule.createMany({
    data: [
      { barbershopId: shopId, barberId: null, itemType: 'SERVICE', percentage: 40 },
      { barbershopId: shopId, barberId: null, itemType: 'PRODUCT', percentage: 10 },
      ...(minion
        ? [{ barbershopId: shopId, barberId: minion.id, itemType: 'SERVICE', percentage: 50 }]
        : []),
    ],
  });

  // Clientes: aniversariantes deste mês, inativos há 60+ dias, um opt-out
  const now = new Date();
  const customers = [];
  for (const [i, name] of CUSTOMER_NAMES.entries()) {
    const existing = await prisma.customer.findFirst({ where: { networkId, name } });
    const birthMonth = i % 6 === 0 ? now.getUTCMonth() : (i * 5) % 12;
    const data = {
      networkId,
      name,
      phone: `(12) 9${String(8100 + i * 37).padStart(4, '0')}-${String(1000 + i * 211).slice(-4)}`,
      email: `${name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(' ', '.')}@email.com`,
      birthDate: new Date(Date.UTC(1980 + (i % 20), birthMonth, 1 + ((i * 3) % 27), 12)),
      notes:
        i === 3
          ? 'Prefere máquina 2 nas laterais.'
          : i === 7
          ? 'Alérgico a produtos com álcool.'
          : null,
      marketingOptOut: i === 10,
      clientAccountId: clientAccounts.find((c) => c.name === name)?.id ?? null,
    };
    customers.push(
      existing
        ? await prisma.customer.update({ where: { id: existing.id }, data })
        : await prisma.customer.create({ data }),
    );
  }
  const joao = await prisma.customer.findFirst({ where: { networkId, name: 'João Silva' } });
  if (joao) customers.push(joao);
  // Os 4 últimos só aparecem em agendamentos antigos → segmento "inativos"
  const regulars = customers.slice(0, customers.length - 4);
  const inactives = customers.slice(customers.length - 4);

  // Caixas: sessões fechadas nos dias anteriores, e uma aberta hoje
  const cashSessions = new Map<number, number>();
  for (let day = -6; day <= 0; day++) {
    const opening = 200;
    const session = await prisma.cashSession.create({
      data: {
        barbershopId: shopId,
        openedByUserId: operatorId,
        openedAt: atBrt(day, 8, 45),
        openingBalance: opening,
        status: day === 0 ? 'OPEN' : 'CLOSED',
        closedByUserId: day === 0 ? null : operatorId,
        closedAt: day === 0 ? null : atBrt(day, 19, 30),
      },
    });
    cashSessions.set(day, session.id);
  }

  // Agendamentos: 60 dias pra trás (concluídos, com alguns no-show e
  // cancelados) e 14 pra frente (confirmados). Slots por barbeiro não se
  // sobrepõem: cada barbeiro anda pelo dia a partir das 9h.
  const loyaltyEarned = new Map<number, number>();
  const cashTotals = new Map<number, number>();
  const noShowAppointments: {
    id: number;
    customerId: number;
    price: number;
    reason: string;
    at: Date;
  }[] = [];
  let appointmentsCreated = 0;
  for (let day = -60; day <= 14; day++) {
    const weekday = atBrt(day, 12).getUTCDay();
    if (weekday === 0) continue; // domingo fechado
    for (const barber of barbers) {
      if (minion && barber.id === minion.id && day >= 20) continue; // férias
      const perDay = faker.datatype.number({ min: day < 0 ? 2 : 1, max: day < 0 ? 5 : 3 });
      let cursor = atBrt(day, weekday === 6 ? 8 : 9, faker.helpers.arrayElement([0, 30]));
      for (let n = 0; n < perDay; n++) {
        const service =
          barber.name === 'Camila Rocha'
            ? faker.helpers.arrayElement([svc('Sobrancelha'), svc('Limpeza de pele')])
            : faker.helpers.arrayElement(
                bookable.filter((s) => s.category !== 'SKIN' && s.category !== 'BROWS_LASHES'),
              );
        const customer =
          day < -45 && n === 0
            ? faker.helpers.arrayElement(inactives)
            : faker.helpers.arrayElement(regulars);
        const startAt = cursor;
        const endAt = addMinutes(startAt, service.durationMinutes);
        cursor = addMinutes(endAt, faker.helpers.arrayElement([0, 15, 30, 60]));
        if (endAt.getUTCHours() - 3 >= 19) break;

        let status = 'CONFIRMED';
        if (day < 0) {
          const roll = faker.datatype.number(100);
          status = roll < 6 ? 'NO_SHOW' : roll < 12 ? 'CANCELLED' : 'COMPLETED';
        } else if (day === 0) {
          const hourNow = new Date().getUTCHours() - 3;
          const startHour = startAt.getUTCHours() - 3;
          status =
            startHour < hourNow - 1
              ? 'COMPLETED'
              : startHour <= hourNow
              ? 'IN_PROGRESS'
              : 'CONFIRMED';
        }
        const price = Number(service.price);
        const appointment = await prisma.appointment.create({
          data: {
            barbershopId: shopId,
            customerId: customer.id,
            barberId: barber.id,
            resourceId: resources[barbers.indexOf(barber) % resources.length].id,
            startAt,
            endAt,
            status,
            source: faker.helpers.arrayElement(['ONLINE', 'ONLINE', 'PHONE', 'WALK_IN']),
            reminderSentAt: day >= -1 ? addMinutes(startAt, -24 * 60) : null,
            depositAmount: service.depositAmount,
            depositPaid: service.depositAmount ? day < 0 : false,
            notes: n === 0 && day % 9 === 0 ? 'Cliente pediu para acabar com navalha.' : null,
            createdAt: addMinutes(
              startAt,
              -faker.datatype.number({ min: 60 * 24, max: 60 * 24 * 7 }),
            ),
            services: { create: [{ serviceId: service.id, unitPrice: service.price }] },
          },
        });
        appointmentsCreated++;
        if (status === 'NO_SHOW')
          noShowAppointments.push({
            id: appointment.id,
            customerId: customer.id,
            price,
            reason: 'NO_SHOW',
            at: endAt,
          });
        if (status === 'CANCELLED' && noShowAppointments.length % 2 === 0) {
          noShowAppointments.push({
            id: appointment.id,
            customerId: customer.id,
            price,
            reason: 'LATE_CANCELLATION',
            at: addMinutes(startAt, -6 * 60),
          });
        }
        if (status !== 'COMPLETED') continue;

        // Atendimento concluído → histórico + venda paga (às vezes com produto)
        const history = await prisma.serviceHistory.create({
          data: {
            barbershopId: shopId,
            customerId: customer.id,
            barberId: barber.id,
            appointmentId: appointment.id,
            serviceId: service.id,
            performedAt: startAt,
            priceCharged: service.price,
            durationMinutes: service.durationMinutes,
          },
        });
        const product =
          faker.datatype.number(100) < 25 ? faker.helpers.arrayElement(products) : null;
        const subtotal = money(price + (product ? product.price : 0));
        const discount = faker.datatype.number(100) < 10 ? money(subtotal * 0.1) : 0;
        const total = money(subtotal - discount);
        const points = Math.floor(total);
        loyaltyEarned.set(customer.id, (loyaltyEarned.get(customer.id) ?? 0) + points);
        const paymentMethod = faker.helpers.arrayElement(['PIX', 'PIX', 'CARD', 'CARD', 'CASH']);
        const cashSessionId = cashSessions.get(day) ?? null;
        if (cashSessionId && paymentMethod === 'CASH')
          cashTotals.set(day, (cashTotals.get(day) ?? 0) + total);
        await prisma.sale.create({
          data: {
            barbershopId: shopId,
            customerId: customer.id,
            barberId: barber.id,
            appointmentId: appointment.id,
            cashSessionId,
            saleType: product ? 'MIXED' : 'SERVICE',
            subtotal,
            discountAmount: discount,
            total,
            paymentStatus: 'PAID',
            paymentMethod,
            paidAt: endAt,
            loyaltyPointsEarned: points,
            createdAt: endAt,
            items: {
              create: [
                {
                  itemType: 'SERVICE',
                  serviceId: service.id,
                  serviceHistoryId: history.id,
                  quantity: 1,
                  unitPrice: price,
                  totalPrice: price,
                },
                ...(product
                  ? [
                      {
                        itemType: 'PRODUCT',
                        productId: product.id,
                        quantity: 1,
                        unitPrice: product.price,
                        totalPrice: product.price,
                      },
                    ]
                  : []),
              ],
            },
          },
        });
      }
    }
  }
  console.log(`  ${appointmentsCreated} appointments created`);

  // Venda avulsa de produto no balcão hoje, ainda pendente de pagamento
  await prisma.sale.create({
    data: {
      barbershopId: shopId,
      customerId: regulars[2].id,
      cashSessionId: cashSessions.get(0),
      saleType: 'PRODUCT',
      subtotal: products[1].price,
      total: products[1].price,
      paymentStatus: 'PENDING',
      items: {
        create: [
          {
            itemType: 'PRODUCT',
            productId: products[1].id,
            quantity: 1,
            unitPrice: products[1].price,
            totalPrice: products[1].price,
          },
        ],
      },
    },
  });

  // Pontos de fidelidade = ganhos nas vendas (menos um resgate de exemplo)
  for (const [customerId, points] of loyaltyEarned) {
    await prisma.customer.update({ where: { id: customerId }, data: { loyaltyPoints: points } });
  }

  // Fecha os caixas anteriores batendo com as vendas em dinheiro (um com
  // diferença, pra tela de caixa mostrar sobra/falta)
  for (const [day, sessionId] of cashSessions) {
    if (day === 0) continue;
    const expected = money(200 + (cashTotals.get(day) ?? 0));
    const counted = day === -3 ? money(expected - 12.5) : expected;
    await prisma.cashSession.update({
      where: { id: sessionId },
      data: {
        expectedBalance: expected,
        countedBalance: counted,
        difference: money(counted - expected),
        notes: day === -3 ? 'Faltou troco de uma venda.' : null,
      },
    });
  }

  // Despesas do mês
  const expenses = [
    {
      category: 'RENT',
      description: 'Aluguel do salão',
      amount: 3500,
      paymentMethod: 'TRANSFER',
      day: -20,
    },
    {
      category: 'UTILITIES',
      description: 'Conta de luz',
      amount: 480.35,
      paymentMethod: 'PIX',
      day: -12,
    },
    {
      category: 'UTILITIES',
      description: 'Internet',
      amount: 129.9,
      paymentMethod: 'CARD',
      day: -10,
    },
    {
      category: 'SUPPLIES',
      description: 'Lâminas e toalhas descartáveis',
      amount: 215.4,
      paymentMethod: 'CASH',
      day: -2,
    },
    {
      category: 'MAINTENANCE',
      description: 'Conserto da cadeira 2',
      amount: 180,
      paymentMethod: 'PIX',
      day: -5,
    },
    {
      category: 'OTHER',
      description: 'Café e água para clientes',
      amount: 64.5,
      paymentMethod: 'CASH',
      day: 0,
    },
  ];
  for (const e of expenses) {
    await prisma.expense.create({
      data: {
        barbershopId: shopId,
        cashSessionId: cashSessions.get(e.day) ?? null,
        category: e.category,
        description: e.description,
        amount: e.amount,
        paymentMethod: e.paymentMethod,
        expenseDate: atBrt(e.day, 11),
        createdByUserId: operatorId,
      },
    });
  }

  // Taxas de no-show/cancelamento tardio (50% do serviço pela política da rede)
  // Os 6 mais recentes — taxa antiga demais já teria sido resolvida
  for (const [i, a] of noShowAppointments.slice(-6).entries()) {
    const status = i % 3 === 0 ? 'PENDING' : i % 3 === 1 ? 'COLLECTED' : 'WAIVED';
    await prisma.noShowFee.create({
      data: {
        appointmentId: a.id,
        customerId: a.customerId,
        barbershopId: shopId,
        amount: money(a.price * 0.5),
        currency: 'BRL',
        reason: a.reason,
        status,
        collectedAt:
          status === 'COLLECTED'
            ? new Date(Math.min(addMinutes(a.at, 3 * 24 * 60).getTime(), Date.now()))
            : null,
        createdAt: a.at,
      },
    });
  }

  // Fila de walk-in de hoje
  const walkIns = [
    {
      customerName: 'Otávio Prado',
      status: 'COMPLETED',
      servedAt: atBrt(0, 9, 10),
      service: 'Corte masculino',
    },
    {
      customerName: regulars[4].name,
      customerId: regulars[4].id,
      status: 'IN_PROGRESS',
      servedAt: atBrt(0, 10),
      service: 'Barba completa',
    },
    {
      customerName: 'Sérgio Lopes',
      customerPhone: '(12) 99123-4567',
      status: 'WAITING',
      service: 'Corte + Barba',
    },
    { customerName: 'Arthur Maia', status: 'WAITING', service: 'Degradê (fade)' },
  ];
  for (const [i, w] of walkIns.entries()) {
    const { service, ...rest } = w;
    await prisma.walkIn.create({
      data: {
        barbershopId: shopId,
        barberId: w.status === 'WAITING' ? null : barbers[i % barbers.length].id,
        queuePosition: i + 1,
        createdAt: atBrt(0, 8, 50 + i * 2),
        ...rest,
        services: { create: [{ serviceId: svc(service).id }] },
      },
    });
  }

  // Lista de espera
  await prisma.waitlistEntry.createMany({
    data: [
      {
        barbershopId: shopId,
        customerId: regulars[5].id,
        barberId: barbers[0].id,
        serviceId: svc('Corte masculino').id,
        date: atBrt(1, 12),
        notes: 'Qualquer horário depois das 17h.',
      },
      {
        barbershopId: shopId,
        customerId: regulars[6].id,
        serviceId: svc('Corte + Barba').id,
        date: atBrt(2, 12),
      },
      {
        barbershopId: shopId,
        customerId: regulars[7].id,
        date: atBrt(-1, 12),
        status: 'NOTIFIED',
        notifiedAt: atBrt(-2, 16),
      },
    ],
  });

  // Pacotes de sessões
  const packCut = await prisma.servicePackage.create({
    data: {
      barbershopId: shopId,
      serviceId: svc('Corte masculino').id,
      name: 'Pacote 5 cortes',
      totalSessions: 5,
      price: 200,
    },
  });
  const packBeard = await prisma.servicePackage.create({
    data: {
      barbershopId: shopId,
      serviceId: svc('Barba completa').id,
      name: 'Pacote 4 barbas',
      totalSessions: 4,
      price: 120,
    },
  });
  await prisma.clientPackage.createMany({
    data: [
      {
        barbershopId: shopId,
        customerId: regulars[0].id,
        servicePackageId: packCut.id,
        totalSessions: 5,
        usedSessions: 2,
      },
      {
        barbershopId: shopId,
        customerId: regulars[1].id,
        servicePackageId: packBeard.id,
        totalSessions: 4,
        usedSessions: 4,
        status: 'COMPLETED',
      },
      {
        barbershopId: shopId,
        customerId: regulars[8].id,
        servicePackageId: packCut.id,
        totalSessions: 5,
        usedSessions: 0,
      },
    ],
  });

  // Planos de assinatura do cliente final + assinantes (IDs Stripe fictícios —
  // o seed não fala com o Stripe; cancelar pela tela vai falhar no Stripe)
  const unlimitedCut = await prisma.clientSubscriptionPlan.create({
    data: {
      barbershopId: shopId,
      serviceId: svc('Corte masculino').id,
      name: 'Corte ilimitado',
      price: 99,
      sessionsPerCycle: null,
    },
  });
  await prisma.clientSubscriptionPlan.create({
    data: {
      barbershopId: shopId,
      serviceId: svc('Corte + Barba').id,
      name: 'Clube Corte + Barba (2x/mês)',
      price: 119,
      sessionsPerCycle: 2,
    },
  });
  for (const [i, account] of clientAccounts.slice(0, 2).entries()) {
    const periodStart = atBrt(-10 - i * 5, 10);
    const sub = await prisma.clientSubscription.create({
      data: {
        barbershopId: shopId,
        clientAccountId: account.id,
        planId: unlimitedCut.id,
        stripeSubscriptionId: `sub_seed_green_${account.id}`,
        status: 'ACTIVE',
        currentPeriodStart: periodStart,
        currentPeriodEnd: addMinutes(periodStart, 30 * 24 * 60),
        usedThisCycle: i + 1,
      },
    });
    for (let cycle = 0; cycle < 2; cycle++) {
      await prisma.clientSubscriptionPayment.create({
        data: {
          subscriptionId: sub.id,
          stripeInvoiceId: `in_seed_green_${account.id}_${cycle}`,
          amount: 99,
          status: 'SUCCEEDED',
          periodStart: addMinutes(periodStart, -cycle * 30 * 24 * 60),
          periodEnd: addMinutes(periodStart, (1 - cycle) * 30 * 24 * 60),
          createdAt: addMinutes(periodStart, -cycle * 30 * 24 * 60),
        },
      });
    }
  }

  // Campanhas já disparadas
  await prisma.marketingCampaign.createMany({
    data: [
      {
        barbershopId: shopId,
        createdByUserId: ownerId,
        subject: 'Sentimos sua falta!',
        message:
          'Faz tempo que você não aparece. Volte esta semana e ganhe 10% de desconto no corte.',
        segment: 'INACTIVE',
        inactiveDays: 45,
        sentByEmail: true,
        recipientCount: 4,
        emailSentCount: 4,
        createdAt: atBrt(-15, 10),
      },
      {
        barbershopId: shopId,
        createdByUserId: operatorId,
        subject: 'Feliz aniversário! 🎉',
        message: 'No mês do seu aniversário a barba é por nossa conta.',
        segment: 'BIRTHDAY_MONTH',
        sentByEmail: true,
        sentByWhatsapp: true,
        recipientCount: 4,
        emailSentCount: 4,
        whatsappSentCount: 3,
        createdAt: atBrt(-3, 9),
      },
    ],
  });

  // Indicações entre clientes
  await prisma.customerReferral.createMany({
    data: [
      {
        networkId,
        referrerId: regulars[0].id,
        referredId: regulars[9].id,
        pointsAwarded: 100,
        completedAt: atBrt(-20, 15),
        createdAt: atBrt(-25, 15),
      },
      {
        networkId,
        referrerId: regulars[0].id,
        referredId: regulars[11].id,
        createdAt: atBrt(-4, 11),
      },
      {
        networkId,
        referrerId: regulars[2].id,
        referredId: regulars[12].id,
        pointsAwarded: 100,
        completedAt: atBrt(-8, 17),
        createdAt: atBrt(-12, 17),
      },
    ],
  });

  // Cartões-presente
  await prisma.giftCard.createMany({
    data: [
      {
        networkId,
        code: 'GIFT-GREEN001',
        initialValue: 100,
        remainingValue: 100,
        purchaserName: 'Fernanda Dias',
        recipientName: 'Carlos Dias',
        message: 'Feliz aniversário, pai!',
        expiresAt: atBrt(180, 23),
      },
      {
        networkId,
        code: 'GIFT-GREEN002',
        initialValue: 150,
        remainingValue: 55,
        purchaserName: 'Juliana Castro',
        recipientName: 'Ricardo Freitas',
        expiresAt: atBrt(120, 23),
      },
      {
        networkId,
        code: 'GIFT-GREEN003',
        initialValue: 80,
        remainingValue: 0,
        purchaserName: 'Paulo Vieira',
        isActive: false,
        createdAt: atBrt(-90, 10),
      },
    ],
  });

  // Fichas de anamnese / consentimento
  await prisma.consentForm.createMany({
    data: [
      {
        barbershopId: shopId,
        customerId: regulars[3].id,
        formType: 'ANAMNESIS',
        category: 'SKIN',
        answers: JSON.stringify({ alergias: 'Nenhuma', usaAcido: false }),
        signatureName: regulars[3].name,
        signedAt: atBrt(-10, 14),
        status: 'SIGNED',
      },
      {
        barbershopId: shopId,
        customerId: regulars[7].id,
        formType: 'ALLERGY_TEST',
        category: 'COLORING',
        status: 'PENDING',
        expiresAt: atBrt(2, 12),
      },
    ],
  });

  // Avaliações e favoritos dos clientes com conta
  for (const [i, account] of clientAccounts.entries()) {
    await prisma.review.create({
      data: {
        barbershopId: shopId,
        clientAccountId: account.id,
        rating: i === 3 ? 4 : 5,
        comment: REVIEW_COMMENTS[i % REVIEW_COMMENTS.length],
        createdAt: atBrt(-2 - i * 6, 20),
      },
    });
    await prisma.clientFavorite.create({ data: { clientAccountId: account.id, networkId } });
  }
}

// Segunda unidade da rede do Cayo (plano Premium permite várias) — dá
// conteúdo às telas de franquia que agregam mais de uma unidade.
async function ensureSecondUnit(prisma: PrismaClient, networkId: number, ownerId: number) {
  if (await prisma.barbershop.findUnique({ where: { slug: 'green-barbershop-centro' } })) return;
  console.log('Creating Green Barbershop Centro (second unit)...');
  const shop = await prisma.barbershop.create({
    data: {
      name: 'Green Barbershop Centro',
      slug: 'green-barbershop-centro',
      address: 'Rua Sete de Setembro, 312',
      city: 'São José dos Campos',
      state: 'SP',
      country: 'BR',
      postalCode: '12210-260',
      phone: '(12) 3921-4455',
      email: 'centro@greenbarbershop.com',
      latitude: -23.1794,
      longitude: -45.8869,
      businessHours: BUSINESS_HOURS,
      networkId,
      ownerUserId: ownerId,
    },
  });
  const cut = await prisma.barbershopService.create({
    data: {
      barbershopId: shop.id,
      name: 'Corte masculino',
      icon: '✂️',
      category: 'HAIR',
      durationMinutes: 30,
      price: 40,
    },
  });
  await prisma.barbershopService.create({
    data: {
      barbershopId: shop.id,
      name: 'Barba completa',
      icon: '🧔',
      category: 'BEARD',
      durationMinutes: 30,
      price: 30,
    },
  });
  const barber = await prisma.barber.create({
    data: {
      barbershopId: shop.id,
      name: 'Renato Souza',
      phone: '(12) 99700-2001',
      specialization: 'Cortes clássicos',
      specialties: ['HAIR'],
      hireDate: atBrt(-200, 9),
    },
  });
  const customers = await prisma.customer.findMany({ where: { networkId }, take: 6 });
  for (const [i, customer] of customers.entries()) {
    const startAt = atBrt(-i * 3 - 1, 10 + i);
    const endAt = addMinutes(startAt, 30);
    const appointment = await prisma.appointment.create({
      data: {
        barbershopId: shop.id,
        customerId: customer.id,
        barberId: barber.id,
        startAt,
        endAt,
        status: 'COMPLETED',
        source: 'PHONE',
        services: { create: [{ serviceId: cut.id, unitPrice: 40 }] },
      },
    });
    await prisma.sale.create({
      data: {
        barbershopId: shop.id,
        customerId: customer.id,
        barberId: barber.id,
        appointmentId: appointment.id,
        saleType: 'SERVICE',
        subtotal: 40,
        total: 40,
        paymentStatus: 'PAID',
        paymentMethod: 'PIX',
        paidAt: endAt,
        items: {
          create: [
            { itemType: 'SERVICE', serviceId: cut.id, quantity: 1, unitPrice: 40, totalPrice: 40 },
          ],
        },
      },
    });
  }
}

// Outras barbearias (de outros donos), pra busca pública e o backoffice
// terem mais de um resultado. Login dos donos: <email> / pwned.
const OTHER_SHOPS = [
  {
    owner: {
      email: 'marcos.andrade@barbershop.com',
      fullName: 'Marcos Andrade',
      phone: '+5511992220001',
      cpfBase: '248438034',
      city: 'São Paulo',
      zipcode: '05415-000',
      street: 'Rua Teodoro Sampaio, 1020',
      neighborhood: 'Pinheiros',
    },
    shop: {
      name: 'Barbearia Vintage',
      slug: 'barbearia-vintage',
      address: 'Rua dos Pinheiros, 870',
      city: 'São Paulo',
      state: 'SP',
      postalCode: '05422-001',
      phone: '(11) 3081-2233',
      email: 'contato@barbeariavintage.com',
      latitude: -23.5657,
      longitude: -46.6853,
      featured: false,
    },
    services: [
      {
        name: 'Corte clássico',
        icon: '✂️',
        category: 'HAIR' as TreatmentCategory,
        durationMinutes: 40,
        price: 70,
      },
      {
        name: 'Barba à moda antiga',
        icon: '🪒',
        category: 'BEARD' as TreatmentCategory,
        durationMinutes: 40,
        price: 60,
      },
      {
        name: 'Corte + Barba Vintage',
        icon: '💈',
        category: 'COMBO' as TreatmentCategory,
        durationMinutes: 75,
        price: 115,
      },
    ],
    barberName: 'Marcos Andrade',
    ratings: [5, 4, 5],
  },
  {
    owner: {
      email: 'tiago.moura@barbershop.com',
      fullName: 'Tiago Moura',
      phone: '+5519992220002',
      cpfBase: '731025964',
      city: 'Campinas',
      zipcode: '13024-001',
      street: 'Avenida Norte-Sul, 400',
      neighborhood: 'Cambuí',
    },
    shop: {
      name: 'Studio Navalha',
      slug: 'studio-navalha',
      address: 'Rua Coronel Quirino, 1500',
      city: 'Campinas',
      state: 'SP',
      postalCode: '13025-002',
      phone: '(19) 3254-7788',
      email: 'ola@studionavalha.com',
      latitude: -22.8944,
      longitude: -47.0508,
      featured: true,
    },
    services: [
      {
        name: 'Corte degradê',
        icon: '🔥',
        category: 'HAIR' as TreatmentCategory,
        durationMinutes: 45,
        price: 50,
      },
      {
        name: 'Barba',
        icon: '🧔',
        category: 'BEARD' as TreatmentCategory,
        durationMinutes: 30,
        price: 35,
      },
      {
        name: 'Sobrancelha',
        icon: '👁️',
        category: 'BROWS_LASHES' as TreatmentCategory,
        durationMinutes: 15,
        price: 20,
      },
    ],
    barberName: 'Tiago Moura',
    ratings: [4, 4, 3, 5],
  },
];

async function ensureOtherShops(prisma: PrismaClient, clientAccounts: { id: number }[]) {
  const ownerRole = await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } });
  for (const o of OTHER_SHOPS) {
    if (await prisma.barbershop.findUnique({ where: { slug: o.shop.slug } })) continue;
    console.log(`Creating ${o.shop.name} (${o.owner.fullName})...`);
    let owner = await prisma.user.findUnique({
      where: { email_provider: { email: o.owner.email, provider: 'local' } },
    });
    if (!owner) {
      owner = await prisma.user.create({
        data: {
          email: o.owner.email,
          fullName: o.owner.fullName,
          provider: 'local',
          password: SEED_PASSWORD,
          phone: o.owner.phone,
          idDocNumber: cpf(o.owner.cpfBase),
          gender: 'male',
          birthdate: new Date('1985-06-15T12:00:00Z'),
          readTerms: true,
          isActive: true,
          roleId: ownerRole!.id,
          userSystemConfig: {
            create: {
              theme: 'dark',
              accentColor: 'bronze',
              grayColor: 'gray',
              radius: 'medium',
              scaling: '100%',
              language: 'pt',
            },
          },
          notificationPreference: { create: {} },
          address: {
            create: {
              zipcode: o.owner.zipcode,
              street: o.owner.street,
              neighborhood: o.owner.neighborhood,
              city: o.owner.city,
              state: 'SP',
              country: 'BR',
            },
          },
        },
      });
    }
    const network = await prisma.network.create({
      data: { ownerUserId: owner.id, name: o.shop.name, city: o.shop.city },
    });
    const { featured, ...shopData } = o.shop;
    const shop = await prisma.barbershop.create({
      data: {
        ...shopData,
        country: 'BR',
        businessHours: BUSINESS_HOURS,
        featuredUntil: featured ? atBrt(30, 23) : null,
        networkId: network.id,
        ownerUserId: owner.id,
      },
    });
    for (const [i, s] of o.services.entries()) {
      await prisma.barbershopService.create({
        data: { ...s, barbershopId: shop.id, displayOrder: i },
      });
    }
    await prisma.barber.create({
      data: {
        barbershopId: shop.id,
        userId: owner.id,
        name: o.barberName,
        phone: o.owner.phone,
        email: o.owner.email,
        specialization: 'Proprietário',
        specialties: ['HAIR', 'BEARD'],
      },
    });
    for (const [i, rating] of o.ratings.entries()) {
      const account = clientAccounts[i % clientAccounts.length];
      await prisma.review.upsert({
        where: {
          barbershopId_clientAccountId: { barbershopId: shop.id, clientAccountId: account.id },
        },
        create: {
          barbershopId: shop.id,
          clientAccountId: account.id,
          rating,
          comment: REVIEW_COMMENTS[(i + 1) % REVIEW_COMMENTS.length],
          createdAt: atBrt(-5 - i * 9, 19),
        },
        update: {},
      });
    }
  }
}

/**
 * Profissionais em mais de uma unidade (uma conta, um vínculo por unidade):
 * - Bianca também é gerente da Green Centro (mesmo dono)
 * - Minion é freelancer na Barbearia Vintage (outro dono) aos sábados, com
 *   vínculo temporário: começou há 30 dias e vai até daqui 60
 */
async function ensureMultiUnitStaff(prisma: PrismaClient) {
  const links = [
    {
      email: 'bianca.silverio@barbershop.com',
      slug: 'green-barbershop-centro',
      staffType: 'manager',
      specialization: 'Gerente',
      period: {},
      saturdayOnly: false,
    },
    {
      email: 'minion.cayo@barbershop.com',
      slug: 'barbearia-vintage',
      staffType: 'barber',
      specialization: 'Freelancer aos sábados',
      period: { accessStartsAt: atBrt(-30, 0), accessEndsAt: atBrt(60, 23) },
      saturdayOnly: true,
    },
  ];
  for (const l of links) {
    const [user, shop] = await Promise.all([
      prisma.user.findUnique({ where: { email_provider: { email: l.email, provider: 'local' } } }),
      prisma.barbershop.findUnique({ where: { slug: l.slug } }),
    ]);
    if (!user || !shop) continue;
    if (await prisma.barber.findFirst({ where: { barbershopId: shop.id, userId: user.id } })) {
      continue;
    }
    console.log(`Linking ${user.fullName} to ${shop.name} (${l.staffType})...`);
    const barber = await prisma.barber.create({
      data: {
        barbershopId: shop.id,
        userId: user.id,
        name: user.fullName,
        phone: user.phone ?? '(12) 99700-3001',
        email: user.email,
        staffType: l.staffType,
        specialization: l.specialization,
        specialties: l.staffType === 'manager' ? [] : ['HAIR'],
        ...l.period,
      },
    });
    if (l.saturdayOnly) {
      await prisma.barberSchedule.create({
        data: { barberId: barber.id, dayOfWeek: 6, startTime: '08:00', endTime: '16:00' },
      });
      for (let day = 0; day <= 5; day++) {
        await prisma.barberSchedule.create({
          data: {
            barberId: barber.id,
            dayOfWeek: day,
            startTime: '08:00',
            endTime: '16:00',
            isActive: false,
          },
        });
      }
    }
  }
}

/**
 * Espaço compartilhado (cadeira alugada): o Studio Navalha (Tiago, negócio
 * independente) atende no espaço da Green Barbershop, e a Barbearia Vintage
 * tem um convite pendente.
 */
async function ensureSharedLocation(prisma: PrismaClient) {
  const [green, navalha, vintage] = await Promise.all(
    ['green-barbershop', 'studio-navalha', 'barbearia-vintage'].map((slug) =>
      prisma.barbershop.findUnique({ where: { slug } }),
    ),
  );
  if (!green) return;
  const links = [
    { member: navalha, status: 'ACTIVE' },
    { member: vintage, status: 'PENDING' },
  ];
  for (const l of links) {
    if (!l.member) continue;
    const key = {
      hostBarbershopId_memberBarbershopId: {
        hostBarbershopId: green.id,
        memberBarbershopId: l.member.id,
      },
    };
    if (await prisma.sharedLocationMember.findUnique({ where: key })) continue;
    console.log(`Shared location: ${l.member.name} at ${green.name} (${l.status})...`);
    await prisma.sharedLocationMember.create({
      data: {
        hostBarbershopId: green.id,
        memberBarbershopId: l.member.id,
        status: l.status,
        invitedByUserId: green.ownerUserId,
        respondedAt: l.status === 'ACTIVE' ? atBrt(-20, 10) : null,
      },
    });
  }
}

/**
 * Aluguel da cadeira pago direto ao espaço: o Studio Navalha paga R$ 450/mês à
 * Green por PIX/dinheiro — dois meses pagos, um atrasado e o do mês em aberto.
 * Cada pagamento vira despesa "Aluguel" no Studio Navalha.
 */
async function ensureChairRent(prisma: PrismaClient) {
  const [green, navalha] = await Promise.all(
    ['green-barbershop', 'studio-navalha'].map((slug) =>
      prisma.barbershop.findUnique({ where: { slug } }),
    ),
  );
  if (!green || !navalha) return;
  const link = await prisma.sharedLocationMember.findUnique({
    where: {
      hostBarbershopId_memberBarbershopId: {
        hostBarbershopId: green.id,
        memberBarbershopId: navalha.id,
      },
    },
  });
  if (!link || link.status !== 'ACTIVE' || link.rentBillingMode === 'MANUAL') return;
  console.log('Chair rent: Studio Navalha pays Green monthly (PIX/cash)...');
  const now = new Date();
  const day = Math.min(now.getUTCDate(), 28);
  const due = (monthsAgo: number) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, day, 12));
  await prisma.sharedLocationMember.update({
    where: { id: link.id },
    data: {
      rentAmount: 450,
      rentCurrency: green.currency,
      rentBillingMode: 'MANUAL',
      rentStatus: 'ACTIVE',
      rentStartedAt: due(3),
    },
  });
  const rows = [
    { monthsAgo: 3, method: 'PIX' },
    { monthsAgo: 2, method: 'CASH' },
    { monthsAgo: 1, method: null }, // atrasado
    { monthsAgo: 0, method: null }, // do mês
  ];
  for (const r of rows) {
    const dueDate = due(r.monthsAgo);
    const paidAt = r.method ? new Date(dueDate.getTime() + 2 * 86_400_000) : null;
    const expense =
      r.method && navalha.ownerUserId
        ? await prisma.expense.create({
            data: {
              barbershopId: navalha.id,
              category: 'RENT',
              description: `Aluguel da cadeira — ${green.name}`,
              amount: 450,
              paymentMethod: r.method,
              expenseDate: paidAt!,
              createdByUserId: navalha.ownerUserId,
            },
          })
        : null;
    await prisma.chairRentPayment.create({
      data: {
        sharedLocationMemberId: link.id,
        amount: 450,
        currency: green.currency,
        status: r.method ? 'SUCCEEDED' : 'DUE',
        method: r.method ?? 'OTHER',
        dueDate,
        paidAt,
        periodStart: dueDate,
        periodEnd: due(r.monthsAgo - 1),
        recordedByUserId: r.method ? green.ownerUserId : null,
        memberExpenseId: expense?.id ?? null,
        notes: r.method === 'CASH' ? 'Pago no balcão' : null,
      },
    });
  }
}

/**
 * Pagamento da equipe da Green nos dois últimos meses fechados: cada um com a
 * sua forma de pagamento, gorjetas, um vale no meio do mês e o pagamento no
 * dia 5 do mês seguinte (despesa "Salário"). Só meses passados — o mês atual
 * fica em aberto pra demonstrar a prévia.
 */
async function ensurePayroll(prisma: PrismaClient) {
  const green = await prisma.barbershop.findUnique({ where: { slug: 'green-barbershop' } });
  if (!green || !green.ownerUserId) return;
  if (await prisma.barberPayout.count({ where: { barbershopId: green.id } })) return;
  const barbers = await prisma.barber.findMany({
    where: {
      barbershopId: green.id,
      isActive: true,
      OR: [{ staffType: null }, { staffType: { not: 'reception' } }],
    },
    orderBy: { id: 'asc' },
  });
  if (barbers.length === 0) return;
  console.log('Payroll: Green team pay for the last two months...');
  const rules = await prisma.commissionRule.findMany({ where: { barbershopId: green.id } });
  const pct = (barberId: number, itemType: string) =>
    Number(
      (
        rules.find((r) => r.barberId === barberId && r.itemType === itemType) ??
        rules.find((r) => r.barberId === barberId && r.itemType === 'ALL') ??
        rules.find((r) => r.barberId == null && r.itemType === itemType) ??
        rules.find((r) => r.barberId == null && r.itemType === 'ALL')
      )?.percentage ?? 0,
    );
  const now = new Date();
  // Mês em BRT: começo do dia 1 às 03:00 UTC
  const monthStart = (monthsAgo: number) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1, 3));
  const configs: Array<{ payType: string; fixed: number | null }> = [
    { payType: 'COMMISSION', fixed: null },
    { payType: 'FIXED_PLUS_COMMISSION', fixed: 1200 },
    { payType: 'GREATER_OF', fixed: 2000 },
    { payType: 'FIXED', fixed: 2500 },
  ];
  for (const [i, barber] of barbers.entries()) {
    const c = configs[i % configs.length];
    await prisma.barberPayConfig.upsert({
      where: { barberId: barber.id },
      create: {
        barberId: barber.id,
        barbershopId: green.id,
        payType: c.payType,
        fixedAmount: c.fixed,
      },
      update: {},
    });
    for (const monthsAgo of [2, 1]) {
      const start = monthStart(monthsAgo);
      const end = new Date(monthStart(monthsAgo - 1).getTime() - 1);
      const sales = await prisma.sale.findMany({
        where: {
          barbershopId: green.id,
          barberId: barber.id,
          paymentStatus: 'PAID',
          createdAt: { gte: start, lte: end },
        },
        include: { items: true },
      });
      let serviceSales = 0;
      let productSales = 0;
      let commission = 0;
      for (const sale of sales) {
        for (const item of sale.items) {
          const total = Number(item.totalPrice);
          if (item.itemType === 'PRODUCT') productSales += total;
          else serviceSales += total;
          commission += (total * pct(barber.id, item.itemType)) / 100;
        }
      }
      commission = Math.round(commission * 100) / 100;
      const fixed = c.fixed ?? 0;
      const base =
        c.payType === 'FIXED'
          ? fixed
          : c.payType === 'FIXED_PLUS_COMMISSION'
          ? fixed + commission
          : c.payType === 'GREATER_OF'
          ? Math.max(fixed, commission)
          : commission;
      const tips = 40 + ((barber.id * 17 + monthsAgo * 23) % 90);
      const advance = 200;
      const advanceDate = new Date(start.getTime() + 14 * 86_400_000);
      const advanceExpense = await prisma.expense.create({
        data: {
          barbershopId: green.id,
          category: 'SALARY',
          description: `Vale — ${barber.name}`,
          amount: advance,
          paymentMethod: 'PIX',
          expenseDate: advanceDate,
          createdByUserId: green.ownerUserId,
        },
      });
      const total = Math.max(0, Math.round((base + tips - advance) * 100) / 100);
      const paidAt = new Date(
        monthStart(monthsAgo - 1).getTime() + 4 * 86_400_000 + 15 * 3_600_000,
      );
      const method = i % 2 === 0 ? 'PIX' : 'TRANSFER';
      const payoutExpense = await prisma.expense.create({
        data: {
          barbershopId: green.id,
          category: 'SALARY',
          description: `Pagamento — ${barber.name}`,
          amount: total,
          paymentMethod: method,
          expenseDate: paidAt,
          createdByUserId: green.ownerUserId,
        },
      });
      const payout = await prisma.barberPayout.create({
        data: {
          barbershopId: green.id,
          barberId: barber.id,
          periodStart: start,
          periodEnd: end,
          payType: c.payType,
          serviceSales,
          productSales,
          salesCount: sales.length,
          commission,
          fixedAmount: c.payType === 'COMMISSION' ? 0 : fixed,
          baseAmount: base,
          tips,
          bonuses: 0,
          deductions: 0,
          advances: advance,
          total,
          currency: green.currency,
          method,
          paidAt,
          expenseId: payoutExpense.id,
          createdByUserId: green.ownerUserId,
        },
      });
      await prisma.barberPayEntry.createMany({
        data: [
          {
            barbershopId: green.id,
            barberId: barber.id,
            type: 'TIP',
            amount: tips,
            date: new Date(start.getTime() + 9 * 86_400_000),
            notes: 'Gorjetas no cartão',
            payoutId: payout.id,
            createdByUserId: green.ownerUserId,
          },
          {
            barbershopId: green.id,
            barberId: barber.id,
            type: 'ADVANCE',
            amount: advance,
            method: 'PIX',
            date: advanceDate,
            payoutId: payout.id,
            expenseId: advanceExpense.id,
            createdByUserId: green.ownerUserId,
          },
        ],
      });
    }
  }
}

// Primeiro dia útil (seg-sex) a partir de `offset` dias, como "YYYY-MM-DD" de Brasília
function weekdayFrom(offset: number, weekday?: number): { offset: number; date: string } {
  for (let o = offset; ; o++) {
    const dow = atBrt(o, 12).getUTCDay();
    if (weekday != null ? dow === weekday : dow >= 1 && dow <= 5) {
      return { offset: o, date: atBrt(o, 12).toISOString().slice(0, 10) };
    }
  }
}

// Novidades da agenda e das avaliações na Green: feriado e horário especial,
// folga fixa na escala, cliente recorrente (a cada 2 semanas), respostas às
// avaliações, uma denúncia pra moderação e sinal pago online (um estornado).
// Datas longe das que os E2E usam (2-4 dias, 40-48 dias, segundas daqui a 9+ semanas).
async function ensureNewFeatures(prisma: PrismaClient) {
  const green = await prisma.barbershop.findUnique({ where: { slug: 'green-barbershop' } });
  if (!green || !green.ownerUserId) return;
  const ownerId = green.ownerUserId;
  const shopId = green.id;

  if (!(await prisma.barbershopClosure.count({ where: { barbershopId: shopId } }))) {
    console.log('Closures: a holiday, special hours and a fixed day off...');
    const closed = weekdayFrom(24);
    const special = weekdayFrom(31);
    await prisma.barbershopClosure.createMany({
      data: [
        {
          barbershopId: shopId,
          date: closed.date,
          reason: 'Feriado municipal',
          createdByUserId: ownerId,
        },
        {
          barbershopId: shopId,
          date: special.date,
          openTime: '10:00',
          closeTime: '14:00',
          reason: 'Horário especial (evento no bairro)',
          createdByUserId: ownerId,
        },
      ],
    });
    // Nada marcado nos dias que ficaram fechados
    await prisma.appointment.updateMany({
      where: {
        barbershopId: shopId,
        status: 'CONFIRMED',
        startAt: { gte: atBrt(closed.offset, 0), lt: atBrt(closed.offset + 1, 0) },
      },
      data: { status: 'CANCELLED' },
    });
    // Camila folga aos sábados (escala semanal própria)
    const camila = await prisma.barber.findFirst({
      where: { barbershopId: shopId, name: 'Camila Rocha' },
    });
    if (camila) {
      await prisma.barberSchedule.updateMany({
        where: { barberId: camila.id, dayOfWeek: 6 },
        data: { isActive: false },
      });
    }
  }

  if (
    !(await prisma.appointment.count({ where: { barbershopId: shopId, seriesId: { not: null } } }))
  ) {
    const [barber, service, customer, closures] = await Promise.all([
      prisma.barber.findFirst({ where: { barbershopId: shopId, name: 'Cayo Carlos' } }),
      prisma.barbershopService.findFirst({
        where: { barbershopId: shopId, isActive: true, name: 'Corte masculino' },
      }),
      prisma.customer.findFirst({
        where: { networkId: green.networkId, email: { not: null } },
        orderBy: { id: 'asc' },
      }),
      prisma.barbershopClosure.findMany({ where: { barbershopId: shopId } }),
    ]);
    if (barber && service && customer) {
      console.log('Appointment series: a regular every 2 weeks...');
      const seriesId = `demo-series-${shopId}`;
      const first = weekdayFrom(21, 4); // quinta-feira
      for (let i = 0; i < 4; i++) {
        const offset = first.offset + i * 14;
        const startAt = atBrt(offset, 18);
        const endAt = addMinutes(startAt, service.durationMinutes);
        const date = atBrt(offset, 12).toISOString().slice(0, 10);
        const busy = await prisma.appointment.count({
          where: {
            barberId: barber.id,
            status: { notIn: ['CANCELLED', 'NO_SHOW'] },
            startAt: { lt: endAt },
            endAt: { gt: startAt },
          },
        });
        if (busy || closures.some((c) => c.date === date)) continue;
        await prisma.appointment.create({
          data: {
            barbershopId: shopId,
            customerId: customer.id,
            barberId: barber.id,
            startAt,
            endAt,
            status: 'CONFIRMED',
            source: 'STAFF',
            notes: 'Cliente fixo — a cada 2 semanas',
            seriesId,
            seriesIndex: i,
            services: { create: [{ serviceId: service.id, unitPrice: service.price }] },
          },
        });
      }
    }
  }

  if (!(await prisma.review.count({ where: { barbershopId: shopId, reply: { not: null } } }))) {
    console.log('Reviews: owner replies and one report for moderation...');
    const recent = await prisma.review.findMany({
      where: { barbershopId: shopId, hiddenAt: null },
      orderBy: { createdAt: 'desc' },
      take: 2,
    });
    const replies = [
      'Valeu demais pela visita! Te esperamos de novo em breve.',
      'Obrigado pelo retorno! Já passamos pra equipe.',
    ];
    for (const [i, r] of recent.entries()) {
      await prisma.review.update({
        where: { id: r.id },
        data: {
          reply: replies[i],
          repliedAt: addMinutes(r.createdAt, 180),
          repliedByUserId: ownerId,
        },
      });
    }
    const spammer = await prisma.customer.findFirst({
      where: { networkId: green.networkId },
      orderBy: { id: 'desc' },
    });
    if (spammer) {
      await prisma.review.create({
        data: {
          barbershopId: shopId,
          customerId: spammer.id,
          rating: 1,
          comment: 'Promoção imperdível! Corte grátis na barbearia do lado, é só chamar no zap.',
          createdAt: atBrt(-1, 10),
          reportedAt: atBrt(-1, 12),
          reportReason: 'Propaganda de outra barbearia, a pessoa nunca foi atendida aqui.',
        },
      });
    }
  }

  if (
    !(await prisma.appointment.count({
      where: { barbershopId: shopId, depositPaymentIntentId: { startsWith: 'pi_demo_' } },
    }))
  ) {
    // Não liga o sinal online da unidade (sem Stripe de verdade o agendamento
    // público ficaria aguardando pagamento); só o histórico e o repasse
    const done = await prisma.appointment.findMany({
      where: { barbershopId: shopId, status: 'COMPLETED', startAt: { gte: atBrt(-20, 0) } },
      orderBy: { startAt: 'desc' },
      take: 3,
    });
    const cancelled = await prisma.appointment.findFirst({
      where: { barbershopId: shopId, status: 'CANCELLED', startAt: { gte: atBrt(-20, 0) } },
    });
    if (done.length) {
      console.log('Online deposits: paid through Stripe and one refund...');
      for (const [i, a] of done.entries()) {
        await prisma.appointment.update({
          where: { id: a.id },
          data: {
            depositAmount: 20,
            depositPaid: true,
            depositPaidAt: addMinutes(a.startAt, -2 * 24 * 60),
            depositPaymentIntentId: `pi_demo_${shopId}_${i + 1}`,
          },
        });
      }
      if (cancelled) {
        await prisma.appointment.update({
          where: { id: cancelled.id },
          data: {
            depositAmount: 20,
            depositPaid: false,
            depositPaidAt: addMinutes(cancelled.startAt, -3 * 24 * 60),
            depositRefundedAt: addMinutes(cancelled.startAt, -24 * 60),
            depositPaymentIntentId: `pi_demo_${shopId}_refunded`,
          },
        });
      }
    }
  }
}

export async function seedDemoData(prisma: PrismaClient) {
  faker.locale = 'pt_BR';
  await fixSeedUserProfiles(prisma);

  const green = await prisma.barbershop.findUnique({ where: { slug: 'green-barbershop' } });
  if (!green) return;

  // Unidade-semente com dados antigos (country "Brazil", sem horário/geo)
  if (green.country !== 'BR' || green.latitude == null || !green.businessHours) {
    console.log('Fixing Green Barbershop public page data...');
    await prisma.barbershop.update({
      where: { id: green.id },
      data: {
        country: 'BR',
        address:
          green.address === 'Rua Raimundo Barbosa Nogueira'
            ? 'Rua Raimundo Barbosa Nogueira, 450'
            : green.address,
        email:
          green.email === 'rafaelsinosak@barbershop.com'
            ? 'contato@greenbarbershop.com'
            : green.email,
        latitude: green.latitude ?? -23.2094,
        longitude: green.longitude ?? -45.8997,
        businessHours: green.businessHours ?? BUSINESS_HOURS,
        featuredUntil: green.featuredUntil ?? atBrt(30, 23),
      },
    });
  }

  if (green.ownerUserId) await ensurePremiumForOwner(prisma, green.ownerUserId);
  const clientAccounts = await ensureClientAccounts(prisma);
  await seedGreenOperations(prisma, green.id, clientAccounts);
  if (green.ownerUserId) await ensureSecondUnit(prisma, green.networkId, green.ownerUserId);
  await ensureOtherShops(prisma, clientAccounts);
  await ensureMultiUnitStaff(prisma);
  await ensureSharedLocation(prisma);
  await ensureChairRent(prisma);
  await ensurePayroll(prisma);
  await ensureNewFeatures(prisma);
  await seedNotifications(prisma, green.id);
}
