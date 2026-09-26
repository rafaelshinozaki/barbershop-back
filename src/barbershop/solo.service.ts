import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { linkBarberToProfessional } from './professional';
import { SOLO_PRODUCT_LIMIT, SOLO_SERVICE_LIMIT, soloUsage } from './solo';
import { isProActive, proPriceLabel } from './pro';

export type StartSoloInput = {
  name: string;
  city: string;
  state: string;
  country: string;
  address: string;
  postalCode: string;
  phone: string;
};

export type SoloStatus = {
  active: boolean;
  barbershopId: number | null;
  slug: string | null;
  name: string | null;
  completedThisMonth: number;
  limit: number;
  remaining: number;
  nearLimit: boolean;
  grace: boolean;
  blocked: boolean;
  productsThisMonth: number;
  productLimit: number;
  productRemaining: number;
  productNearLimit: boolean;
  productGrace: boolean;
  productBlocked: boolean;
  /** O preço do Pro está definido. A cobrança em si continua no Stripe dos planos. */
  proAvailable: boolean;
  proActive: boolean;
  proUntil: string | null;
  proPriceLabel: string;
};

const EMPTY: SoloStatus = {
  active: false,
  barbershopId: null,
  slug: null,
  name: null,
  completedThisMonth: 0,
  limit: SOLO_SERVICE_LIMIT,
  remaining: SOLO_SERVICE_LIMIT,
  nearLimit: false,
  grace: false,
  blocked: false,
  productsThisMonth: 0,
  productLimit: SOLO_PRODUCT_LIMIT,
  productRemaining: SOLO_PRODUCT_LIMIT,
  productNearLimit: false,
  productGrace: false,
  productBlocked: false,
  proAvailable: true,
  proActive: false,
  proUntil: null,
  proPriceLabel: proPriceLabel(),
};

function required(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new BadRequestException(`${label} é obrigatório`);
  return trimmed;
}

function slugBase(name: string, userId: number) {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'agenda'}-${userId}`;
}

@Injectable()
export class SoloService {
  constructor(private readonly prisma: PrismaService) {}

  async status(userId: number): Promise<SoloStatus> {
    const shop = await this.prisma.barbershop.findFirst({
      where: { ownerUserId: userId, practiceKind: 'solo' },
      orderBy: { id: 'asc' },
    });
    if (!shop) return { ...EMPTY, ...(await this.proFields(userId)) };
    const usage = await soloUsage(this.prisma, userId, shop.timezone, new Date());
    return this.toStatus(shop, usage, await this.proFields(userId));
  }

  /** Uma agenda pessoal. Não ocupa vaga de unidade do plano do estabelecimento. */
  async start(userId: number, input: StartSoloInput): Promise<SoloStatus> {
    const current = await this.status(userId);
    if (current.active) return current;

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Conta não encontrada');

    const name = required(input.name, 'Nome');
    const city = required(input.city, 'Cidade');
    const state = required(input.state, 'Estado');
    const country = required(input.country, 'País');
    const address = required(input.address, 'Endereço');
    const postalCode = required(input.postalCode, 'CEP');
    const phone = required(input.phone, 'Telefone');

    let network = await this.prisma.network.findFirst({ where: { ownerUserId: userId } });
    if (!network) {
      network = await this.prisma.network.create({ data: { ownerUserId: userId, city } });
    }

    const slug = await this.freeSlug(slugBase(name, userId));
    const networkId = network.id;
    const currency = network.currency;
    const shop = await this.prisma.$transaction(async (tx) => {
      const created = await tx.barbershop.create({
        data: {
          name,
          slug,
          address,
          city,
          state,
          country,
          postalCode,
          phone,
          email: user.email,
          practiceKind: 'solo',
          timezone: 'America/Sao_Paulo',
          currency,
          networkId,
          ownerUserId: userId,
        },
      });
      const barber = await tx.barber.create({
        data: {
          barbershopId: created.id,
          userId,
          name: user.fullName,
          phone: user.phone ?? phone,
          email: user.email,
          staffType: 'barber',
          takesAppointments: true,
        },
      });
      await linkBarberToProfessional(tx, barber.id, userId);
      return created;
    }).catch((error: { code?: string }) => {
      if (error?.code === 'P2002') {
        throw new BadRequestException('Já existe uma página com este endereço. Tente de novo.');
      }
      throw error;
    });

    return this.statusOf(shop.id, userId);
  }

  private async statusOf(barbershopId: number, userId: number): Promise<SoloStatus> {
    const shop = await this.prisma.barbershop.findUniqueOrThrow({ where: { id: barbershopId } });
    const usage = await soloUsage(this.prisma, userId, shop.timezone, new Date());
    return this.toStatus(shop, usage, await this.proFields(userId));
  }

  private async proFields(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { proUntil: true } });
    const proActive = isProActive(user?.proUntil, new Date());
    return {
      proAvailable: true as const,
      proActive,
      proUntil: user?.proUntil?.toISOString() ?? null,
      proPriceLabel: proPriceLabel(),
    };
  }

  private toStatus(
    shop: { id: number; slug: string; name: string },
    usage: Awaited<ReturnType<typeof soloUsage>>,
    pro: { proAvailable: true; proActive: boolean; proUntil: string | null; proPriceLabel: string },
  ): SoloStatus {
    return {
      active: true,
      barbershopId: shop.id,
      slug: shop.slug,
      name: shop.name,
      completedThisMonth: usage.services.completed,
      limit: usage.services.limit,
      remaining: usage.services.remaining,
      nearLimit: usage.services.nearLimit,
      grace: usage.services.grace && !pro.proActive,
      blocked: usage.services.blocked && !pro.proActive,
      productsThisMonth: usage.products.completed,
      productLimit: usage.products.limit,
      productRemaining: usage.products.remaining,
      productNearLimit: usage.products.nearLimit,
      productGrace: usage.products.grace && !pro.proActive,
      productBlocked: usage.products.blocked && !pro.proActive,
      ...pro,
    };
  }

  private async freeSlug(base: string) {
    let slug = base;
    for (let n = 2; n < 50; n++) {
      const taken = await this.prisma.barbershop.findUnique({ where: { slug }, select: { id: true } });
      if (!taken) return slug;
      slug = `${base}-${n}`;
    }
    throw new BadRequestException('Não foi possível criar o endereço da página');
  }
}
