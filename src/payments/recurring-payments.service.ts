import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PaymentsService } from './payments.service';
import { RECURRING_PAYMENTS_QUEUE } from '../queue/queue.constants';
import { registerSchedulers } from '../queue/register-schedulers';

@Injectable()
export class RecurringPaymentsService {
  private readonly logger = new Logger(RecurringPaymentsService.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * Diariamente às 9h (horário de Brasília) — ver RecurringPaymentsScheduler
   */
  async handleRecurringPayments() {
    this.logger.log('🔄 Iniciando cron job de cobranças recorrentes...');

    try {
      await this.paymentsService.processRecurringPayments();
      this.logger.log('✅ Cron job de cobranças recorrentes concluído com sucesso');
    } catch (error) {
      this.logger.error('❌ Erro no cron job de cobranças recorrentes:', error);
    }
  }

  /**
   * A cada 6 horas — ver RecurringPaymentsScheduler
   * Útil para detectar pagamentos que podem ter sido perdidos
   */
  async handleOverduePaymentsCheck() {
    this.logger.log('Verificando pagamentos vencidos...');

    try {
      const overduePayments = await this.paymentsService.getOverduePayments();

      if (overduePayments.length > 0) {
        this.logger.warn(
          `Encontrados ${overduePayments.length} pagamentos vencidos. ` +
            `Stripe subscriptions are billed automatically; review manually if needed.`,
        );
      } else {
        this.logger.log('Nenhum pagamento vencido encontrado');
      }
    } catch (error) {
      this.logger.error('Erro ao verificar pagamentos vencidos:', error);
    }
  }

  /**
   * Método para executar processamento manual de cobranças recorrentes
   * Útil para testes ou execução sob demanda
   */
  async processRecurringPaymentsManually() {
    this.logger.log('🔄 Executando processamento manual de cobranças recorrentes...');

    try {
      await this.paymentsService.processRecurringPayments();
      return { success: true, message: 'Processamento manual concluído com sucesso' };
    } catch (error) {
      this.logger.error('❌ Erro no processamento manual:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Método para obter estatísticas de pagamentos recorrentes
   */
  async getRecurringPaymentsStats() {
    try {
      const overduePayments = await this.paymentsService.getOverduePayments();

      return {
        overdueCount: overduePayments.length,
        lastCheck: new Date().toISOString(),
        timezone: 'America/Sao_Paulo',
      };
    } catch (error) {
      this.logger.error('Erro ao obter estatísticas:', error);
      throw error;
    }
  }
}

// Antes eram @Cron, que rodam em TODAS as instâncias do back: com duas
// réplicas, a cobrança recorrente do dia rodava duas vezes. O agendador do
// BullMQ dispara cada execução uma vez só no cluster.
@Injectable()
export class RecurringPaymentsScheduler implements OnModuleInit {
  constructor(@InjectQueue(RECURRING_PAYMENTS_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    registerSchedulers(this.queue, [
      {
        id: 'process-recurring-payments',
        repeat: { pattern: '0 0 9 * * *', tz: 'America/Sao_Paulo' },
      },
      {
        id: 'check-overdue-payments',
        repeat: { pattern: '0 0 */6 * * *', tz: 'America/Sao_Paulo' },
      },
    ]);
  }
}

@Processor(RECURRING_PAYMENTS_QUEUE)
export class RecurringPaymentsProcessor extends WorkerHost {
  constructor(private readonly recurring: RecurringPaymentsService) {
    super();
  }

  async process(job: Job) {
    if (job.name === 'process-recurring-payments') return this.recurring.handleRecurringPayments();
    if (job.name === 'check-overdue-payments') return this.recurring.handleOverduePaymentsCheck();
  }
}
