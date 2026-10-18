import { roundMoney } from '../common/money-units';

/** Um pagamento que a plataforma recebeu em nome da unidade (sinal ou clube) */
export interface PayoutCharge {
  amount: number;
  /** O que já voltou para o cliente */
  refunded: number;
  /** Taxa de quando foi cobrado (null: a taxa de hoje) */
  feePercent: number | null;
  /** Caiu direto na conta Connect da unidade: já está repassado */
  viaConnect: boolean;
}

function totals(charges: PayoutCharge[], currentFee: number, currency: string | null) {
  let gross = 0;
  let fee = 0;
  let automatic = 0;
  let refunded = 0;
  for (const c of charges) {
    // O que voltou pro cliente não entra (nem a taxa sobre ele)
    const net = c.amount - c.refunded;
    const chargeFee = roundMoney((net * (c.feePercent ?? currentFee)) / 100, currency);
    gross += net;
    fee += chargeFee;
    refunded += c.refunded;
    if (c.viaConnect) automatic += net - chargeFee;
  }
  return {
    gross: roundMoney(gross, currency),
    fee: roundMoney(fee, currency),
    automatic: roundMoney(automatic, currency),
    refunded: roundMoney(refunded, currency),
  };
}

/**
 * Relatório de repasse. Os números do período são das cobranças feitas nele.
 * O "a repassar" é o saldo até o fim do período: tudo o que foi cobrado menos
 * a taxa, o que caiu direto na conta da unidade e os repasses manuais. Assim
 * um repasse feito no mês seguinte não deixa um mês positivo e o outro
 * negativo, e o estorno depois do repasse aparece como saldo negativo (a
 * unidade recebeu a mais).
 */
export function payoutReport(input: {
  inPeriod: PayoutCharge[];
  untilPeriodEnd: PayoutCharge[];
  payoutsInPeriod: number[];
  payoutsUntilPeriodEnd: number[];
  currentFee: number;
  currency: string | null;
}) {
  const { currentFee, currency } = input;
  const period = totals(input.inPeriod, currentFee, currency);
  const all = totals(input.untilPeriodEnd, currentFee, currency);
  const sum = (values: number[]) =>
    roundMoney(
      values.reduce((a, b) => a + b, 0),
      currency,
    );
  const paidOutManually = sum(input.payoutsInPeriod);
  return {
    paymentsCount: input.inPeriod.length,
    grossAmount: period.gross,
    refundedAmount: period.refunded,
    // Taxa efetiva do período (média ponderada quando a taxa mudou no meio)
    platformFeePercentage:
      period.gross > 0 ? Math.round((period.fee / period.gross) * 10000) / 100 : currentFee,
    platformFeeAmount: period.fee,
    paidOutAutomatically: period.automatic,
    paidOutManually,
    netOwedToBarbershop: roundMoney(
      all.gross - all.fee - all.automatic - sum(input.payoutsUntilPeriodEnd),
      currency,
    ),
  };
}
