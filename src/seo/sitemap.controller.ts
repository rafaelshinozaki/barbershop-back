import { Controller, Get, Header } from '@nestjs/common';
import { SitemapService } from './sitemap.service';

/**
 * O front (Vercel) serve /sitemap.xml buscando daqui — a lista de unidades
 * está no banco. Público e em cache (uma hora aqui e no CDN).
 */
@Controller('seo')
export class SitemapController {
  constructor(private readonly sitemap: SitemapService) {}

  @Get('sitemap.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  async sitemapXml() {
    return this.sitemap.sitemapXml();
  }
}
