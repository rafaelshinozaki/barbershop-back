import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CareerService } from './career.service';
import { ProfessionalReviewService } from './professional-review.service';

const RUN = `${Date.now()}`.slice(-9);
const HOUR = 3_600_000;

/**
 * Avaliação do profissional: soma as unidades da conta na página /p/:slug,
 * respeita "mostrar nota" e "mostrar avaliações", some com a ocultada pela
 * moderação e só o próprio profissional responde.
 */
describe('Avaliação do profissional (integração)', () => {
  const prisma = new PrismaService();
  const reviews = new ProfessionalReviewService(prisma);
  const career = new CareerService(prisma, reviews);

  let roleId: number;
  let networkId: number;
  let proUserId: number;
  let otherUserId: number;
  let professionalId: number;
  const shopIds: number[] = [];
  const barberIds: number[] = [];
  let customerId: number;
  let n = 0;

  const user = (label: string) =>
    prisma.user.create({
      data: {
        email: `pr-${label}-${RUN}@test.local`,
        password: 'x',
        fullName: label === 'pro' ? 'Bruna Profissional' : 'Outra Pessoa',
        idDocNumber: `${RUN}${label}`.slice(-20),
        phone: `+55119${RUN}${label.length}`.slice(0, 20),
        gender: 'female',
        birthdate: new Date('1990-01-01'),
        readTerms: true,
        roleId,
      },
    });

  // Atendimento concluído com a avaliação do profissional
  const reviewed = async (barberIndex: number, rating: number, comment: string | null) => {
    const appt = await prisma.appointment.create({
      data: {
        barbershopId: shopIds[barberIndex],
        customerId,
        barberId: barberIds[barberIndex],
        startAt: new Date(Date.now() - (++n + 2) * HOUR),
        endAt: new Date(Date.now() - (n + 1) * HOUR),
        status: 'COMPLETED',
      },
    });
    return prisma.professionalReview.create({
      data: {
        appointmentId: appt.id,
        barberId: barberIds[barberIndex],
        barbershopId: shopIds[barberIndex],
        professionalId,
        customerId,
        rating,
        comment,
      },
    });
  };

  beforeAll(async () => {
    roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopEmployee' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopEmployee' } }))
    ).id;
    proUserId = (await user('pro')).id;
    otherUserId = (await user('outro')).id;
    professionalId = (
      await prisma.professional.create({
        data: { userId: proUserId, slug: `bruna-${RUN}`, visibility: 'public', isPublic: true },
      })
    ).id;
    networkId = (
      await prisma.network.create({ data: { ownerUserId: otherUserId, name: `Rede PR ${RUN}` } })
    ).id;
    for (const label of ['a', 'b']) {
      const shop = await prisma.barbershop.create({
        data: {
          name: `Unidade ${label.toUpperCase()}`,
          slug: `pr-${label}-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `pr-${label}-${RUN}@test.local`,
          networkId,
          ownerUserId: otherUserId,
        },
      });
      shopIds.push(shop.id);
      const barber = await prisma.barber.create({
        data: {
          barbershopId: shop.id,
          name: 'Bruna',
          phone: '11944444444',
          userId: proUserId,
          professionalId,
        },
      });
      barberIds.push(barber.id);
    }
    customerId = (
      await prisma.customer.create({
        data: { networkId, name: 'Carlos Cliente Souza', phone: `8${RUN}` },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.barbershop.deleteMany({ where: { id: { in: shopIds } } });
    await prisma.customer.deleteMany({ where: { networkId } });
    await prisma.network.delete({ where: { id: networkId } });
    await prisma.professional.delete({ where: { id: professionalId } });
    await prisma.user.deleteMany({ where: { id: { in: [proUserId, otherUserId] } } });
    await prisma.$disconnect();
  });

  it('página pública: nota e comentários das duas unidades; a ocultada não conta', async () => {
    await reviewed(0, 5, 'Excelente');
    await reviewed(1, 4, null);
    const hidden = await reviewed(1, 1, 'Ofensa');
    await prisma.professionalReview.update({
      where: { id: hidden.id },
      data: { hiddenAt: new Date() },
    });

    const page = await career.publicProfile(`bruna-${RUN}`);
    expect(page).toMatchObject({ averageRating: 4.5, reviewCount: 2 });
    expect(page.reviews.map((r) => r.rating)).toEqual([4, 5]);
    expect(page.reviews[1]).toMatchObject({
      comment: 'Excelente',
      reviewerName: 'Carlos S.',
      shopName: 'Unidade A',
    });
  });

  it('esconder a nota e as avaliações tira as duas da página', async () => {
    await prisma.professional.update({
      where: { id: professionalId },
      data: { showRating: false, showReviews: false },
    });
    try {
      const page = await career.publicProfile(`bruna-${RUN}`);
      expect(page).toMatchObject({ averageRating: null, reviewCount: null, reviews: [] });
    } finally {
      await prisma.professional.update({
        where: { id: professionalId },
        data: { showRating: true, showReviews: true },
      });
    }
  });

  it('selos: nota alta com 10 avaliações; esconder a nota tira o selo da página; histórico', async () => {
    for (let i = 0; i < 9; i++) await reviewed(i % 2, 5, null);
    let page = await career.publicProfile(`bruna-${RUN}`);
    expect(page.reviewCount).toBe(11);
    expect(page.badges).toContain('top_rated');
    // A carreira mostra os próprios selos
    expect((await career.overview(proUserId)).badges).toContain('top_rated');

    await prisma.professional.update({
      where: { id: professionalId },
      data: { showRating: false },
    });
    try {
      page = await career.publicProfile(`bruna-${RUN}`);
      expect(page.badges).not.toContain('top_rated');
    } finally {
      await prisma.professional.update({
        where: { id: professionalId },
        data: { showRating: true },
      });
    }

    const history = await career.serviceHistory(proUserId);
    expect(history.length).toBeGreaterThanOrEqual(12);
    expect(history[0]).toMatchObject({ customerFirstName: 'Carlos', currency: 'BRL' });
    // A ocultada pela moderação não aparece como nota no histórico
    expect(history.filter((h) => h.rating === 1)).toHaveLength(0);
  });

  it('o profissional vê as dele e responde; outra pessoa não; vazio apaga a resposta', async () => {
    const mine = await reviews.mine(proUserId);
    expect(mine.length).toBeGreaterThanOrEqual(3);
    expect(mine.some((r) => r.hidden)).toBe(true);
    const target = mine.find((r) => r.comment === 'Excelente')!;

    await expect(reviews.reply(otherUserId, target.id, 'Não é minha')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(await reviews.mine(otherUserId)).toEqual([]);

    await reviews.reply(proUserId, target.id, '  Obrigada, volte sempre!  ');
    let page = await career.publicProfile(`bruna-${RUN}`);
    expect(page.reviews.find((r) => r.id === target.id)?.reply).toBe('Obrigada, volte sempre!');

    await reviews.reply(proUserId, target.id, '   ');
    page = await career.publicProfile(`bruna-${RUN}`);
    expect(page.reviews.find((r) => r.id === target.id)).toMatchObject({
      reply: null,
      repliedAt: null,
    });
  });
});
