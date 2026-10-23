import { parseSheet, phoneMatchKey } from './import-sheet';

const NOW = new Date('2026-09-26T15:00:00.000Z');

describe('parseSheet', () => {
  it('lê clientes no formato do Booksy', () => {
    const parsed = parseSheet(
      'First Name,Last Name,Cell Phone,Email\nAna,Silva,11988887777,ana@x.com\n',
      'America/Sao_Paulo',
      NOW,
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.customers).toEqual([
      expect.objectContaining({
        name: 'Ana Silva',
        phoneDigits: '11988887777',
        email: 'ana@x.com',
      }),
    ]);
  });

  it('lê agenda no formato do Trinks, com data brasileira', () => {
    const parsed = parseSheet(
      'Cliente;Telefone;Servico;Duracao;Valor;Data;Hora;Profissional;Status\nJoão;11977776666;Corte;30;45,00;27/09/2026;15:00;Cayo;Confirmado\n',
      'America/Sao_Paulo',
      NOW,
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.appointments).toHaveLength(1);
    expect(parsed.appointments[0]).toMatchObject({
      serviceName: 'Corte',
      durationMinutes: 30,
      price: 45,
      barberName: 'Cayo',
      status: 'CONFIRMED',
      source: 'IMPORT',
    });
    expect(parsed.appointments[0].start.toISOString()).toBe('2026-09-27T18:00:00.000Z');
  });

  it('trata horário passado como histórico e ignora cancelado', () => {
    const parsed = parseSheet(
      'nome,telefone,servico,data,hora,status\nAna,11988887777,Corte,20/09/2026,10:00,concluido\nBia,11988886666,Barba,20/09/2026,11:00,cancelado\n',
      'America/Sao_Paulo',
      NOW,
    );
    expect(parsed.appointments).toHaveLength(1);
    expect(parsed.appointments[0]).toMatchObject({ status: 'COMPLETED', source: 'HISTORY' });
  });

  it('trata telefone com e sem DDI como o mesmo cliente', () => {
    expect(phoneMatchKey('11988887777')).toBe(phoneMatchKey('+55 (11) 98888-7777'));
  });

  it('lê 1.200 como milhar e 1.20 como decimal', () => {
    const parsed = parseSheet(
      'nome,duracao_minutos,preco\nCorte,30,"1.200"\nBarba,20,1.20\nSobrancelha,15,"1.200,50"\n',
      'America/Sao_Paulo',
      NOW,
    );
    expect(parsed.services.map((service) => service.price)).toEqual([1200, 1.2, 1200.5]);
  });

  it('lê 03/04 como dia/mês no Brasil e avisa que a data é ambígua', () => {
    const parsed = parseSheet(
      'nome,telefone,servico,data,hora\nAna,11988887777,Corte,03/04/2026,10:00\n',
      'America/Sao_Paulo',
      NOW,
    );
    expect(parsed.appointments[0].start.toISOString()).toBe('2026-04-03T13:00:00.000Z');
    expect(parsed.errors[0]).toContain('dia/mês');
  });

  it('lê 03/04 como mês/dia nos Estados Unidos', () => {
    const parsed = parseSheet(
      'nome,telefone,servico,data,hora\nAna,11988887777,Corte,03/04/2026,10:00\n',
      'America/New_York',
      NOW,
      'US',
    );
    expect(parsed.appointments[0].start.toISOString()).toBe('2026-03-04T15:00:00.000Z');
    expect(parsed.errors[0]).toContain('mês/dia');
  });

  it('lê serviços pela duração e o preço', () => {
    const parsed = parseSheet(
      'nome,duracao_minutos,preco\nCorte,30,45\n',
      'America/Sao_Paulo',
      NOW,
    );
    expect(parsed.services).toEqual([
      expect.objectContaining({ name: 'Corte', durationMinutes: 30, price: 45 }),
    ]);
  });
  it('horário futuro marcado como "faltou" ou "concluído" entra como marcado (item 260)', () => {
    const parsed = parseSheet(
      'Cliente;Telefone;Servico;Data;Hora;Status\nJoão;11977776666;Corte;27/09/2026;15:00;Faltou\nAna;11977775555;Corte;28/09/2026;15:00;Concluído\nRui;11977774444;Corte;25/09/2026;15:00;Faltou\n',
      'America/Sao_Paulo',
      NOW,
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.appointments.map((a) => a.status)).toEqual(['CONFIRMED', 'CONFIRMED', 'NO_SHOW']);
  });
});
