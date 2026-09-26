import { SOLO_PRODUCT_LIMIT, SOLO_SERVICE_LIMIT, soloDecision } from './solo';

describe('soloDecision', () => {
  it('deixa marcar enquanto estiver abaixo do teto', () => {
    const decision = soloDecision(12, SOLO_SERVICE_LIMIT, SOLO_SERVICE_LIMIT);
    expect(decision.blocked).toBe(false);
    expect(decision.grace).toBe(false);
    expect(decision.remaining).toBe(18);
    expect(decision.nearLimit).toBe(false);
  });

  it('avisa ao chegar perto do teto', () => {
    expect(soloDecision(24, 0, SOLO_SERVICE_LIMIT).nearLimit).toBe(true);
    expect(soloDecision(29, 0, SOLO_SERVICE_LIMIT).blocked).toBe(false);
  });

  it('tolera o primeiro mês acima do teto', () => {
    const decision = soloDecision(SOLO_SERVICE_LIMIT, 29, SOLO_SERVICE_LIMIT);
    expect(decision.grace).toBe(true);
    expect(decision.blocked).toBe(false);
    expect(decision.remaining).toBe(0);
  });

  it('fecha o que é novo no segundo mês seguido acima do teto', () => {
    const decision = soloDecision(30, 31, SOLO_PRODUCT_LIMIT);
    expect(decision.blocked).toBe(true);
    expect(decision.grace).toBe(false);
  });

  it('reabre a tolerância depois de um mês abaixo do teto', () => {
    const decision = soloDecision(30, 10, SOLO_SERVICE_LIMIT);
    expect(decision.grace).toBe(true);
    expect(decision.blocked).toBe(false);
  });
});
