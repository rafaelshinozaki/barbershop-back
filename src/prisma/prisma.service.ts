import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { actorSetting, requestContext } from '../common/request-context';
import { withPoolLimits } from './pool-url';

/**
 * Tabelas com gatilho do histórico de alterações (migração
 * 20261112100000_change_log). Escrita nelas com alguém logado vai numa
 * transação com set_config('app.actor'), pro gatilho saber quem fez.
 */
export const CHANGE_LOG_MODELS = new Set([
  'Barbershop',
  'Network',
  'BarbershopService',
  'BarbershopProduct',
  'Barber',
  'BarberSchedule',
  'BarberTimeOff',
  'BarbershopClosure',
  'Appointment',
  'Customer',
  'Review',
]);

const WRITE_ACTIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);

@Injectable()
export class PrismaService extends PrismaClient {
  constructor() {
    // Teto de conexões (os workers da fila dividem este pool com as requisições)
    const url = withPoolLimits(process.env.DATABASE_URL);
    super(url ? { datasources: { db: { url } } } : undefined);

    const softDeleteModels = ['User', 'Plan'];

    this.$use(async (params, next) => {
      if (!params.model || !softDeleteModels.includes(params.model)) {
        return next(params);
      }

      if (['findUnique', 'findFirst', 'findMany', 'count'].includes(params.action)) {
        if (params.args?.withDeleted) {
          delete params.args.withDeleted;
        } else {
          params.args = params.args || {};
          params.args.where = params.args.where || {};
          params.args.where.deleted_at = null;
        }
        if (params.action === 'findUnique') {
          params.action = 'findFirst';
        }
      }

      if (params.action === 'delete') {
        params.action = 'update';
        params.args.data = { deleted_at: new Date() };
      }

      if (params.action === 'deleteMany') {
        params.action = 'updateMany';
        params.args.data = Object.assign({}, params.args.data, {
          deleted_at: new Date(),
        });
      }

      return next(params);
    });

    // Histórico de alterações: escrita solta (fora de transação) numa tabela
    // acompanhada, com alguém logado, vira transação com o autor. Dentro de
    // transação o autor já foi posto em $transaction (abaixo).
    this.$use(async (params, next) => {
      if (
        params.runInTransaction ||
        !params.model ||
        !CHANGE_LOG_MODELS.has(params.model) ||
        !WRITE_ACTIONS.has(params.action) ||
        !actorSetting(requestContext.get())
      ) {
        return next(params);
      }
      const delegate = params.model.charAt(0).toLowerCase() + params.model.slice(1);
      return this.$transaction((tx) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (tx as any)[delegate][params.action](params.args),
      );
    });
  }

  /**
   * Toda transação de um request com alguém logado começa com o autor em
   * set_config('app.actor', …, true): só vale dentro dela, então não vaza
   * pra outro request que pegar a mesma conexão do pool.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override $transaction(arg: any, options?: any): any {
    const setting = actorSetting(requestContext.get());
    if (!setting) return super.$transaction(arg, options);
    if (typeof arg === 'function') {
      return super.$transaction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (tx: any) => {
          await tx.$executeRaw`SELECT set_config('app.actor', ${setting}, true)`;
          return arg(tx);
        },
        options,
      );
    }
    return super
      .$transaction(
        [this.$executeRaw`SELECT set_config('app.actor', ${setting}, true)`, ...arg],
        options,
      )
      .then((results: unknown[]) => results.slice(1));
  }
}
