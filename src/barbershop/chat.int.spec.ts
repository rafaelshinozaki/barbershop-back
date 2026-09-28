import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RetentionService } from '../privacy/retention.service';
import { createAppointmentToken } from './appointment-link';
import { BarbershopService } from './barbershop.service';
import { ChatService } from './chat.service';
import { ModerationService } from './moderation.service';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';

const RUN = `${Date.now()}`.slice(-9);
const HOUR = 3_600_000;

/**
 * Chat preso ao atendimento: o cliente fala com a unidade e com o
 * profissional; cada conversa só de quem participa; aviso pro outro lado; a
 * conversa sai 12 meses depois da última mensagem.
 */
describe('Chat do atendimento (integração)', () => {
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
  const emails: Array<{ template: string; to: string; context: Record<string, any> }> = [];
  const queue = { email: async (job: any) => void emails.push(job) };
  const pings: number[] = [];
  const realtime = { notifyUsers: (ids: number[]) => void pings.push(...ids) };
  const moderation = new ModerationService(prisma, {
    getDownloadUrl: async (key: string) => key,
  } as never);
  const pushes: Array<{ to: string; title: string; body: string; url: string }> = [];
  const push = {
    sendToUsers: async (
      ids: number[],
      build: (l: 'pt') => { title: string; body: string; url: string },
    ) => void ids.forEach((id) => pushes.push({ to: `user:${id}`, ...build('pt') })),
    sendToClient: async (
      id: number,
      build: (l: 'pt') => { title: string; body: string; url: string },
    ) => void pushes.push({ to: `client:${id}`, ...build('pt') }),
  };
  const chat = new ChatService(
    prisma,
    shops,
    queue as never,
    realtime as never,
    moderation,
    push as never,
  );

  let roleId: number;
  const userIds: number[] = [];
  let networkId: number;
  const shopIds: number[] = [];
  let ownerId: number;
  let proId: number;
  let deskId: number;
  let otherId: number;
  let accountId: number;
  let otherAccountId: number;
  let apptId: number;
  let soloApptId: number;
  let canceledApptId: number;

  const user = async (label: string) => {
    const u = await prisma.user.create({
      data: {
        email: `chat-${label}-${RUN}@test.local`,
        password: 'x',
        fullName: `Chat ${label}`,
        idDocNumber: `chat${label}${RUN}`.slice(-20),
        phone: `+55114${RUN}`.slice(0, 20),
        gender: 'female',
        birthdate: new Date('1990-01-01'),
        readTerms: true,
        roleId,
      },
    });
    userIds.push(u.id);
    return u.id;
  };
  const shop = async (label: string, practiceKind: string) => {
    const b = await prisma.barbershop.create({
      data: {
        name: `Unidade Chat ${label}`,
        slug: `chat-${label}-${RUN}`,
        address: 'Rua A, 1',
        city: 'SP',
        state: 'SP',
        country: 'BR',
        postalCode: '01000000',
        phone: '11999999999',
        email: `chat-${label}-${RUN}@test.local`,
        networkId,
        ownerUserId: ownerId,
        practiceKind,
      },
    });
    shopIds.push(b.id);
    return b.id;
  };
  const appointment = (
    barbershopId: number,
    barberId: number,
    customerId: number,
    status = 'CONFIRMED',
  ) =>
    prisma.appointment
      .create({
        data: {
          barbershopId,
          barberId,
          customerId,
          startAt: new Date(Date.now() + 24 * HOUR),
          endAt: new Date(Date.now() + 25 * HOUR),
          status,
        },
      })
      .then((a) => a.id);

  beforeAll(async () => {
    roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = await user('dona');
    proId = await user('pro');
    deskId = await user('recepcao');
    otherId = await user('outro');
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede Chat ${RUN}` } })
    ).id;
    const shopId = await shop('a', 'shop');
    const soloId = await shop('solo', 'solo');
    const barber = await prisma.barber.create({
      data: { barbershopId: shopId, name: 'Pro do Chat', phone: '119', userId: proId },
    });
    await prisma.barber.create({
      data: {
        barbershopId: shopId,
        name: 'Recepção',
        phone: '118',
        userId: deskId,
        staffType: 'reception',
      },
    });
    await prisma.barber.create({
      data: { barbershopId: shopId, name: 'Outro Pro', phone: '117', userId: otherId },
    });
    const soloBarber = await prisma.barber.create({
      data: { barbershopId: soloId, name: 'Pro Solo', phone: '116', userId: proId },
    });
    accountId = (
      await prisma.clientAccount.create({
        data: { email: `chat-cliente-${RUN}@test.local`, name: 'Cliente Chat' },
      })
    ).id;
    otherAccountId = (
      await prisma.clientAccount.create({
        data: { email: `chat-outra-${RUN}@test.local`, name: 'Outra' },
      })
    ).id;
    const customer = await prisma.customer.create({
      data: {
        networkId,
        name: 'Carla Cliente',
        phone: `5${RUN}`,
        email: `chat-ficha-${RUN}@test.local`,
        clientAccountId: accountId,
      },
    });
    apptId = await appointment(shopId, barber.id, customer.id);
    soloApptId = await appointment(soloId, soloBarber.id, customer.id);
    canceledApptId = await appointment(shopId, barber.id, customer.id, 'CANCELLED');
  });

  const reportedThreads: number[] = [];

  afterAll(async () => {
    await prisma.contentReport.deleteMany({
      where: { targetType: 'chat_thread', targetId: { in: reportedThreads } },
    });
    await prisma.userNotification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.barbershop.deleteMany({ where: { id: { in: shopIds } } });
    await prisma.customer.deleteMany({ where: { networkId } });
    await prisma.clientAccount.deleteMany({ where: { id: { in: [accountId, otherAccountId] } } });
    await prisma.network.delete({ where: { id: networkId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  const byLink = { side: 'client' as const, manageToken: '' };
  const staff = (userId: number) => ({ side: 'staff' as const, userId });

  it('cliente entra pelo link do e-mail ou pela conta; outra pessoa não', async () => {
    const link = { ...byLink, manageToken: createAppointmentToken(apptId) };
    const threads = await chat.threads(apptId, link);
    expect(threads.map((t) => [t.kind, t.title])).toEqual([
      ['unit', `Unidade Chat a`],
      ['professional', 'Pro do Chat'],
    ]);
    expect(
      (await chat.threads(apptId, { side: 'client', clientAccountId: accountId })).length,
    ).toBe(2);
    await expect(
      chat.threads(apptId, { ...byLink, manageToken: createAppointmentToken(soloApptId) }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      chat.threads(apptId, { side: 'client', clientAccountId: otherAccountId }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('cada conversa só de quem participa; aviso pro outro lado', async () => {
    const link = { ...byLink, manageToken: createAppointmentToken(apptId) };
    await chat.send(apptId, 'unit', 'Tem estacionamento?', link);
    await chat.send(apptId, 'professional', 'Pode ser degradê?', link);

    // Unidade: dona e recepção veem só a da unidade
    expect((await chat.threads(apptId, staff(deskId))).map((t) => t.kind)).toEqual(['unit']);
    expect((await chat.threads(apptId, staff(ownerId))).map((t) => t.kind)).toEqual(['unit']);
    // Profissional do atendimento: só a dele
    const pro = await chat.threads(apptId, staff(proId));
    expect(pro.map((t) => t.kind)).toEqual(['professional']);
    expect(pro[0].messages).toMatchObject([
      { body: 'Pode ser degradê?', side: 'client', mine: false },
    ]);
    // Outro profissional da unidade: nada
    await expect(chat.threads(apptId, staff(otherId))).rejects.toBeInstanceOf(NotFoundException);
    await expect(chat.send(apptId, 'unit', 'Oi', staff(proId))).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    const notified = await prisma.userNotification.findMany({
      where: { userId: { in: userIds }, actionUrl: { startsWith: '/messages' } },
      select: { userId: true, actionUrl: true },
    });
    expect(notified.filter((n) => n.userId === ownerId)).toHaveLength(1);
    expect(notified.filter((n) => n.userId === deskId)).toHaveLength(1);
    expect(notified.filter((n) => n.userId === proId)).toHaveLength(1);
    expect(notified.some((n) => n.userId === otherId)).toBe(false);
    expect(notified[0].actionUrl).toBe(`/messages?appointment=${apptId}`);
    // O tipo é o do enum do sininho (outro valor quebra a lista inteira)
    expect(
      await prisma.userNotification.count({
        where: { userId: { in: userIds }, actionUrl: { startsWith: '/messages' }, type: 'info' },
      }),
    ).toBe(notified.length);
    // Celular da equipe: sem o texto da mensagem
    const staffPush = pushes.filter((p) => p.to === `user:${proId}`);
    expect(staffPush[0]).toMatchObject({ url: `/messages?appointment=${apptId}` });
    expect(JSON.stringify(pushes)).not.toContain('degradê');
  });

  it('equipe responde: e-mail pro cliente sem o texto, no máximo um a cada 30 minutos', async () => {
    const before = emails.length;
    await chat.send(apptId, 'professional', 'Pode sim!', staff(proId), shopIds[0]);
    await chat.send(apptId, 'professional', 'Até amanhã', staff(proId), shopIds[0]);
    const sent = emails.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      template: 'chat_message',
      // A conta de cliente tem prioridade sobre o e-mail da ficha
      to: `chat-cliente-${RUN}@test.local`,
      context: { From: 'Pro do Chat' },
    });
    expect(JSON.stringify(sent[0].context)).not.toContain('Pode sim!');
    // Celular do cliente: a cada mensagem (a tag substitui), sem o texto, abrindo a conversa
    const clientPush = pushes.filter((p) => p.to === `client:${accountId}`);
    expect(clientPush).toHaveLength(2);
    expect(clientPush[0].body).toContain('Pro do Chat');
    expect(clientPush[0].url).toMatch(/\/booking\/manage\?t=.*#chat$/);
    expect(JSON.stringify(clientPush)).not.toContain('Pode sim!');

    // Caixa de entrada do cliente: 2 não lidas na conversa com o profissional
    let inbox = await chat.clientInbox(accountId);
    expect(inbox.find((i) => i.kind === 'professional')).toMatchObject({
      unread: 2,
      lastMessage: 'Até amanhã',
    });
    // Abrir marca como lidas
    await chat.threads(apptId, { side: 'client', clientAccountId: accountId });
    inbox = await chat.clientInbox(accountId);
    expect(inbox.find((i) => i.kind === 'professional')!.unread).toBe(0);

    // Caixa da equipe
    const proInbox = await chat.staffInbox(proId);
    expect(proInbox.map((i) => [i.appointmentId, i.kind])).toContainEqual([apptId, 'professional']);
    expect(proInbox.some((i) => i.kind === 'unit')).toBe(false);
    const deskInbox = await chat.staffInbox(deskId);
    expect(deskInbox.find((i) => i.appointmentId === apptId)).toMatchObject({
      kind: 'unit',
      title: 'Carla Cliente',
      // A recepção já abriu a conversa no teste anterior
      unread: 0,
    });
  });

  it('modo solo: só a conversa com o profissional; cancelado não recebe mensagem', async () => {
    const solo = await chat.threads(soloApptId, staff(proId));
    expect(solo.map((t) => t.kind)).toEqual(['professional']);
    const link = { ...byLink, manageToken: createAppointmentToken(soloApptId) };
    await expect(chat.send(soloApptId, 'unit', 'Oi', link)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    const canceled = await chat.threads(canceledApptId, staff(proId));
    expect(canceled[0].canSend).toBe(false);
    await expect(
      chat.send(canceledApptId, 'professional', 'Oi', staff(proId)),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(chat.send(apptId, 'professional', '   ', staff(proId))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('denúncia: quem participa denuncia, o texto fica guardado e a moderação encerra', async () => {
    const link = { ...byLink, manageToken: createAppointmentToken(apptId) };
    const thread = await prisma.chatThread.findUniqueOrThrow({
      where: { appointmentId_kind: { appointmentId: apptId, kind: 'professional' } },
    });
    reportedThreads.push(thread.id);
    // Quem não participa não denuncia; motivo inválido não passa
    await expect(
      chat.report(apptId, 'professional', { reason: 'spam' }, staff(deskId)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      chat.report(apptId, 'professional', { reason: 'qualquer' }, link),
    ).rejects.toBeInstanceOf(BadRequestException);

    await chat.report(apptId, 'professional', { reason: 'offensive', details: 'Grosseiro' }, link);
    await chat.report(apptId, 'professional', { reason: 'offensive' }, link); // repetida: uma só
    await chat.report(apptId, 'professional', { reason: 'spam' }, staff(proId));
    expect(
      await prisma.contentReport.count({
        where: { targetType: 'chat_thread', targetId: thread.id, status: 'open' },
      }),
    ).toBe(2);
    const [mine] = await chat
      .threads(apptId, link)
      .then((t) => t.filter((x) => x.kind === 'professional'));
    expect(mine).toMatchObject({ reported: true, closed: false, canSend: true });
    expect(
      (
        await prisma.chatThread.findUniqueOrThrow({ where: { id: thread.id } })
      ).retainUntil!.getFullYear(),
    ).toBe(2100);

    const item = (await moderation.queue()).find(
      (i) => i.targetType === 'chat_thread' && i.targetId === thread.id,
    );
    expect(item).toMatchObject({ openReports: 2, hidden: false });
    expect(`${item!.title} ${item!.text}`).toContain('Carla Cliente');

    // Encerrada: continua visível, sem mensagem nova; a guarda volta ao normal
    await moderation.resolve(ownerId, 'chat_thread', thread.id, 'hide');
    const [closed] = await chat
      .threads(apptId, link)
      .then((t) => t.filter((x) => x.kind === 'professional'));
    expect(closed).toMatchObject({ closed: true, canSend: false, reported: false });
    expect(closed.messages.length).toBeGreaterThan(0);
    await expect(chat.send(apptId, 'professional', 'Oi', staff(proId))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await moderation.resolve(ownerId, 'chat_thread', thread.id, 'restore');
    expect((await chat.send(apptId, 'professional', 'Voltou', staff(proId))).body).toBe('Voltou');
  });

  it('cliente bloqueado pela unidade: não manda mensagem nem agenda online', async () => {
    const link = { ...byLink, manageToken: createAppointmentToken(apptId) };
    const customer = await prisma.customer.findFirstOrThrow({ where: { networkId } });
    // Profissional não bloqueia; dona sim
    await expect(
      shops.setCustomerBlocked(proId, shopIds[0], customer.id, true, 'x'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const blocked = await shops.setCustomerBlocked(
      ownerId,
      shopIds[0],
      customer.id,
      true,
      '  Faltas e ofensas  ',
    );
    expect(blocked).toMatchObject({
      blockedAt: expect.any(Date),
      blockedReason: 'Faltas e ofensas',
    });

    const [thread] = await chat.threads(apptId, link);
    expect(thread).toMatchObject({ blocked: true, canSend: false });
    await expect(chat.send(apptId, 'unit', 'Oi', link)).rejects.toBeInstanceOf(ForbiddenException);
    // A equipe ainda responde
    expect((await chat.threads(apptId, staff(deskId)))[0].canSend).toBe(true);

    const book = (extra: {
      customerPhone: string;
      customerEmail?: string;
      clientAccountId?: number;
    }) =>
      shops.createPublicAppointment({
        barbershopId: shopIds[0],
        serviceIds: [],
        startAt: new Date(Date.now() + 48 * HOUR).toISOString(),
        customerName: 'Carla',
        ...extra,
      });
    // Pelo telefone, pelo e-mail (outro telefone) ou pela conta
    await expect(book({ customerPhone: customer.phone })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      book({ customerPhone: '+5511000000000', customerEmail: customer.email!.toUpperCase() }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      book({ customerPhone: '+5511000000001', clientAccountId: accountId }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const unblocked = await shops.setCustomerBlocked(ownerId, shopIds[0], customer.id, false);
    expect(unblocked).toMatchObject({ blockedAt: null, blockedReason: null });
    expect((await chat.threads(apptId, link))[0].canSend).toBe(true);
    await expect(book({ customerPhone: customer.phone })).rejects.not.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('guarda: sai 12 meses depois da última mensagem, salvo se segurada', async () => {
    const old = new Date(Date.now() - 400 * 24 * HOUR);
    const [unit, pro] = await Promise.all(
      ['unit', 'professional'].map((kind) =>
        prisma.chatThread.findUniqueOrThrow({
          where: { appointmentId_kind: { appointmentId: apptId, kind } },
        }),
      ),
    );
    await prisma.chatThread.update({ where: { id: unit.id }, data: { lastMessageAt: old } });
    await prisma.chatThread.update({
      where: { id: pro.id },
      data: { lastMessageAt: old, retainUntil: new Date(Date.now() + 24 * HOUR) },
    });
    await new RetentionService(prisma).run();
    expect(await prisma.chatThread.findUnique({ where: { id: unit.id } })).toBeNull();
    expect(await prisma.chatMessage.count({ where: { threadId: unit.id } })).toBe(0);
    // Segurada (denúncia ou disputa aberta) fica
    expect(await prisma.chatThread.findUnique({ where: { id: pro.id } })).not.toBeNull();
  });
});
