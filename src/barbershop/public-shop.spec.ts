import { ownerAccountOpen } from './public-shop';

const open = { isActive: true, deleted_at: null };
const closed = { isActive: false, deleted_at: null };

describe('ownerAccountOpen', () => {
  it('aceita o dono da rede ativo quando a unidade não tem dono próprio', () => {
    expect(ownerAccountOpen({ ownerUser: null, network: { ownerUser: open } })).toBe(true);
  });

  it('recusa o dono da rede desativado', () => {
    expect(ownerAccountOpen({ ownerUser: open, network: { ownerUser: closed } })).toBe(false);
  });

  it('recusa o dono da unidade desativado mesmo com a rede ativa', () => {
    expect(ownerAccountOpen({ ownerUser: closed, network: { ownerUser: open } })).toBe(false);
  });

  it('recusa a conta apagada', () => {
    expect(
      ownerAccountOpen({
        ownerUser: null,
        network: { ownerUser: { isActive: true, deleted_at: new Date() } },
      }),
    ).toBe(false);
  });
});
