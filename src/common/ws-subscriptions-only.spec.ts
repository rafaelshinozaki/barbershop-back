import { rejectNonSubscription } from './ws-subscriptions-only';

describe('WebSocket só leva subscription', () => {
  it('subscription passa', () => {
    expect(rejectNonSubscription('subscription { publicSlotsChanged(barbershopId: 1) }')).toBe(
      undefined,
    );
  });

  it('query e mutation são recusadas, mesmo junto de uma subscription', () => {
    expect(rejectNonSubscription('{ me { id } }')?.[0].message).toMatch(/só vai subscription/);
    expect(rejectNonSubscription('mutation { adminDeleteUser(userId: 1) }')).toHaveLength(1);
    expect(
      rejectNonSubscription('subscription A { x } mutation B { adminDeleteUser(userId: 1) }'),
    ).toHaveLength(1);
  });

  it('sem texto é recusada; erro de sintaxe fica pro graphql-ws', () => {
    expect(rejectNonSubscription(undefined)).toHaveLength(1);
    expect(rejectNonSubscription('subscription {')).toBe(undefined);
  });
});
