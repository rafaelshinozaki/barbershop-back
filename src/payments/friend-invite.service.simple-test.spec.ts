import { Test, TestingModule } from '@nestjs/testing';
import { FriendInviteService } from './friend-invite.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { CouponsService } from './coupons.service';
import { ConfigService } from '@nestjs/config';

describe('FriendInviteService - Simple Tests', () => {
  let service: FriendInviteService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FriendInviteService,
        {
          provide: PrismaService,
          useValue: {
            friendInvite: {
              findFirst: jest.fn(),
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              count: jest.fn(),
              findMany: jest.fn(),
            },
            user: {
              findUnique: jest.fn(),
            },
            coupon: {
              create: jest.fn(),
            },
          },
        },
        {
          provide: EmailService,
          useValue: {
            sendTemplateEmail: jest.fn(),
          },
        },
        {
          provide: CouponsService,
          useValue: {},
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('http://localhost:3000'),
          },
        },
      ],
    }).compile();

    service = module.get<FriendInviteService>(FriendInviteService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should have createInvite method', () => {
    expect(service.createInvite).toBeDefined();
    expect(typeof service.createInvite).toBe('function');
  });

  it('should have validateInvite method', () => {
    expect(service.validateInvite).toBeDefined();
    expect(typeof service.validateInvite).toBe('function');
  });

  it('should have acceptInvite method', () => {
    expect(service.acceptInvite).toBeDefined();
    expect(typeof service.acceptInvite).toBe('function');
  });

  it('should have getSentInvites method', () => {
    expect(service.getSentInvites).toBeDefined();
    expect(typeof service.getSentInvites).toBe('function');
  });

  it('should have getInviteStats method', () => {
    expect(service.getInviteStats).toBeDefined();
    expect(typeof service.getInviteStats).toBe('function');
  });
});