// src\auth\users\users.module.ts
import { Module } from '@nestjs/common';
import { UserService } from './users.service';
import { UserController } from './users.controller';
import { EmailModule } from '@/email/email.module';
import { PrismaService } from '@/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { AwsModule } from '@/aws/aws.module';

@Module({
  imports: [EmailModule, AwsModule],
  providers: [UserService, PrismaService, JwtService],
  controllers: [UserController],
  exports: [UserService, PrismaService],
})
export class UserModule {}
