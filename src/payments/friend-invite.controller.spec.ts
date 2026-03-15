import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FriendInviteController } from './friend-invite.controller';
import { FriendInviteService } from './friend-invite.service';

describe('FriendInviteController', () => {
  let controller: FriendInviteController;
  let friendInviteService: any;

  const mockRequest = {
    user: { id: 1 }
  };

  const mockInvite = {
    id: 1,
    inviterId: 1,
    friendEmail: 'friend@test.com',
    inviteToken: 'mock-token-123',
    status: 'PENDING',
    expiresAt: new Date('2024-02-01'),
    createdAt: new Date('2023-12-01'),
    inviter: {
      fullName: 'Test Inviter',
      email: 'inviter@test.com'
    }
  };

  const mockInviteStats = {
    totalSent: 5,
    totalAccepted: 3,
    totalPending: 2,
    acceptanceRate: 60
  };

  beforeEach(async () => {
    const mockFriendInviteService = {
      createInvite: jest.fn(),
      getSentInvites: jest.fn(),
      acceptInvite: jest.fn(),
      validateInvite: jest.fn(),
      getInviteStats: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FriendInviteController],
      providers: [
        {
          provide: FriendInviteService,
          useValue: mockFriendInviteService
        }
      ]
    }).compile();

    controller = module.get<FriendInviteController>(FriendInviteController);
    friendInviteService = module.get(FriendInviteService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createInvite', () => {
    it('should create a new friend invite', async () => {
      // Arrange
      const createInviteDto = {
        friendEmail: 'friend@test.com',
        sentVia: 'EMAIL'
      };

      friendInviteService.createInvite.mockResolvedValue(mockInvite);

      // Act
      const result = await controller.createInvite(mockRequest as any, createInviteDto);

      // Assert
      expect(friendInviteService.createInvite).toHaveBeenCalledWith(
        mockRequest.user.id,
        createInviteDto.friendEmail,
        createInviteDto.sentVia
      );
      expect(result).toEqual(mockInvite);
    });

    it('should handle service errors gracefully', async () => {
      // Arrange
      const createInviteDto = {
        friendEmail: 'friend@test.com',
        sentVia: 'EMAIL'
      };

      friendInviteService.createInvite.mockRejectedValue(
        new BadRequestException('Você já convidou este email')
      );

      // Act & Assert
      await expect(controller.createInvite(mockRequest as any, createInviteDto))
        .rejects
        .toThrow(new BadRequestException('Você já convidou este email'));
    });

    it('should use default sentVia if not provided', async () => {
      // Arrange
      const createInviteDto = {
        friendEmail: 'friend@test.com'
      };

      friendInviteService.createInvite.mockResolvedValue(mockInvite);

      // Act
      await controller.createInvite(mockRequest as any, createInviteDto);

      // Assert
      expect(friendInviteService.createInvite).toHaveBeenCalledWith(
        mockRequest.user.id,
        createInviteDto.friendEmail,
        undefined // Should use service default
      );
    });
  });

  describe('getSentInvites', () => {
    it('should return user sent invites', async () => {
      // Arrange
      const mockSentInvites = [
        {
          ...mockInvite,
          acceptedByUser: {
            id: 2,
            fullName: 'Friend User',
            email: 'friend@test.com'
          },
          inviterCoupon: {
            id: 1,
            code: 'FRIEND_INVITER_1_ABC123',
            name: 'Convite Aceito - 1 Mês Grátis',
            value: 1,
            type: 'FREE_MONTH'
          },
          friendCoupon: {
            id: 2,
            code: 'FRIEND_FRIEND_1_DEF456',
            name: 'Convite de Amigo - 1 Mês Grátis',
            value: 1,
            type: 'FREE_MONTH'
          }
        }
      ];

      friendInviteService.getSentInvites.mockResolvedValue(mockSentInvites);

      // Act
      const result = await controller.getSentInvites(mockRequest as any);

      // Assert
      expect(friendInviteService.getSentInvites).toHaveBeenCalledWith(mockRequest.user.id);
      expect(result).toEqual(mockSentInvites);
    });

    it('should return empty array if no invites', async () => {
      // Arrange
      friendInviteService.getSentInvites.mockResolvedValue([]);

      // Act
      const result = await controller.getSentInvites(mockRequest as any);

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe('acceptInvite', () => {
    it('should accept invite successfully for new user', async () => {
      // Arrange
      const token = 'mock-token-123';
      const mockAcceptResult = {
        success: true,
        message: 'Convite aceito com sucesso! Ambos ganharam 1 mês grátis.',
        invite: {
          ...mockInvite,
          status: 'ACCEPTED',
          acceptedByUserId: mockRequest.user.id
        },
        hasBenefits: true
      };

      friendInviteService.acceptInvite.mockResolvedValue(mockAcceptResult);

      // Act
      const result = await controller.acceptInvite(mockRequest as any, token);

      // Assert
      expect(friendInviteService.acceptInvite).toHaveBeenCalledWith(
        token,
        mockRequest.user.id
      );
      expect(result).toEqual(mockAcceptResult);
    });

    it('should handle rejection for existing users', async () => {
      // Arrange
      const token = 'mock-token-123';
      const mockRejectResult = {
        success: false,
        message: 'Este convite não pode ser usado por usuários que já possuem uma conta.',
        invite: {
          ...mockInvite,
          status: 'REJECTED',
          acceptedByUserId: mockRequest.user.id
        },
        hasBenefits: false
      };

      friendInviteService.acceptInvite.mockResolvedValue(mockRejectResult);

      // Act
      const result = await controller.acceptInvite(mockRequest as any, token);

      // Assert
      expect(result.success).toBe(false);
      expect(result.hasBenefits).toBe(false);
      expect(result.message).toContain('usuários que já possuem uma conta');
    });

    it('should handle service errors', async () => {
      // Arrange
      const token = 'invalid-token';

      friendInviteService.acceptInvite.mockRejectedValue(
        new NotFoundException('Convite não encontrado')
      );

      // Act & Assert
      await expect(controller.acceptInvite(mockRequest as any, token))
        .rejects
        .toThrow(new NotFoundException('Convite não encontrado'));
    });
  });

  describe('validateInvite', () => {
    it('should validate invite token successfully', async () => {
      // Arrange
      const token = 'mock-token-123';
      const mockValidationResult = {
        valid: true,
        invite: {
          id: 1,
          friendEmail: 'friend@test.com',
          inviterName: 'Test Inviter',
          expiresAt: new Date('2024-02-01')
        }
      };

      friendInviteService.validateInvite.mockResolvedValue(mockValidationResult);

      // Act
      const result = await controller.validateInvite(token);

      // Assert
      expect(friendInviteService.validateInvite).toHaveBeenCalledWith(token);
      expect(result).toEqual(mockValidationResult);
    });

    it('should return invalid for bad token', async () => {
      // Arrange
      const token = 'invalid-token';
      const mockValidationResult = {
        valid: false,
        reason: 'Convite não encontrado'
      };

      friendInviteService.validateInvite.mockResolvedValue(mockValidationResult);

      // Act
      const result = await controller.validateInvite(token);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Convite não encontrado');
    });

    it('should return invalid for expired token', async () => {
      // Arrange
      const token = 'expired-token';
      const mockValidationResult = {
        valid: false,
        reason: 'Convite expirado'
      };

      friendInviteService.validateInvite.mockResolvedValue(mockValidationResult);

      // Act
      const result = await controller.validateInvite(token);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Convite expirado');
    });
  });

  describe('getInviteStats', () => {
    it('should return invite statistics', async () => {
      // Arrange
      friendInviteService.getInviteStats.mockResolvedValue(mockInviteStats);

      // Act
      const result = await controller.getInviteStats(mockRequest as any);

      // Assert
      expect(friendInviteService.getInviteStats).toHaveBeenCalledWith(mockRequest.user.id);
      expect(result).toEqual(mockInviteStats);
    });

    it('should handle user with no invites', async () => {
      // Arrange
      const emptyStats = {
        totalSent: 0,
        totalAccepted: 0,
        totalPending: 0,
        acceptanceRate: 0
      };

      friendInviteService.getInviteStats.mockResolvedValue(emptyStats);

      // Act
      const result = await controller.getInviteStats(mockRequest as any);

      // Assert
      expect(result).toEqual(emptyStats);
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete invite flow', async () => {
      // Arrange - Create invite
      const createDto = { friendEmail: 'friend@test.com', sentVia: 'EMAIL' };
      friendInviteService.createInvite.mockResolvedValue(mockInvite);

      // Arrange - Validate invite
      const validationResult = {
        valid: true,
        invite: {
          id: 1,
          friendEmail: 'friend@test.com',
          inviterName: 'Test Inviter',
          expiresAt: new Date('2024-02-01')
        }
      };
      friendInviteService.validateInvite.mockResolvedValue(validationResult);

      // Arrange - Accept invite
      const acceptResult = {
        success: true,
        message: 'Convite aceito com sucesso! Ambos ganharam 1 mês grátis.',
        invite: { ...mockInvite, status: 'ACCEPTED' },
        hasBenefits: true
      };
      friendInviteService.acceptInvite.mockResolvedValue(acceptResult);

      // Act - Create invite
      const createResult = await controller.createInvite(mockRequest as any, createDto);
      expect(createResult).toEqual(mockInvite);

      // Act - Validate invite
      const validateResult = await controller.validateInvite(mockInvite.inviteToken);
      expect(validateResult.valid).toBe(true);

      // Act - Accept invite
      const acceptResultFinal = await controller.acceptInvite(
        { user: { id: 2 } } as any, 
        mockInvite.inviteToken
      );
      expect(acceptResultFinal.success).toBe(true);
      expect(acceptResultFinal.hasBenefits).toBe(true);
    });

    it('should handle failed invite acceptance for existing user', async () => {
      // Arrange
      const token = 'mock-token-123';
      const rejectResult = {
        success: false,
        message: 'Este convite não pode ser usado por usuários que já possuem uma conta.',
        invite: { ...mockInvite, status: 'REJECTED' },
        hasBenefits: false
      };

      friendInviteService.acceptInvite.mockResolvedValue(rejectResult);

      // Act
      const result = await controller.acceptInvite(mockRequest as any, token);

      // Assert
      expect(result.success).toBe(false);
      expect(result.hasBenefits).toBe(false);
      expect(result.message).toContain('usuários que já possuem uma conta');
    });
  });
});