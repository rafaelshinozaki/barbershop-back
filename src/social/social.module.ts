import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '@/prisma/prisma.module';
import { AwsModule } from '@/aws/aws.module';
import { BarbershopModule } from '@/barbershop/barbershop.module';
import { SocialService } from './social.service';
import { SocialController } from './social.controller';
import { SocialPostsSchedulerService } from './social-posts-scheduler.service';

@Module({
  imports: [
    PrismaModule,
    AwsModule,
    BarbershopModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [SocialController],
  providers: [SocialService, SocialPostsSchedulerService],
  exports: [SocialService],
})
export class SocialModule {}
