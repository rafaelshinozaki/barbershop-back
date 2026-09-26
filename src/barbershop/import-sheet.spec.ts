import { parseSheet } from './import-sheet';

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
      expect.objectContaining({ name: 'Ana Silva', phoneDigits: '11988887777', email: 'ana@x.com' }),
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

  it('lê serviços pela duração e o preço', () => {
    const parsed = parseSheet('nome,duracao_minutos,preco\nCorte,30,45\n', 'America/Sao_Paulo', NOW);
    expect(parsed.services).toEqual([expect.objectContaining({ name: 'Corte', durationMinutes: 30, price: 45 })]);
  });
});
