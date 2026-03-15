// src\plan\plan.module.ts
import { Module } from '@nestjs/common';
import { PlanService } from './plan.service';
import { PlanController } from './plan.controller';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '@/auth/auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { StripeModule } from '../stripe/stripe.module';

@Module({
  imports: [AuthModule, JwtModule, StripeModule],
  providers: [PlanService, PrismaService],
  controllers: [PlanController],
  exports: [PlanService, PrismaService],
})
export class PlanModule {}
