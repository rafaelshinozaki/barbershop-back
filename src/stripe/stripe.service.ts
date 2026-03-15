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

  async createPaymentIntent(amount: number, currency: string, customerId?: string) {
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

  async createSubscription(customerId: string, priceId: string, metadata?: Record<string, string>) {
    const params: Stripe.SubscriptionCreateParams = {
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
    };

    if (metadata) {
      params.metadata = metadata;
    }

    return await this.stripe.subscriptions.create(params);
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

  async listInvoices(customerId: string, params: Stripe.InvoiceListParams = {}) {
    return await this.stripe.invoices.list({ customer: customerId, ...params });
  }

  async getInvoice(invoiceId: string) {
    return await this.stripe.invoices.retrieve(invoiceId);
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
