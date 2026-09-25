import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  private stripe: Stripe;
  private readonly logger = new Logger(StripeService.name);

  constructor(private configService: ConfigService) {
    const stripeKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    this.stripe = new Stripe(stripeKey, {
      apiVersion: '2023-10-16',
    });
  }

  async createPaymentIntent(
    amount: number,
    currency: string,
    customerId?: string,
    // 'off_session': guarda o cartão no cliente pra cobrar a renovação
    // sem o cliente presente
    options: {
      setupFutureUsage?: 'off_session';
      metadata?: Record<string, string>;
      description?: string;
    } = {},
  ) {
    this.logger.log(
      `Creating PaymentIntent - Amount: ${amount}, Currency: ${currency}, CustomerId: ${customerId}`,
    );

    const params: Stripe.PaymentIntentCreateParams = {
      amount,
      currency,
      payment_method_types: ['card'],
    };

    if (customerId) {
      params.customer = customerId;
    }
    if (options.setupFutureUsage) {
      params.setup_future_usage = options.setupFutureUsage;
    }
    if (options.metadata) params.metadata = options.metadata;
    if (options.description) params.description = options.description;

    this.logger.log(`PaymentIntent params:`, JSON.stringify(params, null, 2));

    const paymentIntent = await this.stripe.paymentIntents.create(params);

    this.logger.log(
      `PaymentIntent created - ID: ${
        paymentIntent.id
      }, Client Secret: ${paymentIntent.client_secret?.substring(0, 20)}...`,
    );

    return paymentIntent;
  }

  async retrievePaymentIntent(id: string) {
    return await this.stripe.paymentIntents.retrieve(id);
  }

  async createCustomer(email: string, name?: string, metadata?: Record<string, string>) {
    const params: Stripe.CustomerCreateParams = {
      email,
      metadata,
    };

    if (name) {
      params.name = name;
    }

    return await this.stripe.customers.create(params);
  }

  async getCustomer(customerId: string) {
    return await this.stripe.customers.retrieve(customerId);
  }

  async updateCustomer(customerId: string, data: Stripe.CustomerUpdateParams) {
    return await this.stripe.customers.update(customerId, data);
  }

  async createProduct(name: string, description?: string) {
    return await this.stripe.products.create({
      name,
      description,
    });
  }

  async createPrice(
    productId: string,
    unitAmount: number,
    currency: string,
    recurring?: Stripe.PriceCreateParams.Recurring,
  ) {
    const params: Stripe.PriceCreateParams = {
      product: productId,
      unit_amount: unitAmount,
      currency,
    };

    if (recurring) {
      params.recurring = recurring;
    }

    return await this.stripe.prices.create(params);
  }

  async createSubscription(
    customerId: string,
    priceId: string,
    metadata?: Record<string, string>,
    // Mesma chave = o Stripe devolve a mesma assinatura em vez de criar outra
    idempotencyKey?: string,
    extra?: Partial<Stripe.SubscriptionCreateParams>,
  ) {
    const params: Stripe.SubscriptionCreateParams = {
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
      ...extra,
    };

    if (metadata) {
      params.metadata = metadata;
    }

    return await this.stripe.subscriptions.create(
      params,
      idempotencyKey ? { idempotencyKey } : undefined,
    );
  }

  async getSubscription(subscriptionId: string) {
    return await this.stripe.subscriptions.retrieve(subscriptionId);
  }

  async updateSubscription(subscriptionId: string, data: Stripe.SubscriptionUpdateParams) {
    return await this.stripe.subscriptions.update(subscriptionId, data);
  }

  async cancelSubscription(subscriptionId: string) {
    return await this.stripe.subscriptions.cancel(subscriptionId);
  }

  async retrievePaymentMethod(paymentMethodId: string) {
    return await this.stripe.paymentMethods.retrieve(paymentMethodId);
  }

  /** Tenta de novo, na hora, a fatura em aberto (ex.: depois de trocar o cartão). */
  async payInvoice(invoiceId: string, paymentMethodId?: string) {
    return await this.stripe.invoices.pay(
      invoiceId,
      paymentMethodId ? { payment_method: paymentMethodId } : {},
    );
  }

  /**
   * Cobra o cartão salvo sem o cliente presente (renovação do plano). A
   * idempotencyKey faz o Stripe devolver a MESMA cobrança se a chamada for
   * repetida (queda de rede, duas execuções) em vez de cobrar de novo.
   */
  async chargeOffSession(params: {
    amount: number;
    currency: string;
    customerId: string;
    paymentMethodId: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }) {
    return await this.stripe.paymentIntents.create(
      {
        amount: params.amount,
        currency: params.currency,
        customer: params.customerId,
        payment_method: params.paymentMethodId,
        off_session: true,
        confirm: true,
        metadata: params.metadata,
      },
      { idempotencyKey: params.idempotencyKey },
    );
  }

  /**
   * Cobrança de renovação já criada no Stripe com essa chave (a busca do
   * Stripe tem alguns segundos de atraso — só usar em pendências antigas).
   */
  async findPaymentIntentByRenewalKey(renewalKey: string): Promise<Stripe.PaymentIntent | null> {
    const result = await this.stripe.paymentIntents.search({
      query: `metadata['renewalKey']:'${renewalKey.replace(/'/g, "\\'")}'`,
      limit: 1,
    });
    return result.data[0] ?? null;
  }

  /** Cartão padrão do cliente (ou o primeiro salvo); null se não tiver. */
  async getDefaultPaymentMethodId(customerId: string): Promise<string | null> {
    const retrieved = await this.stripe.customers.retrieve(customerId);
    if (retrieved.deleted) return null;
    const def = (retrieved as Stripe.Customer).invoice_settings?.default_payment_method;
    if (def) return typeof def === 'string' ? def : def.id;
    const cards = await this.stripe.paymentMethods.list({ customer: customerId, type: 'card' });
    return cards.data[0]?.id ?? null;
  }

  /** Apaga o cliente no Stripe (e os cartões salvos dele) — exclusão de conta. */
  async deleteCustomer(customerId: string) {
    return await this.stripe.customers.del(customerId);
  }

  async listInvoices(customerId: string, params: Stripe.InvoiceListParams = {}) {
    return await this.stripe.invoices.list({ customer: customerId, ...params });
  }

  async getInvoice(invoiceId: string) {
    return await this.stripe.invoices.retrieve(invoiceId);
  }

  async retrieveSetupIntent(setupIntentId: string) {
    return await this.stripe.setupIntents.retrieve(setupIntentId);
  }

  async createSetupIntent(customerId: string) {
    return await this.stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
    });
  }

  async listPaymentMethods(customerId: string, type: Stripe.PaymentMethodListParams.Type = 'card') {
    return await this.stripe.paymentMethods.list({
      customer: customerId,
      type,
    });
  }

  async attachPaymentMethod(paymentMethodId: string, customerId: string) {
    return await this.stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });
  }

  async detachPaymentMethod(paymentMethodId: string) {
    return await this.stripe.paymentMethods.detach(paymentMethodId);
  }

  async setDefaultPaymentMethod(customerId: string, paymentMethodId: string) {
    return await this.stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });
  }

  async createRefund(
    paymentIntentId: string,
    amount?: number,
    reason?: Stripe.RefundCreateParams.Reason,
  ) {
    const params: Stripe.RefundCreateParams = {
      payment_intent: paymentIntentId,
    };

    if (amount) {
      params.amount = amount;
    }

    if (reason) {
      params.reason = reason;
    }

    return await this.stripe.refunds.create(params);
  }

  async cancelPaymentIntent(paymentIntentId: string) {
    return await this.stripe.paymentIntents.cancel(paymentIntentId);
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.stripe.balance.retrieve();
      return true;
    } catch (error) {
      this.logger.error('Stripe is not available', error);
      return false;
    }
  }

  async handleWebhookEvent(
    payload: string,
    signature: string,
    webhookSecret: string,
  ): Promise<Stripe.Event> {
    try {
      return this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (error) {
      this.logger.error('Webhook signature verification failed', error);
      throw error;
    }
  }

  async updatePaymentIntent(paymentIntentId: string, data: Stripe.PaymentIntentUpdateParams) {
    return await this.stripe.paymentIntents.update(paymentIntentId, data);
  }

  async confirmPaymentIntent(paymentIntentId: string) {
    if (!paymentIntentId || paymentIntentId.trim() === '') {
      throw new Error('PaymentIntent ID is required and cannot be empty');
    }

    try {
      const result = await this.stripe.paymentIntents.confirm(paymentIntentId);
      return result;
    } catch (error) {
      this.logger.error('Error confirming PaymentIntent:', error);
      throw error;
    }
  }
}
