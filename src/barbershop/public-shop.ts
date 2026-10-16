import { Prisma } from '@prisma/client';

/**
 * A unidade só aparece e aceita cliente novo se o dono da rede está ativo
 * e, quando a unidade tem dono próprio, esse também. Conta apagada (LGPD)
 * não conta. Reativar a conta devolve a vitrine sem gravar outro estado.
 */
export const ownerAcceptsPublic: Prisma.BarbershopWhereInput = {
  network: { ownerUser: { isActive: true, deleted_at: null } },
  OR: [{ ownerUserId: null }, { ownerUser: { isActive: true, deleted_at: null } }],
};

export function ownerAccountOpen(shop: {
  ownerUser: { isActive: boolean; deleted_at: Date | null } | null;
  network: { ownerUser: { isActive: boolean; deleted_at: Date | null } };
}): boolean {
  const networkOwner = shop.network.ownerUser;
  if (!networkOwner.isActive || networkOwner.deleted_at) return false;
  const unitOwner = shop.ownerUser;
  if (unitOwner && (!unitOwner.isActive || unitOwner.deleted_at)) return false;
  return true;
}
