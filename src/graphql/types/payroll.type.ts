import { Field, Float, InputType, Int, ObjectType } from '@nestjs/graphql';

/** Como o profissional é pago nesta unidade */
@ObjectType()
export class BarberPayConfigType {
  @Field(() => Int)
  barberId: number;

  /** COMMISSION | FIXED | FIXED_PLUS_COMMISSION | GREATER_OF */
  @Field()
  payType: string;

  /** Valor fixo por período (payPeriod) */
  @Field(() => Float, { nullable: true })
  fixedAmount?: number | null;

  /** MONTHLY | BIWEEKLY | WEEKLY */
  @Field()
  payPeriod: string;
}

/** Gorjeta, vale, bônus ou desconto */
@ObjectType()
export class BarberPayEntryType {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  barberId: number;

  /** TIP | ADVANCE | BONUS | DEDUCTION */
  @Field()
  type: string;

  @Field(() => Float)
  amount: number;

  @Field({ nullable: true })
  method?: string | null;

  @Field()
  date: Date;

  @Field({ nullable: true })
  notes?: string | null;

  /** Fechamento em que entrou (null = em aberto) */
  @Field(() => Int, { nullable: true })
  payoutId?: number | null;

  @Field()
  createdAt: Date;
}

@ObjectType()
class PayBreakdown {
  @Field(() => Int)
  barberId: number;

  @Field()
  barberName: string;

  @Field()
  periodStart: Date;

  @Field()
  periodEnd: Date;

  @Field()
  payType: string;

  @Field(() => Int)
  salesCount: number;

  @Field(() => Float)
  serviceSales: number;

  @Field(() => Float)
  productSales: number;

  @Field(() => Float)
  commission: number;

  @Field(() => Float)
  fixedAmount: number;

  /** O que vale pela forma de pagamento (fixo, comissão, os dois ou o maior) */
  @Field(() => Float)
  baseAmount: number;

  @Field(() => Float)
  tips: number;

  @Field(() => Float)
  bonuses: number;

  @Field(() => Float)
  deductions: number;

  @Field(() => Float)
  advances: number;

  /** A pagar (prévia) ou pago (fechamento) */
  @Field(() => Float)
  total: number;

  @Field()
  currency: string;
}

@ObjectType()
export class PayrollPreviewType extends PayBreakdown {
  @Field(() => [BarberPayEntryType])
  entries: BarberPayEntryType[];

  /** Período que se sobrepõe a um pagamento já feito */
  @Field({ nullable: true })
  alreadyPaid?: string | null;
}

@ObjectType()
export class BarberPayoutType extends PayBreakdown {
  @Field(() => Int)
  id: number;

  @Field()
  method: string;

  @Field()
  paidAt: Date;

  @Field({ nullable: true })
  notes?: string | null;
}

@ObjectType()
export class MonthTotalType {
  /** YYYY-MM */
  @Field()
  month: string;

  @Field(() => Float)
  total: number;
}

/** Extrato de um profissional */
@ObjectType()
export class BarberPayStatementType {
  @Field(() => Int)
  barberId: number;

  @Field()
  barberName: string;

  @Field()
  currency: string;

  @Field(() => BarberPayConfigType)
  config: BarberPayConfigType;

  /** Em aberto: do dia seguinte ao último pagamento até hoje */
  @Field(() => PayrollPreviewType, { nullable: true })
  current?: PayrollPreviewType | null;

  @Field(() => [BarberPayEntryType])
  openEntries: BarberPayEntryType[];

  @Field(() => [BarberPayoutType])
  payouts: BarberPayoutType[];

  /** Recebido por mês (pagamentos + vales), últimos 12 meses */
  @Field(() => [MonthTotalType])
  receivedByMonth: MonthTotalType[];
}

@ObjectType()
export class PayrollRowType {
  @Field(() => Int)
  barberId: number;

  @Field()
  barberName: string;

  @Field()
  isActive: boolean;

  @Field()
  payType: string;

  @Field(() => Float, { nullable: true })
  fixedAmount?: number | null;

  @Field(() => Int)
  salesCount: number;

  /** Vendas que o profissional gerou no período */
  @Field(() => Float)
  sales: number;

  @Field(() => Float)
  commission: number;

  @Field(() => Float)
  tips: number;

  @Field(() => Float)
  bonuses: number;

  @Field(() => Float)
  deductions: number;

  @Field(() => Float)
  advancesPaid: number;

  /** Efetivamente pago no período (pagamentos + vales) */
  @Field(() => Float)
  paid: number;

  @Field(() => Int)
  payoutsCount: number;
}

@ObjectType()
export class PayrollOverviewType {
  @Field()
  periodStart: Date;

  @Field()
  periodEnd: Date;

  @Field()
  currency: string;

  @Field(() => [PayrollRowType])
  rows: PayrollRowType[];

  @Field(() => Float)
  totalRevenue: number;

  @Field(() => Float)
  totalPaid: number;

  @Field(() => Float)
  totalCommission: number;

  @Field(() => Float)
  totalTips: number;

  /** Quanto do faturamento foi pra equipe (%) */
  @Field(() => Float, { nullable: true })
  staffCostPercent?: number | null;
}

@InputType()
export class SetBarberPayConfigInput {
  @Field(() => Int)
  barberId: number;

  @Field()
  payType: string;

  @Field(() => Float, { nullable: true })
  fixedAmount?: number | null;

  @Field({ nullable: true })
  payPeriod?: string | null;
}

@InputType()
export class AddBarberPayEntryInput {
  @Field(() => Int)
  barberId: number;

  @Field()
  type: string;

  @Field(() => Float)
  amount: number;

  @Field({ nullable: true })
  method?: string | null;

  /** YYYY-MM-DD (fuso da unidade); padrão: agora */
  @Field({ nullable: true })
  date?: string | null;

  @Field({ nullable: true })
  notes?: string | null;
}

@InputType()
export class PayBarberInput {
  @Field(() => Int)
  barberId: number;

  /** YYYY-MM-DD */
  @Field()
  from: string;

  /** YYYY-MM-DD */
  @Field()
  to: string;

  /** CASH | PIX | TRANSFER | OTHER */
  @Field()
  method: string;

  @Field({ nullable: true })
  notes?: string | null;
}
