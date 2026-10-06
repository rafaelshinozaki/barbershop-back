import { BackofficeCommandsProcessor } from './backoffice-commands.processor';
import {
  parseAdminNotificationEmail,
  parseClientSuspendedEmail,
  parseEmailSend,
  parseNotificationsCreated,
  parseSupportReplyEmail,
} from './commands';

describe('comando email.send da API do backoffice', () => {
  const ok = {
    to: 'ana@plataforma.test',
    template: 'verification_code',
    lang: 'en',
    subject: { pt: 'Código', en: 'Code', es: 'Código' },
    context: { FullName: 'Ana', VerificationCode: '123456' },
  };

  it('aceita template da lista, com contexto de texto e número', () => {
    expect(parseEmailSend(ok)).toEqual(ok);
    expect(parseEmailSend({ ...ok, lang: 'xx' }).lang).toBe('pt');
  });

  it('recusa template fora da lista, destinatário ou assunto inválidos', () => {
    expect(() => parseEmailSend({ ...ok, template: 'marketing_blast' })).toThrow(/não permitido/);
    expect(() => parseEmailSend({ ...ok, template: '../../etc/passwd' })).toThrow(/não permitido/);
    expect(() => parseEmailSend({ ...ok, to: 'sem-arroba' })).toThrow(/destinatário/);
    expect(() => parseEmailSend({ ...ok, subject: '' })).toThrow(/assunto/);
    expect(() => parseEmailSend(null)).toThrow();
  });

  it('contexto: só chaves simples e valores de texto ou número', () => {
    const cmd = parseEmailSend({
      ...ok,
      context: { FullName: 'Ana', 'bad key': 'x', Obj: { a: 1 }, N: 3, Nan: Number.NaN },
    });
    expect(cmd.context).toEqual({ FullName: 'Ana', N: 3 });
  });
});

describe('comandos de aviso do suporte da API do backoffice', () => {
  it('support.reply_email: pedido e resposta (sem espaço sobrando)', () => {
    expect(parseSupportReplyEmail({ ticketId: 7, reply: '  Olá!  ' })).toEqual({
      ticketId: 7,
      reply: 'Olá!',
    });
    expect(() => parseSupportReplyEmail({ ticketId: 0, reply: 'x' })).toThrow(/pedido/);
    expect(() => parseSupportReplyEmail({ ticketId: '7', reply: 'x' })).toThrow(/pedido/);
    expect(() => parseSupportReplyEmail({ ticketId: 7, reply: '   ' })).toThrow(/resposta/);
    expect(() => parseSupportReplyEmail({ ticketId: 7, reply: 'x'.repeat(5001) })).toThrow(
      /resposta/,
    );
    expect(() => parseSupportReplyEmail(null)).toThrow();
  });

  it('client.suspended_email: só o número da conta', () => {
    expect(parseClientSuspendedEmail({ clientAccountId: 3, extra: 'x' })).toEqual({
      clientAccountId: 3,
    });
    expect(() => parseClientSuspendedEmail({ clientAccountId: -1 })).toThrow(/conta/);
    expect(() => parseClientSuspendedEmail({})).toThrow(/conta/);
  });
});

describe('comandos de avisos e e-mails da API do backoffice', () => {
  it('notifications.created: pessoas (até 1.000) e título', () => {
    expect(parseNotificationsCreated({ userIds: [1, 2], title: 'Oi', x: 1 })).toEqual({
      userIds: [1, 2],
      title: 'Oi',
    });
    expect(() => parseNotificationsCreated({ userIds: [], title: 'Oi' })).toThrow(/pessoas/);
    expect(() => parseNotificationsCreated({ userIds: [0], title: 'Oi' })).toThrow(/pessoas/);
    const many = Array.from({ length: 1001 }, (_, i) => i + 1);
    expect(() => parseNotificationsCreated({ userIds: many, title: 'Oi' })).toThrow(/pessoas/);
    expect(() => parseNotificationsCreated({ userIds: [1], title: ' ' })).toThrow(/título/);
  });

  it('email.admin_notification: assunto e mensagem obrigatórios; o resto, só se vier', () => {
    expect(
      parseAdminNotificationEmail({
        userIds: [1],
        subject: 'Oi',
        message: 'Olá',
        actionUrl: '/x',
        actionText: '',
        type: 'info',
        extra: 'x',
      }),
    ).toEqual({ userIds: [1], subject: 'Oi', message: 'Olá', actionUrl: '/x', type: 'info' });
    expect(() => parseAdminNotificationEmail({ userIds: [1], message: 'Olá' })).toThrow(/assunto/);
    expect(() => parseAdminNotificationEmail({ userIds: [1], subject: 'Oi' })).toThrow(/mensagem/);
    expect(() => parseAdminNotificationEmail({ subject: 'Oi', message: 'Olá' })).toThrow(/pessoas/);
  });
});

describe('processador dos comandos', () => {
  const make = () => {
    const email = { sendCustomerEmail: jest.fn().mockResolvedValue(undefined) };
    const support = { emailReply: jest.fn().mockResolvedValue(undefined) };
    const suspension = { emailSuspended: jest.fn().mockResolvedValue(undefined) };
    const searchCache = { bump: jest.fn().mockResolvedValue(undefined) };
    const pricing = { reload: jest.fn().mockResolvedValue(undefined) };
    const realtime = { notifyUsers: jest.fn() };
    const backoffice = { sendEmailNotification: jest.fn().mockResolvedValue(true) };
    const processor = new BackofficeCommandsProcessor(
      email as never,
      support as never,
      suspension as never,
      searchCache as never,
      pricing as never,
      realtime as never,
      backoffice as never,
    );
    return { processor, email, support, suspension, searchCache, pricing, realtime, backoffice };
  };

  it('manda cada comando pro serviço certo', async () => {
    const { processor, email, support, suspension, searchCache, pricing, realtime, backoffice } =
      make();
    await processor.process({
      name: 'support.reply_email',
      data: { ticketId: 4, reply: 'Oi' },
    } as never);
    expect(support.emailReply).toHaveBeenCalledWith(4, 'Oi');
    await processor.process({
      name: 'client.suspended_email',
      data: { clientAccountId: 9 },
    } as never);
    expect(suspension.emailSuspended).toHaveBeenCalledWith(9);
    await processor.process({ name: 'search.cache_bump', data: {} } as never);
    expect(searchCache.bump).toHaveBeenCalledTimes(1);
    await processor.process({ name: 'pricing.reload', data: {} } as never);
    expect(pricing.reload).toHaveBeenCalledTimes(1);
    await processor.process({
      name: 'notifications.created',
      data: { userIds: [1, 2], title: 'Novidade' },
    } as never);
    expect(realtime.notifyUsers).toHaveBeenCalledWith([1, 2], 'CREATED', 'Novidade');
    await processor.process({
      name: 'email.admin_notification',
      data: { userIds: [3], subject: 'Oi', message: 'Tudo bem?' },
    } as never);
    expect(backoffice.sendEmailNotification).toHaveBeenCalledWith({
      userIds: [3],
      subject: 'Oi',
      message: 'Tudo bem?',
    });
    expect(email.sendCustomerEmail).not.toHaveBeenCalled();
  });

  it('comando desconhecido ou malformado falha (o job aparece como falho)', async () => {
    const { processor, support } = make();
    await expect(processor.process({ name: 'user.delete', data: {} } as never)).rejects.toThrow(
      /desconhecido/,
    );
    await expect(
      processor.process({ name: 'support.reply_email', data: { ticketId: 'x' } } as never),
    ).rejects.toThrow(/pedido/);
    expect(support.emailReply).not.toHaveBeenCalled();
  });
});
