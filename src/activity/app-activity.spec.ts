import { BadRequestException, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { Role } from '../auth/interfaces/roles';
import {
  axiomConfig,
  entityFromOperation,
  errorType,
  idsFromArgs,
  type AppActivityEvent,
} from './app-activity';
import { AppActivityInterceptor } from './app-activity.interceptor';
import { AppActivityProcessor } from './app-activity.service';

describe('trilha do app (Axiom)', () => {
  it('sem token ou dataset fica desligada', () => {
    expect(axiomConfig({})).toBeUndefined();
    expect(axiomConfig({ AXIOM_TOKEN: 'x' })).toBeUndefined();
    expect(axiomConfig({ AXIOM_TOKEN: 'x', AXIOM_DATASET: 'app', AXIOM_URL: 'http://a/' })).toEqual(
      {
        token: 'x',
        dataset: 'app',
        url: 'http://a',
      },
    );
  });

  it('só ids saem dos argumentos: unidade, entidade e id', () => {
    expect(
      idsFromArgs({
        input: { barbershopId: 3, customerId: '9', name: 'Ana', phone: '11999', notes: 'alergia' },
      }),
    ).toEqual({ barbershopId: 3, entityType: 'Customer', entityId: 9 });
    expect(idsFromArgs({ appointmentId: 42, reason: 'x' })).toEqual({
      barbershopId: null,
      entityType: 'Appointment',
      entityId: 42,
    });
    expect(idsFromArgs({ params: { id: '7' }, body: { email: 'a@b.c' } })).toMatchObject({
      entityId: 7,
    });
    expect(idsFromArgs(null)).toEqual({ barbershopId: null, entityType: null, entityId: null });
  });

  it('entidade pelo nome da operação e tipo do erro sem a mensagem', () => {
    expect(entityFromOperation('cancelAppointment')).toBe('Appointment');
    expect(entityFromOperation('login')).toBeNull();
    expect(errorType(new BadRequestException('e-mail a@b.c inválido'))).toBe('400');
    expect(errorType({ extensions: { code: 'FORBIDDEN' } })).toBe('FORBIDDEN');
    expect(errorType(new TypeError('x'))).toBe('TypeError');
  });

  describe('interceptor', () => {
    const recorded: AppActivityEvent[] = [];
    const interceptor = (roles: Role[] = []) =>
      new AppActivityInterceptor(
        { getAllAndOverride: () => roles } as never,
        {
          enabled: true,
          record: (e: AppActivityEvent) => recorded.push(e),
        } as never,
      );
    const gql = (parent: string, field: string, args: object, req: object) =>
      ({
        getType: () => 'graphql',
        getHandler: () => undefined,
        getClass: () => undefined,
        getArgs: () => [null, args, { req }, { parentType: { name: parent }, fieldName: field }],
      } as unknown as ExecutionContext);
    const ok = (value: unknown): CallHandler => ({ handle: () => of(value) });

    beforeEach(() => (recorded.length = 0));

    it('mutation de quem usa o app vira evento só com ids', async () => {
      await lastValueFrom(
        interceptor().intercept(
          gql(
            'Mutation',
            'createAppointment',
            { input: { barbershopId: 1, customerName: 'Ana', customerPhone: '11999' } },
            {
              user: { id: 5, role: { name: 'BarbershopOwner' } },
              headers: { 'x-request-id': 'r1' },
            },
          ),
          ok({ id: 77, customerName: 'Ana' }),
        ),
      );
      expect(recorded).toEqual([
        expect.objectContaining({
          requestId: 'r1',
          actorType: 'user',
          actorId: 5,
          role: 'BarbershopOwner',
          barbershopId: 1,
          operation: 'createAppointment',
          entityType: 'Appointment',
          entityId: 77,
          success: true,
          errorType: null,
        }),
      ]);
      expect(JSON.stringify(recorded)).not.toMatch(/Ana|11999/);
    });

    it('cliente sem conta de equipe e falha entram; leitura e backoffice não', async () => {
      await expect(
        lastValueFrom(
          interceptor().intercept(
            gql(
              'Mutation',
              'clientCancelAppointment',
              { appointmentId: 3 },
              { clientUser: { id: 8 } },
            ),
            { handle: () => throwError(() => new BadRequestException('fora do prazo')) },
          ),
        ),
      ).rejects.toThrow();
      await lastValueFrom(interceptor().intercept(gql('Query', 'me', {}, {}), ok(null)));
      await lastValueFrom(
        interceptor([Role.SYSTEM_ADMIN]).intercept(
          gql('Mutation', 'createCoupon', {}, {}),
          ok(null),
        ),
      );
      expect(recorded).toEqual([
        expect.objectContaining({
          actorType: 'client',
          actorId: 8,
          success: false,
          errorType: '400',
          entityType: 'Appointment',
          entityId: 3,
        }),
      ]);
    });
  });

  it('o worker manda o lote pro Axiom e erro faz tentar de novo', async () => {
    const before = { ...process.env };
    Object.assign(process.env, {
      AXIOM_TOKEN: 't',
      AXIOM_DATASET: 'app',
      AXIOM_URL: 'http://axiom',
    });
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('nope', { status: 500 }));
    try {
      const worker = new AppActivityProcessor();
      const job = { data: { events: [{ operation: 'x' }] } } as never;
      await expect(worker.process(job)).resolves.toBe(1);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://axiom/v1/datasets/app/ingest',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ authorization: 'Bearer t' }),
        }),
      );
      await expect(worker.process(job)).rejects.toThrow('Axiom respondeu 500');
    } finally {
      fetchMock.mockRestore();
      process.env = before;
    }
  });
});
