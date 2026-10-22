import { BadRequestException } from '@nestjs/common';
import { BarbershopService } from './barbershop.service';
import {
  NETWORK_BONUS_MESSAGE,
  NETWORK_CITY_MESSAGE,
  NETWORK_CURRENCY_LOCKED_MESSAGE,
  NETWORK_DESCRIPTION_MESSAGE,
  NETWORK_FEE_FIXED_MESSAGE,
  NETWORK_FEE_PERCENT_MESSAGE,
  NETWORK_FEE_TYPE_MESSAGE,
  NETWORK_LOGO_MESSAGE,
  NETWORK_NAME_MESSAGE,
  NETWORK_POINT_VALUE_MESSAGE,
  NETWORK_POINTS_MESSAGE,
  NETWORK_WINDOW_MESSAGE,
  NETWORK_YEAR_MESSAGE,
  SHOP_CURRENCY_INVALID_MESSAGE,
} from './barbershop.service';

const network = { id: 7, currency: 'BRL', noShowFeeType: 'PERCENT', ownerUserId: 1 };

function build(sales = 0) {
  const updates: Record<string, unknown>[] = [];
  const service = Object.create(BarbershopService.prototype) as BarbershopService;
  Object.assign(service, {
    prisma: {
      network: {
        findFirst: async () => network,
        update: async ({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return { id: network.id, ...data };
        },
      },
      sale: { count: async () => sales },
    },
  });
  return { service, updates };
}

async function rejected(data: Record<string, unknown>, sales = 0) {
  const { service, updates } = build(sales);
  await expect(service.updateNetwork(1, data)).rejects.toBeInstanceOf(BadRequestException);
  expect(updates).toEqual([]);
  return service.updateNetwork(1, data);
}

describe('regras da rede', () => {
  it('rejeita taxa percentual fora de 0 a 100 e tipo desconhecido', async () => {
    await expect(rejected({ noShowFeeValue: 500 })).rejects.toThrow(NETWORK_FEE_PERCENT_MESSAGE);
    await expect(rejected({ noShowFeeValue: -1 })).rejects.toThrow(NETWORK_FEE_PERCENT_MESSAGE);
    await expect(rejected({ noShowFeeType: 'LOTS' })).rejects.toThrow(NETWORK_FEE_TYPE_MESSAGE);
  });

  it('grava percentual válido e rejeita taxa fixa fora do teto da moeda', async () => {
    const { service, updates } = build();
    await service.updateNetwork(1, { noShowFeeType: 'PERCENT', noShowFeeValue: 30 });
    expect(updates[0]).toMatchObject({ noShowFeeType: 'PERCENT', noShowFeeValue: 30 });

    await expect(
      rejected({ noShowFeeType: 'FIXED', noShowFeeValue: -5 }),
    ).rejects.toThrow(NETWORK_FEE_FIXED_MESSAGE);
    await expect(
      rejected({ noShowFeeType: 'FIXED', noShowFeeValue: 2_000_000 }),
    ).rejects.toThrow(NETWORK_FEE_FIXED_MESSAGE);
  });

  it('a janela de cancelamento é um inteiro de 0 a 72 horas', async () => {
    await expect(rejected({ lateCancellationWindowHours: 10_000 })).rejects.toThrow(
      NETWORK_WINDOW_MESSAGE,
    );
    await expect(rejected({ lateCancellationWindowHours: -1 })).rejects.toThrow(
      NETWORK_WINDOW_MESSAGE,
    );
    await expect(rejected({ lateCancellationWindowHours: 12.5 })).rejects.toThrow(
      NETWORK_WINDOW_MESSAGE,
    );
    const { service, updates } = build();
    await service.updateNetwork(1, { lateCancellationWindowHours: 0 });
    await service.updateNetwork(1, { lateCancellationWindowHours: 72 });
    expect(updates.map((row) => row.lateCancellationWindowHours)).toEqual([0, 72]);
  });

  it('limita pontos, valor do ponto, bônus e ano de fundação', async () => {
    await expect(rejected({ loyaltyPointsPerCurrencyUnit: 1000 })).rejects.toThrow(
      NETWORK_POINTS_MESSAGE,
    );
    await expect(rejected({ loyaltyPointValue: -1 })).rejects.toThrow(NETWORK_POINT_VALUE_MESSAGE);
    await expect(rejected({ loyaltyPointValue: 101 })).rejects.toThrow(NETWORK_POINT_VALUE_MESSAGE);
    await expect(rejected({ referralBonusPoints: 1_000_000 })).rejects.toThrow(NETWORK_BONUS_MESSAGE);
    await expect(rejected({ foundationYear: 9999 })).rejects.toThrow(NETWORK_YEAR_MESSAGE);
    await expect(rejected({ foundationYear: 20.5 })).rejects.toThrow(NETWORK_YEAR_MESSAGE);
  });

  it('a moeda precisa existir e não muda depois de uma venda paga', async () => {
    await expect(rejected({ currency: 'XYZ' })).rejects.toThrow(SHOP_CURRENCY_INVALID_MESSAGE);
    await expect(rejected({ currency: 'EUR' }, 1)).rejects.toThrow(NETWORK_CURRENCY_LOCKED_MESSAGE);

    const { service, updates } = build(0);
    await service.updateNetwork(1, { currency: 'eur' });
    expect(updates[0]).toMatchObject({ currency: 'EUR' });
  });

  it('o logo só entra como link https e os textos têm tamanho máximo', async () => {
    await expect(rejected({ logoUrl: 'http://cdn.example/logo.png' })).rejects.toThrow(
      NETWORK_LOGO_MESSAGE,
    );
    await expect(rejected({ logoUrl: 'javascript:alert(1)' })).rejects.toThrow(NETWORK_LOGO_MESSAGE);
    await expect(rejected({ name: 'n'.repeat(121) })).rejects.toThrow(NETWORK_NAME_MESSAGE);
    await expect(rejected({ city: 'c'.repeat(81) })).rejects.toThrow(NETWORK_CITY_MESSAGE);
    await expect(rejected({ description: 'd'.repeat(1001) })).rejects.toThrow(
      NETWORK_DESCRIPTION_MESSAGE,
    );

    const { service, updates } = build();
    await service.updateNetwork(1, { logoUrl: 'https://cdn.example/logo.png' });
    expect(updates[0]).toMatchObject({
      logoUrl: 'https://cdn.example/logo.png',
      logoKey: null,
    });
  });
});
