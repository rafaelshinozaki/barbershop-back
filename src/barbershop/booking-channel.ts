/**
 * Origem do agendamento online. marketplace: o cliente achou o negócio pela
 * busca ou vitrine da plataforma; direct: veio pelo link, QR ou site do
 * próprio negócio. Mede o piloto e é a base da taxa por cliente novo do
 * marketplace (decidida para depois do piloto).
 */
export const BOOKING_CHANNELS = ['marketplace', 'direct'] as const;
export type BookingChannel = (typeof BOOKING_CHANNELS)[number];

export function bookingChannel(value?: string | null): BookingChannel {
  return value === 'marketplace' ? 'marketplace' : 'direct';
}
