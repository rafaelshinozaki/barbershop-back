import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * A unidade só aparece e aceita cliente novo se o dono da rede está ativo
 * e, quando a unidade tem dono próprio, esse também. Conta apagada (LGPD)
 * não conta. Reativar a conta devolve a vitrine sem gravar outro estado.
 */
export const ownerAcceptsPublic: Prisma.BarbershopWhereInput = {
  platformSuspendedAt: null,
  network: {
    platformSuspendedAt: null,
    ownerUser: { isActive: true, deleted_at: null },
  },
  OR: [{ ownerUserId: null }, { ownerUser: { isActive: true, deleted_at: null } }],
};

export const SHOP_NOT_RECEIVING_MESSAGE =
  'Esta unidade não está recebendo pelo app no momento. Fale diretamente com ela.';

/**
 * Unidade encerrada ou suspensa pela plataforma (ela ou a rede): os links do
 * atendimento (caixinha, avaliação, conversa) não recebem mais nada (item 190).
 */
export async function assertShopInService(
  prisma: {
    barbershop: {
      findUnique(args: {
        where: { id: number };
        select: {
          closedAt: true;
          platformSuspendedAt: true;
          network: { select: { platformSuspendedAt: true } };
        };
      }): Promise<{
        closedAt: Date | null;
        platformSuspendedAt: Date | null;
        network: { platformSuspendedAt: Date | null } | null;
      } | null>;
    };
  },
  barbershopId: number,
) {
  const shop = await prisma.barbershop.findUnique({
    where: { id: barbershopId },
    select: {
      closedAt: true,
      platformSuspendedAt: true,
      network: { select: { platformSuspendedAt: true } },
    },
  });
  if (!shop || shop.closedAt || shop.platformSuspendedAt || shop.network?.platformSuspendedAt) {
    throw new BadRequestException(SHOP_NOT_RECEIVING_MESSAGE);
  }
}

export function ownerAccountOpen(shop: {
  platformSuspendedAt?: Date | null;
  ownerUser: { isActive: boolean; deleted_at: Date | null } | null;
  network: {
    platformSuspendedAt?: Date | null;
    ownerUser: { isActive: boolean; deleted_at: Date | null };
  };
}): boolean {
  if (shop.platformSuspendedAt || shop.network.platformSuspendedAt) return false;
  const networkOwner = shop.network.ownerUser;
  if (!networkOwner.isActive || networkOwner.deleted_at) return false;
  const unitOwner = shop.ownerUser;
  if (unitOwner && (!unitOwner.isActive || unitOwner.deleted_at)) return false;
  return true;
}
