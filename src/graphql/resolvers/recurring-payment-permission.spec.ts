import { readFileSync } from 'fs';
import { join } from 'path';
import { NotFoundException } from '@nestjs/common';
import { PaymentResolver } from './payment.resolver';
import { BackofficeResolver } from './backoffice.resolver';

/**
 * A renovação de todos os planos saiu do resolver da conta. Quem está logado
 * como dono ou profissional não tem a mutation: a cobrança de todos fica só
 * no backoffice (área Financeiro) e no agendador.
 */
describe('cobrança recorrente', () => {
  const payments = {
    processRecurringPayments: jest.fn(),
    forceRecurringPayment: jest.fn(),
  };

  beforeEach(() => {
    payments.processRecurringPayments.mockReset();
    payments.forceRecurringPayment.mockReset();
  });

  it('conta comum chamando a mutation recebe sem permissão', () => {
    expect(PaymentResolver.prototype).not.toHaveProperty('processAllRecurringPayments');
    const src = readFileSync(join(__dirname, 'payment.resolver.ts'), 'utf8');
    expect(src).not.toMatch(/processRecurringPayments\s*\(/);
    const schema = readFileSync(join(__dirname, '../../schema.gql'), 'utf8');
    expect(schema).not.toMatch(/^\s*processAllRecurringPayments:/m);
    expect(schema).toContain('processAllRecurringPaymentsAdmin');
    expect(payments.processRecurringPayments).not.toHaveBeenCalled();
  });

  it('a cobrança do próprio plano tem limite de chamadas', () => {
    const method = PaymentResolver.prototype.processRecurringPayment;
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', method)).toBe(5);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', method)).toBe(3_600_000);
  });

  it('erro interno da cobrança do próprio plano não volta na resposta', async () => {
    payments.forceRecurringPayment.mockRejectedValue(
      new Error('No such customer: cus_secret sk_live_abc'),
    );
    const resolver = new PaymentResolver({} as never, {} as never, payments as never);
    const res = await resolver.processRecurringPayment(4, { req: { user: { id: 9 } } });
    expect(payments.forceRecurringPayment).toHaveBeenCalledWith(4, 9);
    expect(res.success).toBe(false);
    expect(res.message).toBe('Não foi possível processar a cobrança');
    expect(JSON.stringify(res)).not.toMatch(/sk_live|cus_secret/);
  });

  it('pagamento que não é do dono leva a mensagem da aplicação', async () => {
    payments.forceRecurringPayment.mockRejectedValue(
      new NotFoundException('Pagamento não encontrado'),
    );
    const resolver = new PaymentResolver({} as never, {} as never, payments as never);
    const res = await resolver.processRecurringPayment(4, { req: { user: { id: 9 } } });
    expect(res.message).toBe('Pagamento não encontrado');
  });

  it('o backoffice não devolve a mensagem interna', async () => {
    payments.processRecurringPayments.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5'));
    payments.forceRecurringPayment.mockRejectedValue(
      new Error('Invalid prisma.payment.findUnique() invocation'),
    );
    const admin = new BackofficeResolver({} as never, {} as never, {} as never, payments as never);
    const all = await admin.processAllRecurringPaymentsAdmin();
    expect(all.success).toBe(false);
    expect(all.message).toBe('Não foi possível processar as cobranças');
    expect(JSON.stringify(all)).not.toMatch(/ECONNREFUSED/);
    const one = await admin.processRecurringPaymentAdmin(3);
    expect(one.message).toBe('Não foi possível processar a cobrança');
    expect(JSON.stringify(one)).not.toMatch(/prisma/);
  });
});
