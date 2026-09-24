import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { nextDateStr, safeTimeZone, toZonedParts, zonedTimeToUtc } from '../common/timezone.util';
import { BarbershopService } from './barbershop.service';

export const PAY_TYPES = ['COMMISSION', 'FIXED', 'FIXED_PLUS_COMMISSION', 'GREATER_OF'] as const;
export type PayType = (typeof PAY_TYPES)[number];
export const PAY_PERIODS = ['MONTHLY', 'BIWEEKLY', 'WEEKLY'] as const;
export const ENTRY_TYPES = ['TIP', 'ADVANCE', 'BONUS', 'DEDUCTION'] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];
export const PAY_METHODS = ['CASH', 'PIX', 'TRANSFER', 'OTHER'] as const;

const MAX_AMOUNT = 1_000_000;
const MAX_PERIOD_DAYS = 400;
const round2 = (n: number) => Math.round(n * 100) / 100;

type Shop = { id: number; timezone: string | null; currency: string };

/**
 * Pagamento da equipe: como cada profissional é pago (fixo, comissão, fixo +
 * comissão ou o maior dos dois), os lançamentos avulsos (gorjeta, vale,
 * bônus, desconto) e o fechamento de cada período, registrado quando é pago —
 * com a forma de pagamento, a despesa "Salário" lançada e, em dinheiro, a
 * saída do caixa aberto.
 *
 * Tudo fica registrado pra dono e gerente verem quanto cada um recebe (e o
 * custo da equipe sobre o faturamento), e pro próprio profissional ver o
 * extrato dele. O dinheiro sai por fora: o sistema não transfere nada.
 */
@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly barbershopService: BarbershopService,
  ) {}

  // ---- datas: o período é em dias no fuso da unidade ----

  private range(shop: Shop, from: string, to: string) {
    // Data que existe (2026-02-31 não vira 3 de março em silêncio) e período
    // de no máximo ~13 meses (um intervalo de décadas varria todas as vendas)
    const valid = (d: string) =>
      /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
    if (!valid(from) || !valid(to) || from > to) {
      throw new BadRequestException('Período inválido');
    }
    if (Date.parse(to) - Date.parse(from) > MAX_PERIOD_DAYS * 86_400_000) {
      throw new BadRequestException(`O período pode ter no máximo ${MAX_PERIOD_DAYS} dias`);
    }
    const tz = safeTimeZone(shop.timezone);
    return {
      start: zonedTimeToUtc(from, 0, tz),
      // Até o fim do dia "to"
      end: new Date(zonedTimeToUtc(nextDateStr(to), 0, tz).getTime() - 1),
    };
  }

  private dayOf(shop: Shop, instant: Date) {
    return toZonedParts(instant, safeTimeZone(shop.timezone)).dateStr;
  }

  private async barberOf(barbershopId: number, barberId: number) {
    const barber = await this.prisma.barber.findFirst({
      where: { id: barberId, barbershopId },
      select: { id: true, name: true, staffType: true, isActive: true },
    });
    if (!barber) throw new NotFoundException('Profissional não encontrado');
    return barber;
  }

  private async openCashSessionId(barbershopId: number, method?: string | null) {
    if (method !== 'CASH') return null;
    const session = await this.prisma.cashSession.findFirst({
      where: { barbershopId, status: 'OPEN' },
      select: { id: true },
    });
    return session?.id ?? null;
  }

  private async ensureCashStillOpen(cashSessionId: number | null) {
    if (!cashSessionId) return;
    const session = await this.prisma.cashSession.findUnique({
      where: { id: cashSessionId },
      select: { status: true },
    });
    if (session?.status === 'CLOSED') {
      throw new BadRequestException(
        'O caixa em que esse dinheiro saiu já foi fechado. Lance a correção no caixa.',
      );
    }
  }

  // ---- forma de pagamento ----

  private configView(
    barberId: number,
    c: { payType: string; fixedAmount: Decimal | null; payPeriod: string } | null,
  ) {
    return {
      barberId,
      payType: c?.payType ?? 'COMMISSION',
      fixedAmount: c?.fixedAmount != null ? Number(c.fixedAmount) : null,
      payPeriod: c?.payPeriod ?? 'MONTHLY',
    };
  }

  async setConfig(
    userId: number,
    barbershopId: number,
    barberId: number,
    data: { payType: string; fixedAmount?: number | null; payPeriod?: string | null },
  ) {
    await this.barbershopService.ensureAccess(userId, barbershopId, 'manager');
    await this.barberOf(barbershopId, barberId);
    if (!(PAY_TYPES as readonly string[]).includes(data.payType)) {
      throw new BadRequestException('Forma de pagamento inválida');
    }
    const period = data.payPeriod ?? 'MONTHLY';
    if (!(PAY_PERIODS as readonly string[]).includes(period)) {
      throw new BadRequestException('Período inválido');
    }
    const needsFixed = data.payType !== 'COMMISSION';
    const fixed = data.fixedAmount ?? null;
    if (needsFixed && (fixed == null || !(fixed > 0) || fixed > MAX_AMOUNT)) {
      throw new BadRequestException('Informe o valor fixo');
    }
    const saved = await this.prisma.barberPayConfig.upsert({
      where: { barberId },
      create: {
        barberId,
        barbershopId,
        payType: data.payType,
        fixedAmount: needsFixed ? new Decimal(round2(fixed!)) : null,
        payPeriod: period,
      },
      update: {
        payType: data.payType,
        fixedAmount: needsFixed ? new Decimal(round2(fixed!)) : null,
        payPeriod: period,
      },
    });
    return this.configView(barberId, saved);
  }

  // ---- lançamentos avulsos ----

  private entryView(e: {
    id: number;
    barberId: number;
    type: string;
    amount: Decimal;
    method: string | null;
    date: Date;
    notes: string | null;
    payoutId: number | null;
    createdAt: Date;
  }) {
    return {
      id: e.id,
      barberId: e.barberId,
      type: e.type,
      amount: Number(e.amount),
      method: e.method,
      date: e.date,
      notes: e.notes,
      payoutId: e.payoutId,
      createdAt: e.createdAt,
    };
  }

  /**
   * Gorjeta a receber, vale/adiantamento (já pago: vira despesa "Salário" e,
   * em dinheiro, sai do caixa aberto), bônus ou desconto. Entra no próximo
   * fechamento do profissional.
   */
  async addEntry(
    userId: number,
    barbershopId: number,
    data: {
      barberId: number;
      type: string;
      amount: number;
      method?: string | null;
      date?: string | null;
      notes?: string | null;
    },
  ) {
    const shop = await this.barbershopService.ensureAccess(userId, barbershopId, 'manager');
    const barber = await this.barberOf(barbershopId, data.barberId);
    if (!(ENTRY_TYPES as readonly string[]).includes(data.type)) {
      throw new BadRequestException('Tipo de lançamento inválido');
    }
    if (!(data.amount > 0) || data.amount > MAX_AMOUNT) {
      throw new BadRequestException('Valor inválido');
    }
    const isAdvance = data.type === 'ADVANCE';
    if (isAdvance && !(PAY_METHODS as readonly string[]).includes(data.method ?? '')) {
      throw new BadRequestException('Informe como o vale foi pago');
    }
    const date = data.date ? this.range(shop, data.date, data.date).start : new Date();
    const amount = new Decimal(round2(data.amount));
    const entry = await this.prisma.$transaction(async (tx) => {
      let expenseId: number | null = null;
      let cashSessionId: number | null = null;
      if (isAdvance) {
        cashSessionId = await this.openCashSessionId(barbershopId, data.method);
        const expense = await tx.expense.create({
          data: {
            barbershopId,
            cashSessionId,
            category: 'SALARY',
            description: `Vale — ${barber.name}`,
            amount,
            paymentMethod: data.method,
            expenseDate: date,
            createdByUserId: userId,
          },
          select: { id: true },
        });
        expenseId = expense.id;
      }
      return tx.barberPayEntry.create({
        data: {
          barbershopId,
          barberId: barber.id,
          type: data.type,
          amount,
          method: isAdvance ? data.method : data.method ?? null,
          date,
          notes: data.notes?.trim() || null,
          expenseId,
          cashSessionId,
          createdByUserId: userId,
        },
      });
    });
    return this.entryView(entry);
  }

  /** Lançamento errado (ainda fora de um fechamento): apaga, junto com a despesa do vale. */
  async deleteEntry(userId: number, barbershopId: number, entryId: number) {
    await this.barbershopService.ensureAccess(userId, barbershopId, 'manager');
    const entry = await this.prisma.barberPayEntry.findFirst({
      where: { id: entryId, barbershopId },
    });
    if (!entry) throw new NotFoundException('Lançamento não encontrado');
    if (entry.payoutId) {
      throw new BadRequestException(
        'Esse lançamento já entrou num pagamento. Desfaça o pagamento antes.',
      );
    }
    await this.ensureCashStillOpen(entry.cashSessionId);
    await this.prisma.$transaction(async (tx) => {
      if (entry.expenseId) await tx.expense.deleteMany({ where: { id: entry.expenseId } });
      await tx.barberPayEntry.delete({ where: { id: entry.id } });
    });
    return true;
  }

  // ---- fechamento ----

  /**
   * Quanto o profissional tem a receber no período: a base pela forma de
   * pagamento + gorjetas + bônus − descontos − vales. Os lançamentos que
   * entram são todos os ainda fora de um fechamento até o fim do período
   * (um vale antigo esquecido não fica pra trás).
   */
  private async compute(
    shop: Shop,
    barberId: number,
    start: Date,
    end: Date,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const [config, commissions, entries] = await Promise.all([
      client.barberPayConfig.findUnique({ where: { barberId } }),
      this.barbershopService.computeCommissions(shop.id, start, end),
      client.barberPayEntry.findMany({
        where: { barberId, barbershopId: shop.id, payoutId: null, date: { lte: end } },
        orderBy: { date: 'asc' },
      }),
    ]);
    const c = this.configView(barberId, config);
    const row = commissions.rows.find((r) => r.barberId === barberId);
    const commission = round2(row?.totalCommission ?? 0);
    const fixed = c.payType === 'COMMISSION' ? 0 : c.fixedAmount ?? 0;
    const base =
      c.payType === 'FIXED'
        ? fixed
        : c.payType === 'FIXED_PLUS_COMMISSION'
        ? fixed + commission
        : c.payType === 'GREATER_OF'
        ? Math.max(fixed, commission)
        : commission;
    const sum = (type: EntryType) =>
      round2(entries.filter((e) => e.type === type).reduce((s, e) => s + Number(e.amount), 0));
    const tips = sum('TIP');
    const bonuses = sum('BONUS');
    const deductions = sum('DEDUCTION');
    const advances = sum('ADVANCE');
    return {
      config: c,
      salesCount: row?.salesCount ?? 0,
      serviceSales: round2(row?.totalServiceSales ?? 0),
      productSales: round2(row?.totalProductSales ?? 0),
      commission,
      fixedAmount: round2(fixed),
      baseAmount: round2(base),
      tips,
      bonuses,
      deductions,
      advances,
      total: round2(base + tips + bonuses - deductions - advances),
      entries,
    };
  }

  private async overlapping(
    barberId: number,
    start: Date,
    end: Date,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    return client.barberPayout.findFirst({
      where: { barberId, periodStart: { lte: end }, periodEnd: { gte: start } },
      select: { id: true, periodStart: true, periodEnd: true },
    });
  }

  async preview(userId: number, barbershopId: number, barberId: number, from: string, to: string) {
    const shop = await this.barbershopService.ensureAccess(userId, barbershopId, 'manager');
    const barber = await this.barberOf(barbershopId, barberId);
    const { start, end } = this.range(shop, from, to);
    const result = await this.compute(shop, barber.id, start, end);
    const clash = await this.overlapping(barber.id, start, end);
    return this.previewView(shop, barber, start, end, result, clash);
  }

  private previewView(
    shop: Shop,
    barber: { id: number; name: string },
    start: Date,
    end: Date,
    r: Awaited<ReturnType<PayrollService['compute']>>,
    clash: { periodStart: Date; periodEnd: Date } | null,
  ) {
    return {
      barberId: barber.id,
      barberName: barber.name,
      periodStart: start,
      periodEnd: end,
      payType: r.config.payType,
      salesCount: r.salesCount,
      serviceSales: r.serviceSales,
      productSales: r.productSales,
      commission: r.commission,
      fixedAmount: r.fixedAmount,
      baseAmount: r.baseAmount,
      tips: r.tips,
      bonuses: r.bonuses,
      deductions: r.deductions,
      advances: r.advances,
      total: r.total,
      currency: shop.currency,
      entries: r.entries.map((e) => this.entryView(e)),
      // Período que já tem pagamento: não dá pra pagar de novo
      alreadyPaid: clash
        ? `${this.dayOf(shop, clash.periodStart)} – ${this.dayOf(shop, clash.periodEnd)}`
        : null,
    };
  }

  /**
   * Registra o pagamento do período: guarda a foto do cálculo, fecha os
   * lançamentos, lança a despesa "Salário" (em dinheiro, saindo do caixa
   * aberto). Vale maior que o devido: paga 0 e a diferença vira vale do
   * próximo período.
   */
  async pay(
    userId: number,
    barbershopId: number,
    data: { barberId: number; from: string; to: string; method: string; notes?: string | null },
  ) {
    const shop = await this.barbershopService.ensureAccess(userId, barbershopId, 'manager');
    const barber = await this.barberOf(barbershopId, data.barberId);
    if (!(PAY_METHODS as readonly string[]).includes(data.method)) {
      throw new BadRequestException('Forma de pagamento inválida');
    }
    const { start, end } = this.range(shop, data.from, data.to);
    const cashSessionId = await this.openCashSessionId(barbershopId, data.method);

    const payout = await this.prisma.$transaction(
      async (tx) => {
        // Dois cliques (ou duas abas) não pagam o mesmo período duas vezes
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(4, ${barber.id}::int)`;
        const clash = await this.overlapping(barber.id, start, end, tx);
        if (clash) {
          throw new BadRequestException(
            `Esse período já foi pago (${this.dayOf(shop, clash.periodStart)} – ${this.dayOf(
              shop,
              clash.periodEnd,
            )})`,
          );
        }
        const r = await this.compute(shop, barber.id, start, end, tx);
        const toPay = Math.max(r.total, 0);
        const label = `${this.dayOf(shop, start)} – ${this.dayOf(shop, end)}`;
        const expense =
          toPay > 0
            ? await tx.expense.create({
                data: {
                  barbershopId,
                  cashSessionId,
                  category: 'SALARY',
                  description: `Pagamento — ${barber.name} (${label})`,
                  amount: new Decimal(toPay),
                  paymentMethod: data.method,
                  createdByUserId: userId,
                },
                select: { id: true },
              })
            : null;
        const created = await tx.barberPayout.create({
          data: {
            barbershopId,
            barberId: barber.id,
            periodStart: start,
            periodEnd: end,
            payType: r.config.payType,
            serviceSales: new Decimal(r.serviceSales),
            productSales: new Decimal(r.productSales),
            salesCount: r.salesCount,
            commission: new Decimal(r.commission),
            fixedAmount: new Decimal(r.fixedAmount),
            baseAmount: new Decimal(r.baseAmount),
            tips: new Decimal(r.tips),
            bonuses: new Decimal(r.bonuses),
            deductions: new Decimal(r.deductions),
            advances: new Decimal(r.advances),
            total: new Decimal(toPay),
            currency: shop.currency,
            method: data.method,
            notes: data.notes?.trim() || null,
            expenseId: expense?.id ?? null,
            cashSessionId: expense ? cashSessionId : null,
            createdByUserId: userId,
          },
        });
        if (r.entries.length) {
          await tx.barberPayEntry.updateMany({
            where: { id: { in: r.entries.map((e) => e.id) }, payoutId: null },
            data: { payoutId: created.id },
          });
        }
        if (r.total < 0) {
          const carry = await tx.barberPayEntry.create({
            data: {
              barbershopId,
              barberId: barber.id,
              type: 'ADVANCE',
              amount: new Decimal(round2(-r.total)),
              date: new Date(end.getTime() + 1),
              notes: `Vale restante do pagamento de ${label}`,
              createdByUserId: userId,
            },
          });
          return tx.barberPayout.update({
            where: { id: created.id },
            data: { carryOverEntryId: carry.id },
          });
        }
        return created;
      },
      { timeout: 30_000, maxWait: 30_000 },
    );
    return this.payoutView(payout, barber.name);
  }

  /** Pagamento registrado errado: volta tudo (lançamentos em aberto, despesa apagada). */
  async undoPayout(userId: number, barbershopId: number, payoutId: number) {
    await this.barbershopService.ensureAccess(userId, barbershopId, 'manager');
    const payout = await this.prisma.barberPayout.findFirst({
      where: { id: payoutId, barbershopId },
    });
    if (!payout) throw new NotFoundException('Pagamento não encontrado');
    await this.ensureCashStillOpen(payout.cashSessionId);
    if (payout.carryOverEntryId) {
      const carry = await this.prisma.barberPayEntry.findUnique({
        where: { id: payout.carryOverEntryId },
      });
      if (carry?.payoutId) {
        throw new BadRequestException(
          'O vale que sobrou deste pagamento já entrou no pagamento seguinte. Desfaça aquele antes.',
        );
      }
    }
    await this.prisma.$transaction(async (tx) => {
      if (payout.expenseId) await tx.expense.deleteMany({ where: { id: payout.expenseId } });
      if (payout.carryOverEntryId) {
        await tx.barberPayEntry.deleteMany({ where: { id: payout.carryOverEntryId } });
      }
      await tx.barberPayEntry.updateMany({
        where: { payoutId: payout.id },
        data: { payoutId: null },
      });
      await tx.barberPayout.delete({ where: { id: payout.id } });
    });
    return true;
  }

  private payoutView(
    p: {
      id: number;
      barberId: number;
      periodStart: Date;
      periodEnd: Date;
      payType: string;
      serviceSales: Decimal;
      productSales: Decimal;
      salesCount: number;
      commission: Decimal;
      fixedAmount: Decimal;
      baseAmount: Decimal;
      tips: Decimal;
      bonuses: Decimal;
      deductions: Decimal;
      advances: Decimal;
      total: Decimal;
      currency: string;
      method: string;
      paidAt: Date;
      notes: string | null;
    },
    barberName: string,
  ) {
    return {
      id: p.id,
      barberId: p.barberId,
      barberName,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      payType: p.payType,
      serviceSales: Number(p.serviceSales),
      productSales: Number(p.productSales),
      salesCount: p.salesCount,
      commission: Number(p.commission),
      fixedAmount: Number(p.fixedAmount),
      baseAmount: Number(p.baseAmount),
      tips: Number(p.tips),
      bonuses: Number(p.bonuses),
      deductions: Number(p.deductions),
      advances: Number(p.advances),
      total: Number(p.total),
      currency: p.currency,
      method: p.method,
      paidAt: p.paidAt,
      notes: p.notes,
    };
  }

  // ---- extrato e visão geral ----

  /**
   * Extrato de um profissional: forma de pagamento, lançamentos em aberto,
   * pagamentos e quanto recebeu por mês (pagamentos + vales). O próprio
   * profissional vê o dele; dono e gerente veem de todos.
   */
  async statement(userId: number, barbershopId: number, barberId: number | null) {
    const shop = await this.barbershopService.ensureAccess(userId, barbershopId, 'basic');
    let id = barberId;
    const mine = await this.prisma.barber.findFirst({
      where: { barbershopId, userId },
      select: { id: true },
    });
    const isManager = ['manager', 'owner'].includes(
      (shop as unknown as { accessLevel: string }).accessLevel,
    );
    if (id == null) {
      if (!mine) throw new NotFoundException('Você não tem perfil de profissional nesta unidade');
      id = mine.id;
    } else if (!isManager && id !== mine?.id) {
      // Barbeiro, recepção: só o próprio extrato
      throw new NotFoundException('Profissional não encontrado');
    }
    const barber = await this.barberOf(barbershopId, id);

    const [config, payouts, openEntries, lastPayout] = await Promise.all([
      this.prisma.barberPayConfig.findUnique({ where: { barberId: barber.id } }),
      this.prisma.barberPayout.findMany({
        where: { barberId: barber.id, barbershopId },
        orderBy: { periodEnd: 'desc' },
        take: 36,
      }),
      this.prisma.barberPayEntry.findMany({
        where: { barberId: barber.id, barbershopId, payoutId: null },
        orderBy: { date: 'desc' },
      }),
      this.prisma.barberPayout.findFirst({
        where: { barberId: barber.id, barbershopId },
        orderBy: { periodEnd: 'desc' },
        select: { periodEnd: true },
      }),
    ]);

    // Em aberto: do dia seguinte ao último pagamento (ou do começo do mês) até hoje
    const today = this.dayOf(shop, new Date());
    const openFrom = lastPayout
      ? nextDateStr(this.dayOf(shop, lastPayout.periodEnd))
      : `${today.slice(0, 7)}-01`;
    const current =
      openFrom <= today
        ? await (async () => {
            const { start, end } = this.range(shop, openFrom, today);
            return this.previewView(
              shop,
              barber,
              start,
              end,
              await this.compute(shop, barber.id, start, end),
              null,
            );
          })()
        : null;

    // Recebido por mês (últimos 12): pagamentos + vales (vale já é dinheiro na mão)
    const since = new Date(Date.now() - 366 * 86_400_000);
    const [paidRows, advanceRows] = await Promise.all([
      this.prisma.barberPayout.findMany({
        where: { barberId: barber.id, barbershopId, paidAt: { gte: since } },
        select: { paidAt: true, total: true },
      }),
      this.prisma.barberPayEntry.findMany({
        where: {
          barberId: barber.id,
          barbershopId,
          type: 'ADVANCE',
          expenseId: { not: null },
          date: { gte: since },
        },
        select: { date: true, amount: true },
      }),
    ]);
    const byMonth = new Map<string, number>();
    const add = (d: Date, v: number) => {
      const key = this.dayOf(shop, d).slice(0, 7);
      byMonth.set(key, round2((byMonth.get(key) ?? 0) + v));
    };
    paidRows.forEach((r) => add(r.paidAt, Number(r.total)));
    advanceRows.forEach((r) => add(r.date, Number(r.amount)));

    return {
      barberId: barber.id,
      barberName: barber.name,
      currency: shop.currency,
      config: this.configView(barber.id, config),
      current,
      openEntries: openEntries.map((e) => this.entryView(e)),
      payouts: payouts.map((p) => this.payoutView(p, barber.name)),
      receivedByMonth: [...byMonth.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, total]) => ({ month, total })),
    };
  }

  /**
   * Visão do dono/gerente no período: por profissional, o que gerou de
   * vendas, a comissão, gorjetas, bônus, descontos e quanto foi efetivamente
   * pago (pagamentos + vales); e o custo da equipe sobre o faturamento.
   */
  async overview(userId: number, barbershopId: number, from: string, to: string) {
    const shop = await this.barbershopService.ensureAccess(userId, barbershopId, 'manager');
    const { start, end } = this.range(shop, from, to);
    const [barbers, configs, commissions, entries, payouts, revenue] = await Promise.all([
      this.prisma.barber.findMany({
        where: {
          barbershopId,
          OR: [{ isActive: true }, { payouts: { some: { paidAt: { gte: start, lte: end } } } }],
        },
        select: { id: true, name: true, isActive: true, staffType: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.barberPayConfig.findMany({ where: { barbershopId } }),
      this.barbershopService.computeCommissions(barbershopId, start, end),
      this.prisma.barberPayEntry.findMany({
        where: { barbershopId, date: { gte: start, lte: end } },
      }),
      this.prisma.barberPayout.findMany({
        where: { barbershopId, paidAt: { gte: start, lte: end } },
      }),
      this.prisma.sale.aggregate({
        where: { barbershopId, paymentStatus: 'PAID', createdAt: { gte: start, lte: end } },
        _sum: { total: true },
      }),
    ]);
    const rows = barbers.map((b) => {
      const c = this.configView(b.id, configs.find((x) => x.barberId === b.id) ?? null);
      const com = commissions.rows.find((r) => r.barberId === b.id);
      const mine = entries.filter((e) => e.barberId === b.id);
      const sum = (type: EntryType, onlyPaid = false) =>
        round2(
          mine
            .filter((e) => e.type === type && (!onlyPaid || e.expenseId != null))
            .reduce((s, e) => s + Number(e.amount), 0),
        );
      const paidPayouts = round2(
        payouts.filter((p) => p.barberId === b.id).reduce((s, p) => s + Number(p.total), 0),
      );
      // Vale pago no período (o que sobra de um pagamento não é dinheiro novo)
      const advancesPaid = sum('ADVANCE', true);
      return {
        barberId: b.id,
        barberName: b.name,
        isActive: b.isActive,
        payType: c.payType,
        fixedAmount: c.fixedAmount,
        salesCount: com?.salesCount ?? 0,
        sales: round2((com?.totalServiceSales ?? 0) + (com?.totalProductSales ?? 0)),
        commission: round2(com?.totalCommission ?? 0),
        tips: sum('TIP'),
        bonuses: sum('BONUS'),
        deductions: sum('DEDUCTION'),
        advancesPaid,
        paid: round2(paidPayouts + advancesPaid),
        payoutsCount: payouts.filter((p) => p.barberId === b.id).length,
      };
    });
    const totalRevenue = round2(Number(revenue._sum.total ?? 0));
    const totalPaid = round2(rows.reduce((s, r) => s + r.paid, 0));
    return {
      periodStart: start,
      periodEnd: end,
      currency: shop.currency,
      rows,
      totalRevenue,
      totalPaid,
      totalCommission: round2(rows.reduce((s, r) => s + r.commission, 0)),
      totalTips: round2(rows.reduce((s, r) => s + r.tips, 0)),
      // Quanto do faturamento foi pra equipe
      staffCostPercent: totalRevenue > 0 ? round2((totalPaid / totalRevenue) * 100) : null,
    };
  }
}
