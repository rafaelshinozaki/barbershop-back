import { payoutReport, type PayoutCharge } from './payout-report';

const charge = (amount: number, extra: Partial<PayoutCharge> = {}): PayoutCharge => ({
  amount,
  refunded: 0,
  feePercent: 10,
  viaConnect: false,
  ...extra,
});

describe('relatório de repasse (item 176)', () => {
  const october = [charge(100), charge(50)];

  it('repasse feito no mês seguinte: outubro fica com o saldo, novembro zera', () => {
    const oct = payoutReport({
      inPeriod: october,
      untilPeriodEnd: october,
      payoutsInPeriod: [],
      payoutsUntilPeriodEnd: [],
      currentFee: 10,
      currency: 'BRL',
    });
    expect(oct).toMatchObject({
      grossAmount: 150,
      platformFeeAmount: 15,
      netOwedToBarbershop: 135,
    });

    const nov = payoutReport({
      inPeriod: [],
      untilPeriodEnd: october,
      payoutsInPeriod: [135],
      payoutsUntilPeriodEnd: [135],
      currentFee: 10,
      currency: 'BRL',
    });
    // Antes ficava -135 em novembro
    expect(nov).toMatchObject({ grossAmount: 0, paidOutManually: 135, netOwedToBarbershop: 0 });
  });

  it('estorno depois do repasse aparece: saldo negativo e o valor estornado no período', () => {
    const refunded = [charge(100, { refunded: 100 }), charge(50)];
    const report = payoutReport({
      inPeriod: refunded,
      untilPeriodEnd: refunded,
      payoutsInPeriod: [135],
      payoutsUntilPeriodEnd: [135],
      currentFee: 10,
      currency: 'BRL',
    });
    expect(report).toMatchObject({
      paymentsCount: 2,
      grossAmount: 50,
      refundedAmount: 100,
      platformFeeAmount: 5,
      // A unidade recebeu 135 e o devido era 45: 90 a receber de volta
      netOwedToBarbershop: -90,
    });
  });

  it('o que caiu direto na conta da unidade não entra no saldo', () => {
    const charges = [charge(100, { viaConnect: true }), charge(100)];
    const report = payoutReport({
      inPeriod: charges,
      untilPeriodEnd: charges,
      payoutsInPeriod: [],
      payoutsUntilPeriodEnd: [],
      currentFee: 10,
      currency: 'BRL',
    });
    expect(report).toMatchObject({ paidOutAutomatically: 90, netOwedToBarbershop: 90 });
  });

  it('moeda sem centavos arredonda inteiro; sem taxa gravada usa a de hoje', () => {
    const report = payoutReport({
      inPeriod: [charge(1005, { feePercent: null })],
      untilPeriodEnd: [charge(1005, { feePercent: null })],
      payoutsInPeriod: [],
      payoutsUntilPeriodEnd: [],
      currentFee: 15,
      currency: 'JPY',
    });
    // 15% de 1005 = 150,75 → 151 ienes
    expect(report).toMatchObject({ platformFeeAmount: 151, netOwedToBarbershop: 854 });
  });
});
