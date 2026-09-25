import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SitemapService } from './sitemap.service';
import { ShopSeoService } from './shop-seo.service';

/**
 * O front (Vercel) serve /sitemap.xml e o cabeçalho da página de cada
 * unidade (título, prévia ao compartilhar, dados pro Google) buscando
 * daqui — os dados estão no banco. Público e em cache.
 */
@Controller('seo')
export class SitemapController {
  constructor(private readonly sitemap: SitemapService, private readonly shopSeo: ShopSeoService) {}

  @Get('sitemap.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  async sitemapXml() {
    return this.sitemap.sitemapXml();
  }

  @Get('shops/:slug')
  @Header('Cache-Control', 'public, max-age=600')
  async shop(@Param('slug') slug: string) {
    return this.shopSeo.forSlug(slug);
  }

  /** Imagem da prévia: endereço fixo que redireciona pro link do S3 (que expira) */
  @Get('shops/:slug/image')
  async shopImage(@Param('slug') slug: string, @Res() res: Response) {
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.redirect(302, await this.shopSeo.imageUrl(slug));
  }
}
