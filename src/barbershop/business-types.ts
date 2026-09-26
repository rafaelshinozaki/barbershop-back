/**
 * Tipo de estabelecimento: o produto não é só barbearia. Define o catálogo
 * inicial sugerido de serviços, os ícones e o texto da página pública (o
 * front traduz). Profissional independente é quem atende sozinho.
 */
export const BUSINESS_TYPES = [
  'barbershop',
  'beauty_salon',
  'nail_salon',
  'aesthetics',
  'brows_lashes',
  'massage',
  'makeup',
  'independent',
  'other',
] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const DEFAULT_BUSINESS_TYPE: BusinessType = 'barbershop';

export function isBusinessType(value: unknown): value is BusinessType {
  return typeof value === 'string' && (BUSINESS_TYPES as readonly string[]).includes(value);
}
