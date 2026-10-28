import { BadRequestException, HttpException } from '@nestjs/common';
import { createSupportToken } from '../barbershop/appointment-link';
import { SupportService } from './support.service';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';

const input = {
  name: 'Bruno',
  email: 'outro@ataque.test',
  category: 'booking',
  subject: 'Não consigo remarcar',
  message: 'O botão sumiu.',
  language: 'pt',
};

function build() {
  const sent: string[] = [];
  const pings: number[] = [];
  let ticket: {
    id: number;
    status: string;
    email: string;
    lastActivityAt: Date;
    messages: { side: string; createdAt: Date }[];
  } | null = null;
  const prisma = {
    user: {
      findUnique: async () => ({
        email: 'Dono@Conta.test',
        isActive: true,
        deleted_at: null,
      }),
      findMany: async () => [{ id: 7, userSystemConfig: { language: 'pt' } }],
    },
    clientAccount: {
      findUnique: async () => ({ email: 'Cliente@Conta.test', deletedAt: null }),
    },
    supportTicket: {
      create: async ({ data }: { data: { email: string } }) => {
        ticket = {
          id: 3,
          status: 'open',
          email: data.email,
          lastActivityAt: new Date(),
          messages: [],
        };
        return { id: 3, name: 'Bruno', email: data.email, subject: input.subject, language: 'pt' };
      },
      findUnique: async () => ticket,
      update: async ({ data }: { data: { status: string } }) => {
        if (ticket) ticket = { ...ticket, status: data.status };
        return ticket;
      },
      count: async () => 0,
    },
    userNotification: { createMany: async () => ({ count: 1 }) },
  };
  const support = new SupportService(
    prisma as never,
    {
      sendCustomerEmail: async (
        _u: unknown,
        _t: string,
        _c: unknown,
        _s: unknown,
        _m: string,
        to: string,
      ) => void sent.push(to),
    } as never,
    { notifyUsers: (ids: number[]) => void pings.push(...ids) } as never,
    { sendToUsers: async () => 0 } as never,
  );
  return {
    support,
    sent,
    pings,
    prisma,
    get ticket() {
      return ticket;
    },
  };
}

describe('Fale com a gente: e-mail da conta e aviso agrupado', () => {
  it('equipe e cliente logados usam o e-mail da conta, não o digitado', async () => {
    const staff = build();
    await staff.support.create(input, { userId: 4 });
    expect(staff.sent).toEqual(['dono@conta.test']);

    const client = build();
    await client.support.create(input, { clientAccountId: 9 });
    expect(client.sent).toEqual(['cliente@conta.test']);

    const anon = build();
    await anon.support.create(input);
    expect(anon.sent).toEqual(['outro@ataque.test']);
  });

  it('conta inativa não abre pedido com outro e-mail', async () => {
    const { support, prisma } = build();
    prisma.user.findUnique = async () => ({
      email: 'dono@conta.test',
      isActive: false,
      deleted_at: null,
    });
    await expect(support.create(input, { userId: 4 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('responder de novo enquanto ninguém respondeu não avisa a equipe outra vez', async () => {
    const { support, pings } = build();
    await support.create(input);
    expect(pings).toEqual([7]);

    const token = createSupportToken(3);
    await support.requesterReply(token, 'Mais um detalhe.');
    expect(pings).toEqual([7]);

    const answered = build();
    await answered.support.create(input);
    answered.prisma.supportTicket.findUnique = async () => ({
      id: 3,
      status: 'answered',
      email: 'outro@ataque.test',
      lastActivityAt: new Date(),
      messages: [{ side: 'requester', createdAt: new Date() }],
    });
    await answered.support.requesterReply(token, 'Continua igual.');
    expect(answered.pings).toEqual([7, 7]);
  });

  it('mais de 10 mensagens na hora no mesmo pedido são recusadas', async () => {
    const { support, prisma } = build();
    await support.create(input);
    const messages = Array.from({ length: 10 }, () => ({
      side: 'requester',
      createdAt: new Date(),
    }));
    prisma.supportTicket.findUnique = async () => ({
      id: 3,
      status: 'open',
      email: 'outro@ataque.test',
      lastActivityAt: new Date(),
      messages,
    });
    await expect(support.requesterReply(createSupportToken(3), 'de novo')).rejects.toBeInstanceOf(
      HttpException,
    );
  });
});
