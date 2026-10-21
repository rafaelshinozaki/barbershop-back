/**
 * Itens 247 a 249, contra o Postgres de verdade: avaliação ocultada não volta
 * apagando e escrevendo de novo, a consulta do cartão-presente não mostra o
 * contato de quem comprou ao barbeiro, e a lista de espera pela página não
 * usa a ficha de outra pessoa achada só pelo telefone.
 */
import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService, samePublicPerson } from './barbershop.service';
import { addDaysStr, toZonedParts } from '../common/timezone.util';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const TZ = 'America/Sao_Paulo';

describe('Itens 247 a 249 (integração)', () => {
  const prisma = new PrismaService();
  const stub = {} as never;
  const shops = new BarbershopService(
    prisma,
    stub,
    stub,
    { isConfigured: () => false } as never,
    stub,
    { email: async () => undefined, whatsapp: async () => undefined } as never,
    { notify: () => undefined } as never,
  );
  let ownerId: number;
  let managerId: number;
  let receptionId: number;
  let barberUserId: number;
  let networkId: number;
  let shopId: number;
  let barberId: number;
  let serviceId: number;

  const user = async (label: string, roleId: number) =>
    (
      await prisma.user.create({
        data: {
          email: `r247-${label}-${RUN}@test.local`,
          isActive: true,
          password: 'x',
          fullName: `Teste ${label}`,
          idDocNumber: `${RUN}${label}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'other',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      })
    ).id;

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = await user('dona', roleId);
    managerId = await user('gerente', roleId);
    receptionId = await user('recepcao', roleId);
    barberUserId = await user('barbeiro', roleId);
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede 247 ${RUN}` } })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: 'Unidade 247',
          slug: `r247-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `r247-shop-${RUN}@test.local`,
          timezone: TZ,
          networkId,
          ownerUserId: ownerId,
        },
      })
    ).id;
    const staff = [
      { userId: managerId, staffType: 'manager', name: 'Gerente' },
      { userId: receptionId, staffType: 'reception', name: 'Recepção' },
      { userId: barberUserId, staffType: 'barber', name: 'Barbeiro' },
    ];
    for (const [i, s] of staff.entries()) {
      const b = await prisma.barber.create({
        data: { barbershopId: shopId, phone: `1190000000${i}`, ...s },
      });
      if (s.staffType === 'barber') barberId = b.id;
    }
    serviceId = (
      await prisma.barbershopService.create({
        data: { barbershopId: shopId, name: 'Corte', durationMinutes: 30, price: 50 },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.waitlistEntry.deleteMany({ where: { barbershopId: shopId } });
    await prisma.review.deleteMany({ where: { barbershopId: shopId } });
    await prisma.appointment.deleteMany({ where: { barbershopId: shopId } });
    await prisma.giftCard.deleteMany({ where: { networkId } });
    await prisma.sale.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.customer.deleteMany({ where: { networkId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.clientAccount.deleteMany({ where: { email: { endsWith: `-${RUN}@test.local` } } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  it('247: avaliação ocultada não sai do banco ao apagar e não volta ao escrever de novo', async () => {
    const account = await prisma.clientAccount.create({
      data: { email: `r247-cli-${RUN}@test.local`, name: 'Cliente Avalia', password: null },
    });
    const customer = await prisma.customer.create({
      data: {
        networkId,
        name: 'Cliente Avalia',
        phone: '11955554444',
        clientAccountId: account.id,
      },
    });
    const start = new Date(Date.now() - 2 * 86_400_000);
    await prisma.appointment.create({
      data: {
        barbershopId: shopId,
        customerId: customer.id,
        barberId,
        startAt: start,
        endAt: new Date(start.getTime() + 30 * 60_000),
        status: 'COMPLETED',
      },
    });

    const first = await shops.createOrUpdateReview(account.id, shopId, 1, 'Texto abusivo');
    await prisma.review.update({ where: { id: first.id }, data: { hiddenAt: new Date() } });

    await shops.deleteReview(account.id, shopId);
    const kept = await prisma.review.findUniqueOrThrow({ where: { id: first.id } });
    expect(kept.withdrawnAt).not.toBeNull();
    expect(kept.hiddenAt).not.toBeNull();
    expect(await shops.getMyReview(account.id, shopId)).toBeNull();

    // Escreve de novo: a mesma linha, ainda oculta (não volta à página)
    const again = await shops.createOrUpdateReview(account.id, shopId, 1, 'Texto abusivo');
    expect(again.id).toBe(first.id);
    expect(again.hiddenAt).not.toBeNull();
    expect(again.withdrawnAt).toBeNull();
    expect((await shops.getBarbershopReviews(shopId)).map((r) => r.id)).not.toContain(first.id);

    // A que não foi ocultada sai de verdade
    await prisma.review.update({ where: { id: first.id }, data: { hiddenAt: null } });
    await shops.deleteReview(account.id, shopId);
    expect(await prisma.review.findUnique({ where: { id: first.id } })).toBeNull();
  });

  it('248: consulta do cartão-presente sem o contato de quem comprou para o barbeiro; recepção vende na unidade', async () => {
    const card = await shops.createGiftCard(ownerId, networkId, {
      initialValue: 100,
      purchaserName: 'Comprador',
      purchaserPhone: '11988887777',
      purchaserEmail: 'comprador@test.local',
      recipientName: 'Presenteado',
      message: 'Parabéns',
    });

    const byBarber = await shops.lookupGiftCard(barberUserId, shopId, card.code);
    expect(Number(byBarber.remainingValue)).toBe(100);
    expect(byBarber).toMatchObject({
      purchaserName: null,
      purchaserPhone: null,
      purchaserEmail: null,
      recipientName: null,
      message: null,
    });
    const byManager = await shops.lookupGiftCard(managerId, shopId, card.code);
    expect(byManager.purchaserPhone).toBe('11988887777');

    // Recepção vende pela unidade (o valor entra no caixa dela)
    const sold = await shops.createGiftCard(receptionId, networkId, {
      initialValue: 50,
      barbershopId: shopId,
      paymentMethod: 'CASH',
    });
    expect(sold.saleId).not.toBeNull();
    await expect(
      shops.createGiftCard(receptionId, networkId, { initialValue: 50 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      shops.createGiftCard(barberUserId, networkId, {
        initialValue: 50,
        barbershopId: shopId,
        paymentMethod: 'CASH',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // Listar e desativar: gerente e dono
    expect((await shops.getGiftCards(managerId, networkId)).length).toBeGreaterThanOrEqual(2);
    await shops.setGiftCardActive(managerId, networkId, sold.id, false);
    await expect(shops.getGiftCards(receptionId, networkId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('249: lista de espera pela página não usa a ficha de outra pessoa achada pelo telefone', async () => {
    const phone = `11${RUN.slice(-9)}`;
    const victim = await prisma.customer.create({
      data: { networkId, name: 'Maria Vítima', phone },
    });
    const date = addDaysStr(toZonedParts(new Date(), TZ).dateStr, 3);
    const join = (name: string, email: string) =>
      shops.joinPublicWaitlist({
        barbershopId: shopId,
        serviceIds: [serviceId],
        date,
        customerName: name,
        customerPhone: phone,
        customerEmail: email,
      });

    const other = await join('Outra Pessoa', `outra-${RUN}@test.local`);
    const otherEntry = await prisma.waitlistEntry.findUniqueOrThrow({
      where: { id: other.entryId },
    });
    expect(otherEntry.customerId).not.toBe(victim.id);

    // A própria pessoa (mesmo nome, sem acento e com espaço a mais) usa a ficha
    const same = await join('maria  vitima', `maria-${RUN}@test.local`);
    const sameEntry = await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: same.entryId } });
    expect(sameEntry.customerId).toBe(victim.id);
    // E a ficha não ganhou o e-mail digitado
    expect(
      (await prisma.customer.findUniqueOrThrow({ where: { id: victim.id } })).email,
    ).toBeNull();
  });

  it('249: ficha com e-mail só é reaproveitada com o mesmo e-mail', () => {
    const saved = { name: 'Ana', email: 'ana@test.local' };
    expect(samePublicPerson(saved, { name: 'Outra', email: 'ANA@test.local' })).toBe(true);
    expect(samePublicPerson(saved, { name: 'Ana', email: 'outra@test.local' })).toBe(false);
    expect(samePublicPerson({ name: '', email: null }, { name: '', email: 'x@test.local' })).toBe(
      false,
    );
  });
});
