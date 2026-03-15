// src\payments\payments.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Put,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiCookieAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { Request } from 'express';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { SubscriptionGuard } from '@/auth/guards/subscription.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/auth/roles.decorator';
import { Role } from '@/auth/interfaces/roles';

@ApiTags('payments')
@ApiCookieAuth()
@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Create subscription' })
  @ApiResponse({ status: 201, description: 'Subscription created' })
  @Post()
  newSubscription(@Req() req: Request, @Body() body: any) {
    const userId = (req as any).user.userId;
    return this.paymentsService.newSubscription(userId, body);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get user invoices' })
  @ApiResponse({ status: 200, description: 'List of invoices' })
  @Get()
  getPayments(@Req() req: Request) {
    return this.paymentsService.getInvoices((req as any).user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get latest pending invoice' })
  @ApiResponse({ status: 200, description: 'Latest invoice' })
  @Get('latest')
  getLatestInvoice(@Req() req: Request) {
    return this.paymentsService.getLatestPendingInvoice((req as any).user.userId);
  }

  @UseGuards(JwtAuthGuard, SubscriptionGuard)
  @ApiOperation({ summary: 'Get all subscriptions' })
  @ApiResponse({ status: 200, description: 'Subscriptions list' })
  @Get('subscriptions')
  getAll(@Req() req: Request) {
    return this.paymentsService.getAll((req as any).user.userId);
  }

  @UseGuards(JwtAuthGuard, SubscriptionGuard)
  @ApiOperation({ summary: 'Get invoice by id' })
  @ApiResponse({ status: 200, description: 'Invoice data' })
  @Get(':id')
  getOne(@Param('id') id: string, @Req() req: Request) {
    return this.paymentsService.getOne((req as any).user.userId, +id);
  }

  @UseGuards(JwtAuthGuard, SubscriptionGuard)
  @ApiOperation({ summary: 'Update payment method' })
  @ApiResponse({ status: 200, description: 'Payment method updated' })
  @Put()
  updatePaymentMethod(@Req() req: Request, @Body() body: any) {
    return this.paymentsService.updatePaymentMethod((req as any).user.userId, body.paymentMethodId);
  }

  @UseGuards(JwtAuthGuard, SubscriptionGuard)
  @ApiOperation({ summary: 'Change current plan' })
  @ApiResponse({ status: 200, description: 'Plan changed' })
  @Patch('change-plan')
  changePlan(@Req() req: Request, @Body() body: any) {
    return this.paymentsService.changePlan((req as any).user.userId, body.planId);
  }

  @UseGuards(JwtAuthGuard, SubscriptionGuard)
  @ApiOperation({ summary: 'Cancel subscription' })
  @ApiResponse({ status: 200, description: 'Subscription canceled' })
  @Delete()
  unsubscribe(@Req() req: Request) {
    return this.paymentsService.unsubscribe((req as any).user.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Cancel user subscription' })
  @ApiResponse({ status: 200, description: 'Subscription canceled' })
  @Delete('cancel/:userId')
  cancelUserSubscription(@Param('userId') userId: string) {
    return this.paymentsService.unsubscribe(+userId);
  }

  @UseGuards(JwtAuthGuard, SubscriptionGuard)
  @ApiOperation({ summary: 'Get payment methods' })
  @ApiResponse({ status: 200, description: 'Payment methods list' })
  @Get('payment-methods/list')
  getPaymentMethods(@Req() req: Request) {
    return this.paymentsService.getPaymentMethods((req as any).user.userId);
  }

  @UseGuards(JwtAuthGuard, SubscriptionGuard)
  @ApiOperation({ summary: 'Create setup intent for payment method' })
  @ApiResponse({ status: 200, description: 'Setup intent created' })
  @Post('setup-intent')
  createSetupIntent(@Req() req: Request) {
    return this.paymentsService.createSetupIntent((req as any).user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Test authentication and user data' })
  @ApiResponse({ status: 200, description: 'User data' })
  @Get('test-auth')
  testAuth(@Req() req: Request) {
    const user = (req as any).user;
    return {
      success: true,
      user: {
        userId: user.userId,
        email: user.email,
        authenticated: true,
      },
    };
  }

  @ApiOperation({ summary: 'Test PaymentIntent creation' })
  @ApiResponse({ status: 200, description: 'PaymentIntent test' })
  @Post('test-payment-intent')
  async testPaymentIntent(@Body() body: any) {
    try {
      return await this.paymentsService.testPaymentIntentCreation(body.planId);
    } catch (error) {
      return {
        error: error.message,
        stack: error.stack,
      };
    }
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Test getInvoices with detailed logs' })
  @ApiResponse({ status: 200, description: 'Test result' })
  @Get('test-invoices/:userId')
  async testGetInvoices(@Param('userId') userId: string, @Req() req: Request) {
    this.logger.log(`=== TEST GET INVOICES FOR USER ${userId} ===`);
    this.logger.log(`Authenticated user ID: ${(req as any).user.userId}`);

    try {
      const result = await this.paymentsService.getInvoices(+userId);
      this.logger.log(`Test result: ${JSON.stringify(result)}`);
      return {
        success: true,
        userId: +userId,
        authenticatedUserId: (req as any).user.userId,
        result: result,
      };
    } catch (error) {
      this.logger.error(`Test error: ${error.message}`);
      return {
        success: false,
        userId: +userId,
        authenticatedUserId: (req as any).user.userId,
        error: error.message,
      };
    }
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Create PaymentIntent for checkout' })
  @ApiResponse({ status: 200, description: 'PaymentIntent created' })
  @Post('create-payment-intent')
  async createPaymentIntent(@Req() req: Request, @Body() body: { planId: number }) {
    const userId = (req as any).user.userId;
    return this.paymentsService.createPaymentIntentForCheckout(userId, body.planId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Confirm PaymentIntent' })
  @ApiResponse({ status: 200, description: 'PaymentIntent confirmed' })
  @Post('confirm-payment-intent')
  async confirmPaymentIntent(@Body() body: { paymentIntentId: string }) {
    return this.paymentsService.confirmPaymentIntent(body.paymentIntentId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Delete payment method' })
  @ApiResponse({ status: 200, description: 'Payment method deleted' })
  @Delete('payment-methods/:paymentMethodId')
  async deletePaymentMethod(@Param('paymentMethodId') paymentMethodId: string) {
    return this.paymentsService.deletePaymentMethod(paymentMethodId);
  }

  @Post('recurring/process')
  @ApiOperation({ summary: 'Processar cobranças recorrentes manualmente' })
  @ApiResponse({ status: 200, description: 'Cobranças processadas com sucesso' })
  @ApiResponse({ status: 500, description: 'Erro interno do servidor' })
  async processRecurringPayments() {
    return this.paymentsService.processRecurringPayments();
  }

  @Get('recurring/overdue')
  @ApiOperation({ summary: 'Listar pagamentos vencidos' })
  @ApiResponse({ status: 200, description: 'Lista de pagamentos vencidos' })
  async getOverduePayments() {
    return this.paymentsService.getOverduePayments();
  }

  @Post('recurring/force/:paymentId')
  @ApiOperation({ summary: 'Forçar processamento de um pagamento recorrente específico' })
  @ApiResponse({ status: 200, description: 'Pagamento processado com sucesso' })
  @ApiResponse({ status: 404, description: 'Pagamento não encontrado' })
  async forceRecurringPayment(@Param('paymentId') paymentId: string) {
    return this.paymentsService.forceRecurringPayment(parseInt(paymentId));
  }

  @Get('recurring/stats')
  @ApiOperation({ summary: 'Obter estatísticas de pagamentos recorrentes' })
  @ApiResponse({ status: 200, description: 'Estatísticas dos pagamentos recorrentes' })
  async getRecurringPaymentsStats() {
    return this.paymentsService.getOverduePayments().then((overduePayments) => ({
      overdueCount: overduePayments.length,
      lastCheck: new Date().toISOString(),
      timezone: 'America/Sao_Paulo',
      nextScheduledRun: '09:00 AM (diário)',
      overduePayments: overduePayments.map((payment) => ({
        id: payment.id,
        userId: payment.subscription.user.id,
        userEmail: payment.subscription.user.email,
        userName: payment.subscription.user.fullName,
        planName: payment.subscription.plan.name,
        amount: payment.amount,
        nextPaymentDate: payment.nextPaymentDate,
        daysOverdue: Math.floor(
          (new Date().getTime() - new Date(payment.nextPaymentDate).getTime()) /
            (1000 * 60 * 60 * 24),
        ),
      })),
    }));
  }
}
