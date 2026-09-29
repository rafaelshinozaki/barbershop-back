import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { withPoolLimits } from './pool-url';

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
  }
}
