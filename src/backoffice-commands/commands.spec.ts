import { parseEmailSend } from './commands';

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
