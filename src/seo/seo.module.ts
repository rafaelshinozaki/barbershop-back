import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SitemapController } from './sitemap.controller';
import { SitemapService } from './sitemap.service';

@Module({
  imports: [PrismaModule],
  providers: [SitemapService],
  controllers: [SitemapController],
})
export class SeoModule {}
