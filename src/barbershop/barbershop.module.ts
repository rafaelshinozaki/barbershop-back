import { Module } from '@nestjs/common';
import { BarbershopService } from './barbershop.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [BarbershopService],
  exports: [BarbershopService],
})
export class BarbershopModule {}
