import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { StripeService } from './stripe.service';

describe('StripeService', () => {
  let service: StripeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot()],
      providers: [StripeService],
    }).compile();

    service = module.get<StripeService>(StripeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should call subscriptions.cancel on cancelSubscription', async () => {
    (service as any).stripe = {
      subscriptions: { cancel: jest.fn().mockResolvedValue(true) },
      balance: { retrieve: jest.fn() },
    } as any;

    await service.cancelSubscription('sub_123');
    expect((service as any).stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_123');
  });

  it('should return true when Stripe is available', async () => {
    (service as any).stripe = {
      balance: { retrieve: jest.fn().mockResolvedValue({}) },
    } as any;

    const result = await service.isAvailable();
    expect(result).toBe(true);
  });

  it('should return false when Stripe throws', async () => {
    (service as any).stripe = {
      balance: { retrieve: jest.fn().mockRejectedValue(new Error('fail')) },
    } as any;

    const result = await service.isAvailable();
    expect(result).toBe(false);
  });
});
