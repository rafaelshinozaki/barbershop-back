import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReviewRequestService } from './review-request.service';
import { createReviewToken, createStaffReviewToken } from './appointment-link';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';

const DAY = 86_400_000;

describe('pedido de avaliação pela equipe', () => {
  function shopAppt(over: Record<string, unknown> = {}) {
    const endAt = new Date(Date.now() - DAY);
    return {
      id: 9,
      status: 'COMPLETED',
      endAt,
      startAt: new Date(endAt.getTime() - 30 * 60_000),
      linkVersion: 0,
      contactEmail: null,
      customer: {
        id: 2,
        name: 'Carlos Cliente',
        email: 'c@test.local',
        phone: '11999999999',
        marketingOptOut: false,
        clientAccountId: null,
      },
      barbershop: {
        id: 3,
        name: 'Estrela',
        country: 'BR',
        timezone: 'America/Sao_Paulo',
        ownerUserId: 1,
        practiceKind: 'shop',
      },
      barber: { name: 'Ana', userId: null, professionalId: null },
      services: [],
      sale: { paymentStatus: 'PAID' },
      professionalReview: null,
      ...over,
    };
  }

  function build(appt = shopAppt()) {
    const emails: { to: string; context: { ReviewURL: string } }[] = [];
    const whatsapps: { to: string; message: string }[] = [];
    const reviews: Record<string, unknown>[] = [];
    const proReviews: Record<string, unknown>[] = [];
    const prisma = {
      appointment: { findFirst: async () => appt, findUnique: async () => appt },
      barbershop: {
        findUnique: async () => ({
          closedAt: null,
          platformSuspendedAt: null,
          network: { platformSuspendedAt: null },
        }),
      },
      professionalReview: {
        upsert: async ({ create }: { create: Record<string, unknown> }) => {
          proReviews.push(create);
          return create;
        },
      },
      review: {
        findFirst: async () => null,
        upsert: async ({ create }: { create: Record<string, unknown> }) => {
          reviews.push(create);
          return create;
        },
      },
    };
    const service = Object.create(ReviewRequestService.prototype) as ReviewRequestService;
    Object.assign(service, {
      prisma,
      logger: { error: () => undefined },
      ensureAccess: async () => undefined,
      barbershopService: { ensureAccess: async () => undefined },
      notificationQueue: {
        email: async (job: { to: string; context: { ReviewURL: string } }) => {
          emails.push(job);
        },
        whatsapp: async (job: { to: string; message: string }) => {
          whatsapps.push(job);
        },
      },
      whatsapp: { isConfigured: () => true },
      activity: { reviewPosted: async () => undefined },
    });
    return { service, emails, whatsapps, reviews, proReviews };
  }

  it('manda o link pro e-mail do cliente e não devolve o endereço', async () => {
    const { service, emails } = build();
    await expect(service.staffReviewLink(7, 3, 9)).resolves.toBe(true);
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toBe('c@test.local');
    expect(decodeURIComponent(emails[0].context.ReviewURL)).toContain('.7.');
  });

  it('sem pagamento, sem contato ou depois de 30 dias não envia', async () => {
    const unpaid = build(shopAppt({ sale: null }));
    await expect(unpaid.service.staffReviewLink(7, 3, 9)).rejects.toThrow(
      new BadRequestException('Este atendimento não tem pagamento registrado.'),
    );
    expect(unpaid.emails).toEqual([]);

    const noContact = build(
      shopAppt({
        customer: {
          id: 2,
          name: 'Carlos',
          email: null,
          phone: '0',
          marketingOptOut: false,
          clientAccountId: null,
        },
      }),
    );
    await expect(noContact.service.staffReviewLink(7, 3, 9)).rejects.toThrow(
      new BadRequestException('Este cliente não tem e-mail nem WhatsApp pra receber o pedido.'),
    );

    const old = build(shopAppt({ endAt: new Date(Date.now() - 31 * DAY) }));
    await expect(old.service.staffReviewLink(7, 3, 9)).rejects.toThrow(
      new BadRequestException('Este atendimento já passou do prazo de 30 dias pra avaliar.'),
    );
  });

  it('sem e-mail, manda no WhatsApp do cliente', async () => {
    const { service, emails, whatsapps } = build(
      shopAppt({
        customer: {
          id: 2,
          name: 'Carlos Cliente',
          email: null,
          phone: '11999999999',
          marketingOptOut: false,
          clientAccountId: null,
        },
      }),
    );
    await expect(service.staffReviewLink(7, 3, 9)).resolves.toBe(true);
    expect(emails).toEqual([]);
    expect(whatsapps).toHaveLength(1);
    expect(whatsapps[0].to).toBe('+5511999999999');
    expect(whatsapps[0].message).toContain('/review?t=');
  });

  it('o link da equipe grava quem pediu; o do e-mail grava a origem automática', async () => {
    const staff = build();
    await staff.service.submitReview(createStaffReviewToken(9, 7), { rating: 5, comment: 'Ótimo' });
    expect(staff.reviews[0]).toMatchObject({
      reviewSource: 'STAFF',
      requestedByUserId: 7,
      rating: 5,
    });

    const email = build();
    await email.service.submitReview(createReviewToken(9), {
      rating: 4,
      professionalRating: 5,
    });
    expect(email.reviews[0]).toMatchObject({ reviewSource: 'EMAIL', requestedByUserId: null });
    expect(email.proReviews[0]).toMatchObject({ reviewSource: 'EMAIL', requestedByUserId: null });
  });

  it('o link não aceita avaliação depois de 30 dias', async () => {
    const { service } = build(shopAppt({ endAt: new Date(Date.now() - 31 * DAY) }));
    await expect(service.submitReview(createReviewToken(9), { rating: 5 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
