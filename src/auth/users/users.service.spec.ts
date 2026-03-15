import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './users.service';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/email/email.service';
import { UnauthorizedException } from '@nestjs/common';
import { LOGIN_MAX_ATTEMPTS } from '@/common';

describe('UserService', () => {
  let service: UserService;
  let prisma: { user: { findFirst: jest.Mock } };

  beforeEach(async () => {
    prisma = { user: { findFirst: jest.fn() } } as any;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: {} },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should block login after several failed attempts', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    const email = 'test@example.com';
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      await expect(service.verifyUser(email, 'bad')).rejects.toBeInstanceOf(UnauthorizedException);
    }
    await expect(service.verifyUser(email, 'bad')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
