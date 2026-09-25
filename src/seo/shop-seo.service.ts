import { Injectable, NotFoundException } from '@nestjs/common';
import { BarbershopService } from '../barbershop/barbershop.service';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MAX_DESCRIPTION = 160;

export type ShopSeo = {
  title: string;
  description: string;
  /** Página canônica da unidade */
  url: string;
  /** Imagem estável (redireciona pro link do S3, que expira) */
  image: string | null;
  jsonLd: Record<string, unknown>;
};

/**
 * Cabeçalho da página pública da unidade pra buscadores e pra prévia ao
 * compartilhar (WhatsApp, Instagram, Facebook não executam o JS do app): o
 * front (função da Vercel) injeta isto no HTML de /u/:slug. JSON-LD
 * schema.org (HairSalon): endereço, telefone, horário, nota e redes.
 */
@Injectable()
export class ShopSeoService {
  constructor(private readonly barbershops: BarbershopService) {}

  async forSlug(slug: string): Promise<ShopSeo> {
    const shop = await this.barbershops.getPublicBarbershopByslug(slug).catch(() => null);
    if (!shop) throw new NotFoundException('Unidade não encontrada');
    const front = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    const api = (process.env.PUBLIC_API_URL || '').replace(/\/$/, '');
    const url = `${front}/u/${shop.slug}`;
    const hasImage = Boolean(shop.coverKey || shop.photoKey);
    const image =
      hasImage && api ? `${api}/seo/shops/${encodeURIComponent(shop.slug)}/image` : null;
    const place = `${shop.city} - ${shop.state}`;
    const rating =
      shop.reviewCount > 0 && shop.averageRating != null
        ? ` ★ ${Number(shop.averageRating).toFixed(1)} (${shop.reviewCount} avaliações).`
        : '';
    const base =
      shop.description?.replace(/\s+/g, ' ').trim() || `Agende online em ${shop.name}, ${place}.`;
    const description = truncate(`${base}${rating}`, MAX_DESCRIPTION);
    const sameAs = [shop.instagramUrl, shop.facebookUrl, shop.linkedinUrl].filter(Boolean);

    const jsonLd: Record<string, unknown> = {
      '@context': 'https://schema.org',
      '@type': 'HairSalon',
      name: shop.name,
      url,
      telephone: shop.phone,
      ...(shop.email ? { email: shop.email } : {}),
      ...(image ? { image } : {}),
      ...(shop.description ? { description: truncate(shop.description, 500) } : {}),
      address: {
        '@type': 'PostalAddress',
        streetAddress: [shop.address, shop.complement1].filter(Boolean).join(', '),
        addressLocality: shop.city,
        addressRegion: shop.state,
        postalCode: shop.postalCode,
        addressCountry: shop.country,
      },
      ...(shop.latitude != null && shop.longitude != null
        ? { geo: { '@type': 'GeoCoordinates', latitude: shop.latitude, longitude: shop.longitude } }
        : {}),
      openingHoursSpecification: shop.openingHours
        .filter((d: { open: string | null }) => d.open)
        .map((d: { dayOfWeek: number; open: string; close: string }) => ({
          '@type': 'OpeningHoursSpecification',
          dayOfWeek: `https://schema.org/${DAY_NAMES[d.dayOfWeek]}`,
          opens: d.open,
          closes: d.close,
        })),
      ...(shop.reviewCount > 0 && shop.averageRating != null
        ? {
            aggregateRating: {
              '@type': 'AggregateRating',
              ratingValue: Number(Number(shop.averageRating).toFixed(1)),
              reviewCount: shop.reviewCount,
              bestRating: 5,
              worstRating: 1,
            },
          }
        : {}),
      ...(sameAs.length ? { sameAs } : {}),
      makesOffer: shop.services.slice(0, 20).map((s: { name: string; price: unknown }) => ({
        '@type': 'Offer',
        itemOffered: { '@type': 'Service', name: s.name },
        price: Number(s.price),
        priceCurrency: shop.currency,
      })),
    };
    return {
      title: `${shop.name} · ${place} | Agende online`,
      description,
      url,
      image,
      jsonLd,
    };
  }

  /** Link atual (assinado) da capa ou da foto da unidade */
  async imageUrl(slug: string): Promise<string> {
    const shop = await this.barbershops.getPublicBarbershopByslug(slug).catch(() => null);
    const url = shop?.coverUrl ?? shop?.imageUrl;
    if (!url) throw new NotFoundException('Sem imagem');
    return url;
  }
}

function truncate(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
