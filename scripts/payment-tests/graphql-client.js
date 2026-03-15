/**
 * Cliente GraphQL para Testes
 * Wrapper para executar queries e mutations GraphQL
 */

const axios = require('axios');

class GraphQLClient {
  constructor(baseURL, authModule) {
    this.baseURL = baseURL;
    this.authModule = authModule;
    this.endpoint = `${baseURL}/graphql`;
  }

  async query(queryString, variables = {}) {
    if (!this.authModule.isAuthenticated()) {
      throw new Error('Cliente não autenticado');
    }

    const payload = {
      query: queryString,
      variables: variables
    };

    try {
      const response = await this.authModule.getClient().post('/graphql', payload);

      if (response.data.errors) {
        throw new Error(`GraphQL Error: ${response.data.errors.map(e => e.message).join(', ')}`);
      }

      return response.data.data;

    } catch (error) {
      if (error.response?.data?.errors) {
        throw new Error(`GraphQL Error: ${error.response.data.errors.map(e => e.message).join(', ')}`);
      }
      throw error;
    }
  }

  async mutation(mutationString, variables = {}) {
    return this.query(mutationString, variables);
  }

  // Queries específicas para pagamentos
  async getPlans() {
    const query = `
      query GetAllPlans {
        allPlans {
          id
          name
          description
          price
          billingCycle
          features
          stripePriceId
        }
      }
    `;

    return this.query(query);
  }

  async getMyPayments() {
    const query = `
      query GetMyPayments {
        myPayments {
          id
          subscriptionId
          amount
          paymentDate
          nextPaymentDate
          paymentMethod
          transactionId
          status
          createdAt
          updatedAt
        }
      }
    `;

    return this.query(query);
  }

  async getMySubscriptions() {
    const query = `
      query GetMySubscriptions {
        mySubscriptions {
          id
          userId
          planId
          status
          startSubDate
          cancelationDate
          createdAt
          updatedAt
          plan {
            id
            name
            price
            description
            billingCycle
          }
          payments {
            id
            amount
            status
            paymentDate
            nextPaymentDate
          }
        }
      }
    `;

    return this.query(query);
  }

  async createPaymentIntent(planId) {
    const mutation = `
      mutation CreatePaymentIntent($planId: Int!) {
        createPaymentIntent(planId: $planId) {
          clientSecret
          paymentIntentId
        }
      }
    `;

    return this.mutation(mutation, { planId });
  }

  async confirmPaymentIntent(paymentIntentId) {
    const mutation = `
      mutation ConfirmPaymentIntent($paymentIntentId: String!) {
        confirmPaymentIntent(paymentIntentId: $paymentIntentId) {
          success
          subscription {
            id
            status
            plan {
              id
              name
              price
            }
          }
        }
      }
    `;

    return this.mutation(mutation, { paymentIntentId });
  }

  async getMyPaymentMethods() {
    const query = `
      query GetMyPaymentMethods {
        myPaymentMethods {
          id
          type
          card {
            brand
            last4
            expMonth
            expYear
          }
        }
      }
    `;

    return this.query(query);
  }

  async createSetupIntent() {
    const mutation = `
      mutation CreateSetupIntent {
        createSetupIntent {
          id
          client_secret
        }
      }
    `;

    return this.mutation(mutation);
  }

  async getOverduePayments() {
    const query = `
      query GetOverduePayments {
        overduePayments {
          id
          subscriptionId
          amount
          paymentDate
          nextPaymentDate
          paymentMethod
          transactionId
          status
          createdAt
          updatedAt
          daysOverdue
        }
      }
    `;

    return this.query(query);
  }

  async getRecurringPaymentsStats() {
    const query = `
      query GetRecurringPaymentsStats {
        recurringPaymentsStats {
          overdueCount
          upcomingCount
          lastCheck
          timezone
          nextScheduledRun
          overduePayments {
            id
            planName
            amount
            nextPaymentDate
            daysOverdue
          }
          upcomingPayments {
            id
            planName
            amount
            nextPaymentDate
            daysUntilPayment
          }
        }
      }
    `;

    return this.query(query);
  }

  async processRecurringPayment(paymentId) {
    const mutation = `
      mutation ProcessRecurringPayment($paymentId: Int!) {
        processRecurringPayment(paymentId: $paymentId) {
          success
          message
          processedAt
        }
      }
    `;

    return this.mutation(mutation, { paymentId });
  }

  async processAllRecurringPayments() {
    const mutation = `
      mutation ProcessAllRecurringPayments {
        processAllRecurringPayments {
          success
          message
          processedAt
          processedCount
        }
      }
    `;

    return this.mutation(mutation);
  }

  async getMyCoupons() {
    const query = `
      query GetMyCoupons {
        myCoupons {
          id
          code
          name
          description
          type
          value
          maxUses
          usedCount
          isActive
          validFrom
          validUntil
        }
      }
    `;

    return this.query(query);
  }

  async validateCoupon(code, planId, amount) {
    const mutation = `
      mutation ValidateCoupon($code: String!, $planId: Float!, $amount: Float!) {
        validateCoupon(code: $code, planId: $planId, amount: $amount) {
          isValid
          error
          coupon {
            id
            code
            name
            type
            value
          }
          discountAmount
          originalAmount
        }
      }
    `;

    return this.mutation(mutation, { code, planId, amount });
  }

  async applyCoupon(code, paymentId) {
    const mutation = `
      mutation ApplyCoupon($code: String!, $paymentId: Float!) {
        applyCoupon(code: $code, paymentId: $paymentId) {
          isValid
          error
          discountAmount
          finalAmount
        }
      }
    `;

    return this.mutation(mutation, { code, paymentId });
  }
}

module.exports = GraphQLClient;