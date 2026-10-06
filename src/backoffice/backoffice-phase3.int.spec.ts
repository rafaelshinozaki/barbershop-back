/**
 * Fase 3 do backoffice contra o Postgres de verdade: pedido de confirmação
 * de ação sem volta (outro Administrador aprova, a ação roda; recusa com
 * nota; quem pediu não aprova; falha fica registrada) e os pedidos do
 * titular (LGPD) com prazo de 15 dias e resposta obrigatória ao encerrar.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalService, refundApprovalLimit } from './approval.service';
import { PrivacyRequestService, PRIVACY_DEADLINE_DAYS } from './privacy-request.service';
import { staffActor, type StaffActor } from './actor';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('Backoffice fase 3 (integração)', () => {
  const prisma = new PrismaService();
  const executed: string[] = [];
  const accounts = {
    deleteByStaff: async (userId: number) => {
      if (userId === 666) throw new Error('conta com pendência');
      executed.push(`delete:${userId}`);
    },
  };
  const payments = {
    refund: async (kind: string, id: number, amount: number | null) => {
      executed.push(`refund:${kind}:${id}:${amount}`);
      return true;
    },
  };
  const backoffice = {
    sendEmailNotification: async (input: { userIds: number[] }) => {
      executed.push(`email:${input.userIds.length}`);
      return true;
    },
  };
  const approvals = new ApprovalService(
    prisma,
    accounts as never,
    payments as never,
    backoffice as never,
  );
  const privacy = new PrivacyRequestService(prisma);

  const coord: StaffActor = {
    id: 1_000_000_101,
    email: `coord-${RUN}@eq.test`,
    role: 'coordinator',
    admin: false,
  };
  const admin1: StaffActor = {
    id: 1_000_000_102,
    email: `adm1-${RUN}@eq.test`,
    role: 'admin',
    admin: true,
  };
  const admin2: StaffActor = {
    id: 1_000_000_103,
    email: `adm2-${RUN}@eq.test`,
    role: 'super_admin',
    admin: true,
  };
  const emails = [coord.email, admin1.email, admin2.email];

  afterAll(async () => {
    await prisma.backofficeApproval.deleteMany({ where: { requestedByEmail: { in: emails } } });
    await prisma.privacyRequest.deleteMany({ where: { requesterEmail: { contains: RUN } } });
    await prisma.$disconnect();
  });

  it('quem age: cargo da equipe assinada ou o papel antigo; Administrador = SystemAdmin', () => {
    expect(
      staffActor({
        id: 5,
        email: 'a@b.c',
        role: { name: 'SystemAdmin' },
        staff: { role: 'admin' },
      } as never),
    ).toEqual({ id: 5, email: 'a@b.c', role: 'admin', admin: true });
    expect(
      staffActor({ id: 6, email: 'x@y.z', role: { name: 'SystemManager' } } as never),
    ).toMatchObject({
      role: 'SystemManager',
      admin: false,
    });
  });

  it('limite do estorno sem confirmação: padrão R$ 500, configurável', () => {
    expect(refundApprovalLimit({})).toBe(500);
    expect(refundApprovalLimit({ BACKOFFICE_REFUND_APPROVAL_LIMIT: '1200' })).toBe(1200);
    expect(refundApprovalLimit({ BACKOFFICE_REFUND_APPROVAL_LIMIT: 'abc' })).toBe(500);
  });

  it('pedido → outro Administrador aprova → a ação roda; quem pediu não aprova', async () => {
    const out = await approvals.request(
      'user.delete',
      { userId: 4242 },
      'Apagar a conta #4242',
      'titular pediu por e-mail',
      coord,
    );
    expect(out).toMatchObject({ done: false, approvalId: expect.any(Number) });
    const id = out.approvalId!;
    // O pedido não roda nada antes da confirmação
    expect(executed).toEqual([]);

    // A equipe só vê os próprios; o Administrador vê todos e o selo conta
    expect((await approvals.list(coord)).map((r) => r.id)).toContain(id);
    expect(await approvals.pendingCount(coord)).toBe(0);
    expect(await approvals.pendingCount(admin1)).toBeGreaterThanOrEqual(1);

    await expect(approvals.decide(id, true, null, coord)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const selfAdmin = await approvals.request(
      'payment.refund',
      { kind: 'prepaid', id: 1, amount: 900, reason: 'x' },
      's',
      'motivo grande',
      admin1,
    );
    await expect(approvals.decide(selfAdmin.approvalId!, true, null, admin1)).rejects.toThrow(
      /Quem pediu não confirma/,
    );

    const done = await approvals.decide(id, true, 'conferido', admin1);
    expect(done).toMatchObject({
      status: 'executed',
      decidedByEmail: admin1.email,
      decisionNote: 'conferido',
    });
    expect(executed).toEqual(['delete:4242']);
    await expect(approvals.decide(id, true, null, admin2)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    // O outro admin confirma o estorno do primeiro
    await approvals.decide(selfAdmin.approvalId!, true, null, admin2);
    expect(executed).toEqual(['delete:4242', 'refund:prepaid:1:900']);
  });

  it('recusa com nota não roda nada; ação que falha fica como falha com o erro', async () => {
    const mass = await approvals.request(
      'email.mass',
      { userIds: Array.from({ length: 1500 }, (_, i) => i + 1), subject: 'Oi', message: 'Olá' },
      'E-mail para 1500 pessoas',
      'campanha de outubro',
      coord,
    );
    const rejected = await approvals.decide(
      mass.approvalId!,
      false,
      'público grande demais',
      admin1,
    );
    expect(rejected).toMatchObject({ status: 'rejected', decisionNote: 'público grande demais' });
    expect(executed).not.toContain('email:1500');

    const failing = await approvals.request(
      'user.delete',
      { userId: 666 },
      'Apagar #666',
      'pedido do titular',
      coord,
    );
    const failed = await approvals.decide(failing.approvalId!, true, null, admin1);
    expect(failed).toMatchObject({ status: 'failed', error: 'conta com pendência' });

    await expect(approvals.request('user.delete', { userId: 1 }, 's', 'x', coord)).rejects.toThrow(
      /motivo/,
    );
  });

  it('LGPD: prazo de 15 dias, atrasados no filtro, encerrar exige a resposta', async () => {
    const now = new Date('2026-10-06T12:00:00Z');
    const req = await privacy.create(
      {
        kind: 'access',
        channel: 'email',
        requesterName: 'Titular',
        requesterEmail: ` Titular-${RUN}@Mail.test `,
        details: 'Quero saber quais dados vocês têm sobre mim',
      },
      coord,
      now,
    );
    expect(req).toMatchObject({
      status: 'open',
      requesterEmail: `titular-${RUN}@mail.test`,
      createdByEmail: coord.email,
      userId: null,
    });
    expect(req.dueAt.getTime() - now.getTime()).toBe(PRIVACY_DEADLINE_DAYS * 86_400_000);
    await expect(
      privacy.create({ ...req, kind: 'outro', details: 'x', requesterName: 'T' } as never, coord),
    ).rejects.toThrow(/Tipo/);

    // Vencido aparece no filtro de atrasados
    const later = new Date(now.getTime() + 16 * 86_400_000);
    expect((await privacy.list({ overdue: true }, later)).map((r) => r.id)).toContain(req.id);

    await privacy.update(req.id, { status: 'in_progress' }, coord);
    await expect(privacy.update(req.id, { status: 'done' }, coord)).rejects.toThrow(/resposta/);
    const done = await privacy.update(
      req.id,
      { status: 'done', response: 'Enviamos o relatório por e-mail em 07/10' },
      coord,
    );
    expect(done).toMatchObject({ status: 'done', resolvedByEmail: coord.email });
    expect(done.resolvedAt).not.toBeNull();
    await expect(privacy.update(req.id, { status: 'open' }, coord)).rejects.toThrow(/encerrado/);
    expect((await privacy.list({ overdue: true }, later)).map((r) => r.id)).not.toContain(req.id);
  });
});
