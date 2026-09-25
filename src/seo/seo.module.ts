import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BarbershopModule } from '../barbershop/barbershop.module';
import { SitemapController } from './sitemap.controller';
import { SitemapService } from './sitemap.service';
import { ShopSeoService } from './shop-seo.service';

@Module({
  imports: [PrismaModule, BarbershopModule],
  providers: [SitemapService, ShopSeoService],
  controllers: [SitemapController],
})
export class SeoModule {}
