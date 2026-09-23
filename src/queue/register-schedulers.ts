import { Logger } from '@nestjs/common';
import type { Queue, RepeatOptions } from 'bullmq';
import { SCHEDULED_JOB_OPTIONS } from './queue.constants';

const logger = new Logger('Schedulers');

/**
 * Registra as execuções periódicas de uma fila sem travar o boot: com o
 * Redis fora do ar, o upsert do BullMQ espera a conexão indefinidamente e o
 * back nunca terminava de subir (nem a API, que não depende disso). Assim a
 * API sobe e os agendadores se registram quando o Redis voltar.
 */
export function registerSchedulers(
  queue: Queue,
  schedulers: Array<{ id: string; repeat: Omit<RepeatOptions, 'key'> }>,
) {
  void Promise.all(
    schedulers.map(({ id, repeat }) =>
      queue.upsertJobScheduler(id, repeat, { name: id, opts: SCHEDULED_JOB_OPTIONS }),
    ),
  ).catch((err) =>
    logger.error(`Falha ao registrar agendamentos da fila ${queue.name}: ${err.message}`),
  );
}
