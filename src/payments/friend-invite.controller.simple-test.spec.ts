import { Test, TestingModule } from '@nestjs/testing';
import { FriendInviteController } from './friend-invite.controller';
import { FriendInviteService } from './friend-invite.service';

describe('FriendInviteController - Simple Tests', () => {
  let controller: FriendInviteController;
  let service: FriendInviteService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FriendInviteController],
      providers: [
        {
          provide: FriendInviteService,
          useValue: {
            createInvite: jest.fn(),
            getSentInvites: jest.fn(),
            acceptInvite: jest.fn(),
            validateInvite: jest.fn(),
            getInviteStats: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<FriendInviteController>(FriendInviteController);
    service = module.get<FriendInviteService>(FriendInviteService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should have createInvite method', () => {
    expect(controller.createInvite).toBeDefined();
    expect(typeof controller.createInvite).toBe('function');
  });

  it('should have getSentInvites method', () => {
    expect(controller.getSentInvites).toBeDefined();
    expect(typeof controller.getSentInvites).toBe('function');
  });

  it('should have acceptInvite method', () => {
    expect(controller.acceptInvite).toBeDefined();
    expect(typeof controller.acceptInvite).toBe('function');
  });

  it('should have validateInvite method', () => {
    expect(controller.validateInvite).toBeDefined();
    expect(typeof controller.validateInvite).toBe('function');
  });

  it('should have getInviteStats method', () => {
    expect(controller.getInviteStats).toBeDefined();
    expect(typeof controller.getInviteStats).toBe('function');
  });

  it('should have injected service', () => {
    expect(service).toBeDefined();
  });
});