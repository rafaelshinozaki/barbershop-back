import { matchImportedBarber } from './import.service';

const team = [
  { id: 1, name: 'Ana' },
  { id: 2, name: 'Mariana' },
  { id: 3, name: 'João' },
  { id: 4, name: 'Jorge' },
];

describe('matchImportedBarber', () => {
  it('prefere o nome igual, sem acento e sem maiúscula', () => {
    expect(matchImportedBarber('ANA', team)).toEqual({ id: 1, name: 'Ana' });
    expect(matchImportedBarber('Joao', team)).toEqual({ id: 3, name: 'João' });
  });

  it('não entrega Ana para Mariana quando as duas existem', () => {
    expect(matchImportedBarber('Ana', team)).toEqual({ id: 1, name: 'Ana' });
  });

  it('erro quando "Jo" cabe em mais de um', () => {
    expect(matchImportedBarber('Jo', team)).toBe('ambiguous');
  });

  it('usa "contém" quando só uma pessoa combina', () => {
    expect(matchImportedBarber('Mari', [{ id: 2, name: 'Mariana' }])).toEqual({
      id: 2,
      name: 'Mariana',
    });
  });

  it('sem nome, só atribui se houver um profissional', () => {
    expect(matchImportedBarber(undefined, team)).toBeNull();
    expect(matchImportedBarber('', [{ id: 1, name: 'Ana' }])).toEqual({ id: 1, name: 'Ana' });
  });
});
