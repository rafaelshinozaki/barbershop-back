import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { RetentionService } from '../privacy/retention.service';
import { createSupportToken } from '../barbershop/appointment-link';
import { AccountLinkService } from '../client-auth/account-link.service';
import { ClientAuthService } from '../client-auth/client-auth.service';
import { ClientSuspensionService } from '../client-auth/client-suspension.service';
import { SupportService } from './support.service';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const PASSWORD = 'Cliente#Forte9';

/**
 * Suporte humano: pedido pelo "Fale com a gente", acompanhado e respondido
 * pelo link do e-mail; a equipe da plataforma responde pela fila. E a
 * suspensão da conta de cliente pelo admin.
 */
describe('Suporte e suspensão de conta de cliente (integração)', () => {
  const prisma = new PrismaService();
  const sent: Array<{ template: string; to: string; context: Record<string, any> }> = [];
  const email = {
    sendCustomerEmail: async (
      _u: number | null,
      template: string,
      context: Record<string, any>,
      _s: unknown,
      _m: string,
      to: string,
    ) => void sent.push({ template, to, context }),
  };
  const pings: number[] = [];
  const support = new SupportService(
    prisma,
    email as never,
    {
      notifyUsers: (ids: number[]) => void pings.push(...ids),
    } as never,
  );
  const suspension = new ClientSuspensionService(prisma, email as never);
  const jwt = new JwtService({ secret: 'segredo-de-teste' });
  const clients = new ClientAuthService(
    prisma,
    jwt,
    {
      get: (k: string) => ({ JWT_SECRET: 'segredo-de-teste', JWT_EXPIRATION: '3600' }[k]),
    } as never,
    email as never,
    {} as never,
    new AccountLinkService(prisma, email as never),
  );

  let adminId: number;
  const ticketIds: number[] = [];
  let accountId: number;
  const tokenOf = (to: string, template: string) => {
    const m = [...sent].reverse().find((x) => x.to === to && x.template === template);
    return new URL(String(m?.context.TicketURL)).searchParams.get('t')!;
  };

  beforeAll(async () => {
    const role =
      (await prisma.role.findFirst({ where: { name: 'SystemAdmin' } })) ??
      (await prisma.role.create({ data: { name: 'SystemAdmin' } }));
    adminId = (
      await prisma.user.create({
        data: {
          email: `sup-admin-${RUN}@test.local`,
          password: 'x',
          fullName: 'Admin Suporte',
          idDocNumber: `sup${RUN}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'female',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          isActive: true,
          roleId: role.id,
        },
      })
    ).id;
    accountId = (
      await prisma.clientAccount.create({
        data: {
          email: `sup-cliente-${RUN}@test.local`,
          name: 'Carla Cliente',
          password: await bcrypt.hash(PASSWORD, 10),
          emailVerifiedAt: new Date(),
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.supportTicket.deleteMany({
      where: { OR: [{ id: { in: ticketIds } }, { email: { contains: RUN } }] },
    });
    await prisma.userNotification.deleteMany({ where: { userId: adminId } });
    await prisma.clientAccount.deleteMany({ where: { id: accountId } });
    await prisma.user.deleteMany({ where: { id: adminId } });
    await prisma.$disconnect();
  });

  const input = (label: string) => ({
    name: 'Bruno Visitante',
    email: `Sup-${label}-${RUN}@Test.local`,
    category: 'booking',
    subject: 'Não consigo remarcar',
    message: 'O botão de remarcar não aparece.',
    language: 'en',
  });

  it('pedido pelo "Fale com a gente": e-mail com o link e aviso pra equipe da plataforma', async () => {
    await expect(support.create({ ...input('x'), category: 'qualquer' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(support.create({ ...input('x'), email: 'sem-arroba' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(support.create({ ...input('x'), message: '   ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );

    const { id } = await support.create(input('a'), { clientAccountId: accountId });
    ticketIds.push(id);
    const to = `sup-a-${RUN}@test.local`;
    const mail = sent.find((m) => m.to === to && m.template === 'support_received');
    expect(mail?.context).toMatchObject({ TicketId: id, Subject: 'Não consigo remarcar' });
    expect(pings).toContain(adminId);
    const bell = await prisma.userNotification.findFirstOrThrow({ where: { userId: adminId } });
    // Valor do enum do sininho (outro valor quebra a lista)
    expect(bell).toMatchObject({ type: 'info', actionUrl: '/backoffice/support' });

    const queue = await support.queue();
    const item = queue.find((t) => t.id === id);
    expect(item).toMatchObject({
      status: 'open',
      email: to,
      clientAccountId: accountId,
      fromStaff: false,
      messages: [{ side: 'requester', body: 'O botão de remarcar não aparece.' }],
    });
    expect(await support.openCount()).toBeGreaterThanOrEqual(1);
  });

  it('a equipe responde por e-mail; quem pediu responde pelo link e o pedido reabre', async () => {
    const { id } = await support.create(input('b'));
    ticketIds.push(id);
    const to = `sup-b-${RUN}@test.local`;
    const token = tokenOf(to, 'support_received');

    await support.answer(adminId, id, 'Atualize a página e tente de novo.');
    const reply = sent.find((m) => m.to === to && m.template === 'support_reply');
    expect(reply?.context.Reply).toBe('Atualize a página e tente de novo.');
    expect(await support.forRequester(token)).toMatchObject({
      status: 'answered',
      messages: [
        { side: 'requester' },
        { side: 'support', body: 'Atualize a página e tente de novo.' },
      ],
    });

    await support.setStatus(id, 'closed');
    await support.requesterReply(token, 'Ainda não aparece.');
    const after = await support.forRequester(token);
    expect(after.status).toBe('open');
    expect(after.messages).toHaveLength(3);

    // Link de outro pedido ou adulterado não abre
    await expect(
      support.forRequester(`${id}.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(support.forRequester(createSupportToken(999_999_999))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(support.setStatus(id, 'qualquer')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('guarda: o pedido sai 24 meses depois da última atividade', async () => {
    const { id } = await support.create(input('velho'));
    await prisma.supportTicket.update({
      where: { id },
      data: { lastActivityAt: new Date(Date.now() - 800 * 86_400_000) },
    });
    await new RetentionService(prisma).run();
    expect(await prisma.supportTicket.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.supportMessage.count({ where: { ticketId: id } })).toBe(0);
  });

  it('conta suspensa: não entra, sessões caem, e-mail com o motivo; reativada volta', async () => {
    const before = await prisma.clientAccount.findUniqueOrThrow({ where: { id: accountId } });
    const req = {
      cookies: {
        ClientAuthentication: jwt.sign({ clientAccountId: accountId, v: before.sessionVersion }),
      },
    };
    expect(await clients.optionalClientAccountId(req)).toBe(accountId);

    await suspension.setSuspended(adminId, accountId, true, '  Golpe em agendamentos  ');
    await suspension.setSuspended(adminId, accountId, true, 'Golpe em agendamentos'); // de novo: um e-mail só
    const to = `sup-cliente-${RUN}@test.local`;
    expect(sent.filter((m) => m.to === to && m.template === 'account_suspended')).toHaveLength(1);
    expect(sent.find((m) => m.template === 'account_suspended')!.context.Reason).toBe(
      'Golpe em agendamentos',
    );
    expect(await clients.optionalClientAccountId(req)).toBeUndefined();

    // Senha errada continua "inválida" (não conta que existe); certa diz que está suspensa
    await expect(clients.validateCredentials(to, 'Errada#123')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(clients.validateCredentials(to, PASSWORD)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    const found = (await suspension.search(`sup-cliente-${RUN}`))[0];
    expect(found).toMatchObject({
      id: accountId,
      suspendedReason: 'Golpe em agendamentos',
      suspendedAt: expect.any(Date),
      linkedToStaff: false,
    });

    await suspension.setSuspended(adminId, accountId, false);
    expect((await clients.validateCredentials(to, PASSWORD)).id).toBe(accountId);
    expect((await suspension.search(`sup-cliente-${RUN}`))[0].suspendedAt).toBeNull();
    await expect(suspension.setSuspended(adminId, 999_999_999, true)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
