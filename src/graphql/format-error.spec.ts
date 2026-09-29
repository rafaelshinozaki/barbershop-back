import { Prisma } from '@prisma/client';
import { GraphQLError } from 'graphql';
import { formatGqlError } from './format-error';

// Como o Apollo entrega: o erro do resolver embrulhado num GraphQLError
const wrap = (original: Error) =>
  new GraphQLError(original.message, { path: ['financialSummary'], originalError: original });
const formatted = (message: string) => ({ message, path: ['financialSummary'] });

describe('formatGqlError', () => {
  it('data inválida no Prisma vira "Dados inválidos", sem caminho nem consulta', () => {
    const internal =
      '\nInvalid `this.prisma.sale.findMany()` invocation in\n/app/dist/src/barbershop/barbershop.service.js:4788:30';
    const err = new Prisma.PrismaClientValidationError(internal, { clientVersion: '5.22.0' });
    const out = formatGqlError(formatted(internal), wrap(err));
    expect(out).toEqual({
      message: 'Dados inválidos',
      path: ['financialSummary'],
      locations: undefined,
      extensions: { code: 'BAD_USER_INPUT' },
    });
    expect(JSON.stringify(out)).not.toMatch(/dist|findMany|invocation/);
  });

  it('outro erro do banco vira erro interno genérico', () => {
    const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed on email', {
      code: 'P2002',
      clientVersion: '5.22.0',
    });
    const out = formatGqlError(formatted(err.message), wrap(err));
    expect(out.message).toBe('Erro interno. Tente de novo.');
    expect(out.extensions).toEqual({ code: 'INTERNAL_SERVER_ERROR' });
  });

  it('erro da aplicação passa como está (mensagem e código)', () => {
    const out = formatGqlError(
      { message: 'Agendamento não encontrado', extensions: { code: 'NOT_FOUND', stack: 'x' } },
      new GraphQLError('Agendamento não encontrado'),
    );
    expect(out).toEqual({
      message: 'Agendamento não encontrado',
      locations: undefined,
      path: undefined,
      extensions: { code: 'NOT_FOUND' },
    });
  });
});
