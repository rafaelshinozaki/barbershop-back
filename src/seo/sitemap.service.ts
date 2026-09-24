import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// O protocolo aceita até 50 mil URLs por arquivo
const MAX_URLS = 50_000;
const CACHE_MS = 3_600_000;

type Url = { loc: string; lastmod?: Date; priority: string; changefreq: string };

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** Mesmo slug de cidade do front (utils/citySlug.ts) e da busca pública */
export const slugifyCity = (city: string) =>
  city
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

/** Mesmo slug de categoria do front (constants/treatmentCategory.ts) */
export const categorySlug = (category: string) => category.toLowerCase().replace(/_/g, '-');

/**
 * sitemap.xml das páginas públicas, pro Google achar tudo o que dá pra
 * agendar: a página de cada unidade ativa (/u/:slug) e as buscas por
 * categoria, por cidade e por categoria × cidade (/search/...) que têm
 * resultado. Nada de área logada.
 */
@Injectable()
export class SitemapService {
  private cache: { xml: string; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async sitemapXml(now = Date.now()) {
    if (this.cache && now - this.cache.at < CACHE_MS) return this.cache.xml;
    const xml = await this.build();
    this.cache = { xml, at: now };
    return xml;
  }

  private async build() {
    const front = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    const shops = await this.prisma.barbershop.findMany({
      where: { isActive: true },
      select: {
        slug: true,
        city: true,
        updatedAt: true,
        services: { where: { isActive: true }, select: { category: true } },
      },
      orderBy: { id: 'asc' },
    });

    const urls: Url[] = [{ loc: `${front}/search`, priority: '0.8', changefreq: 'daily' }];
    for (const shop of shops) {
      urls.push({
        loc: `${front}/u/${encodeURIComponent(shop.slug)}`,
        lastmod: shop.updatedAt,
        priority: '1.0',
        changefreq: 'weekly',
      });
    }

    // Só as buscas que têm pelo menos uma unidade (página vazia não ajuda ninguém)
    const categories = new Set<string>();
    const cities = new Set<string>();
    const pairs = new Set<string>();
    for (const shop of shops) {
      const city = slugifyCity(shop.city);
      if (city) cities.add(city);
      for (const { category } of shop.services) {
        const cat = categorySlug(category);
        categories.add(cat);
        if (city) pairs.add(`${cat}/${city}`);
      }
    }
    const search = (path: string) => ({
      loc: `${front}/search/${path}`,
      priority: '0.6',
      changefreq: 'daily',
    });
    [...categories].sort().forEach((c) => urls.push(search(c)));
    [...cities].sort().forEach((c) => urls.push(search(`all/${c}`)));
    [...pairs].sort().forEach((p) => urls.push(search(p)));

    const body = urls
      .slice(0, MAX_URLS)
      .map((u) =>
        [
          '  <url>',
          `    <loc>${escapeXml(u.loc)}</loc>`,
          u.lastmod ? `    <lastmod>${u.lastmod.toISOString().slice(0, 10)}</lastmod>` : null,
          `    <changefreq>${u.changefreq}</changefreq>`,
          `    <priority>${u.priority}</priority>`,
          '  </url>',
        ]
          .filter(Boolean)
          .join('\n'),
      )
      .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
  }
}
