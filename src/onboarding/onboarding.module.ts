import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OnboardingService } from './onboarding.service';

@Module({
  imports: [PrismaModule],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
