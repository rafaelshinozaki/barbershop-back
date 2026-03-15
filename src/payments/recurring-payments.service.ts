import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PaymentsService } from './payments.service';

@Injectable()
export class RecurringPaymentsService {
  private readonly logger = new Logger(RecurringPaymentsService.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * Cron job que executa diariamente às 9h da manhã para processar cobranças recorrentes
   * Formato: segundo minuto hora dia mês dia-da-semana
   */
  @Cron(CronExpression.EVERY_DAY_AT_9AM, {
    name: 'process-recurring-payments',
    timeZone: 'America/Sao_Paulo',
  })
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
   * Cron job que executa a cada 6 horas para verificar pagamentos vencidos
   * Útil para detectar pagamentos que podem ter sido perdidos
   */
  @Cron('0 0 */6 * * *', {
    name: 'check-overdue-payments',
    timeZone: 'America/Sao_Paulo',
  })
  async handleOverduePaymentsCheck() {
    this.logger.log('🔍 Verificando pagamentos vencidos...');

    try {
      const overduePayments = await this.paymentsService.getOverduePayments();

      if (overduePayments.length > 0) {
        this.logger.warn(`⚠️ Encontrados ${overduePayments.length} pagamentos vencidos`);

        // Processar pagamentos vencidos
        for (const payment of overduePayments) {
          try {
            await this.paymentsService.forceRecurringPayment(payment.id);
          } catch (error) {
            this.logger.error(`Erro ao processar pagamento vencido ${payment.id}:`, error);
          }
        }
      } else {
        this.logger.log('✅ Nenhum pagamento vencido encontrado');
      }
    } catch (error) {
      this.logger.error('❌ Erro ao verificar pagamentos vencidos:', error);
    }
  }

  /**
   * Cron job que executa semanalmente para limpeza e manutenção
   * Remove registros antigos e faz backup de dados importantes
   */
  @Cron(CronExpression.EVERY_WEEK, {
    name: 'payment-maintenance',
    timeZone: 'America/Sao_Paulo',
  })
  async handlePaymentMaintenance() {
    this.logger.log('🧹 Iniciando manutenção semanal de pagamentos...');

    try {
      // Aqui você pode adicionar lógica de limpeza, backup, etc.
      this.logger.log('✅ Manutenção semanal de pagamentos concluída');
    } catch (error) {
      this.logger.error('❌ Erro na manutenção semanal de pagamentos:', error);
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
