/**
 * Ficha com dado de saúde (anamnese, teste de alergia) contra o Postgres:
 * sem o consentimento do cliente as respostas não entram; com ele, fica
 * registrado quando e por quem; revogar apaga as respostas.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';
import { allowModulesInTests } from './barbershop-plan.constants';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('Consentimento para dados de saúde (integração)', () => {
  const prisma = new PrismaService();
  const stub = {} as never;
  const service = new BarbershopService(
    prisma,
    stub,
    stub,
    { isConfigured: () => false } as never,
    stub,
    { email: async () => undefined, whatsapp: async () => undefined } as never,
    { notify: () => undefined } as never,
  );
  allowModulesInTests(service, ['packages']);
  let ownerId: number;
  let otherOwnerId: number;
  let networkId: number;
  let shopId: number;
  let customerId: number;
  let otherNetworkCustomerId: number;
  const answers = JSON.stringify({ alergias: 'Amônia', gestante: false });

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = (
      await prisma.user.create({
        data: {
          email: `saude-${RUN}@test.local`,
          password: 'x',
          fullName: 'Dona Saúde',
          idDocNumber: RUN.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'female',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      })
    ).id;
    const premium =
      (await prisma.plan.findFirst({ where: { name: 'Premium' } })) ??
      (await prisma.plan.create({
        data: { name: 'Premium', price: new Decimal(100), billingCycle: 'MONTHLY' },
      }));
    await prisma.subscription.create({
      data: { userId: ownerId, planId: premium.id, status: 'ACTIVE', startSubDate: new Date() },
    });
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede Saúde ${RUN}` } })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: 'Salão Saúde',
          slug: `saude-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `saude-shop-${RUN}@test.local`,
          networkId,
          ownerUserId: ownerId,
        },
      })
    ).id;
    customerId = (
      await prisma.customer.create({ data: { networkId, name: 'Cliente', phone: '11911110000' } })
    ).id;
    // Outra rede tem outro dono (uma rede por dono)
    const otherOwner = await prisma.user.create({
      data: {
        email: `saude-outro-${RUN}@test.local`,
        password: 'x',
        fullName: 'Dono De Fora',
        idDocNumber: `o${RUN}`.slice(-20),
        phone: `+5512${RUN}`.slice(0, 20),
        gender: 'male',
        birthdate: new Date('1990-01-01'),
        readTerms: true,
        roleId,
      },
    });
    otherOwnerId = otherOwner.id;
    const otherNetwork = await prisma.network.create({
      data: { ownerUserId: otherOwner.id, name: `Outra Rede ${RUN}` },
    });
    otherNetworkCustomerId = (
      await prisma.customer.create({
        data: { networkId: otherNetwork.id, name: 'De fora', phone: '11911119999' },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.consentForm.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    const owners = [ownerId, otherOwnerId];
    await prisma.customer.deleteMany({ where: { network: { ownerUserId: { in: owners } } } });
    await prisma.network.deleteMany({ where: { ownerUserId: { in: owners } } });
    await prisma.subscription.deleteMany({ where: { userId: ownerId } });
    await prisma.user.deleteMany({ where: { id: { in: owners } } });
    await prisma.$disconnect();
  });

  it('anamnese com respostas exige o consentimento; com ele, registra quando e quem', async () => {
    await expect(
      service.createConsentForm(ownerId, shopId, { customerId, formType: 'ANAMNESIS', answers }),
    ).rejects.toThrow(BadRequestException);

    const form = await service.createConsentForm(ownerId, shopId, {
      customerId,
      formType: 'ALLERGY_TEST',
      answers,
      healthConsent: true,
    });
    expect(form.answers).toBe(answers);
    expect(form.healthConsentAt).toBeInstanceOf(Date);
    expect(form.healthConsentByUserId).toBe(ownerId);
  });

  it('ficha sem dado de saúde (ou ainda sem respostas) não pede consentimento', async () => {
    const photo = await service.createConsentForm(ownerId, shopId, {
      customerId,
      formType: 'PHOTO_CONSENT',
      answers: JSON.stringify({ usarFotos: true }),
    });
    expect(photo.healthConsentAt).toBeNull();
    const pending = await service.createConsentForm(ownerId, shopId, {
      customerId,
      formType: 'ANAMNESIS',
    });
    expect(pending.answers).toBeNull();
  });

  it('revogar apaga as respostas e guarda quando foi revogado', async () => {
    const form = await service.createConsentForm(ownerId, shopId, {
      customerId,
      formType: 'ANAMNESIS',
      answers,
      healthConsent: true,
    });
    const revoked = await service.revokeHealthConsent(ownerId, shopId, form.id);
    expect(revoked.answers).toBeNull();
    expect(revoked.healthConsentRevokedAt).toBeInstanceOf(Date);
    expect(revoked.healthConsentAt).toEqual(form.healthConsentAt);
  });

  it('não cria ficha para cliente de outra rede', async () => {
    await expect(
      service.createConsentForm(ownerId, shopId, {
        customerId: otherNetworkCustomerId,
        formType: 'GENERAL',
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
