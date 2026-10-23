import { ClientSuspensionService } from './client-suspension.service';
import { ClientAuthService } from './client-auth.service';

function harness(preview: unknown[] = [{ id: 1 }], alreadySuspended = false) {
  const sent: Record<string, unknown>[] = [];
  const updates: { data: Record<string, unknown> }[] = [];
  let suspended = alreadySuspended;
  const cancelAccountClub = jest.fn(async () => undefined);
  const prisma = {
    clientAccount: {
      findUnique: async () => ({
        id: 4,
        deletedAt: null,
        suspendedAt: suspended ? new Date() : null,
        email: 'ana@test.local',
        name: 'Ana Silva',
        language: 'pt',
        suspendedReason: 'golpe',
      }),
      update: async (args: { data: Record<string, unknown> }) => {
        updates.push(args);
        if (args.data.suspendedAt) suspended = true;
        if (args.data.suspendedAt === null) suspended = false;
        return {};
      },
    },
    pushSubscription: { deleteMany: async () => ({ count: 0 }) },
  };
  const service = new ClientSuspensionService(
    prisma as never,
    {
      sendCustomerEmail: async (_a: unknown, _b: unknown, context: Record<string, unknown>) => {
        sent.push(context);
      },
    } as never,
    { accountClubPreview: async () => preview, cancelAccountClub } as never,
    {
      createAccountDeletionUrl: async () => 'https://app.test/client/delete-account?token=abc',
    } as never,
  );
  return { service, cancelAccountClub, sent, updates };
}

describe('suspensão da conta e o clube', () => {
  it('cancela no fim do período e o e-mail traz o link de exclusão', async () => {
    const { service, cancelAccountClub, sent } = harness();
    await service.setSuspended(1, 4, true, 'golpe');
    expect(cancelAccountClub).toHaveBeenCalledWith(4, false);
    expect(sent[0]).toMatchObject({
      ClubPeriodEnd: true,
      ClubRefunded: false,
      ClubKept: false,
      DeleteURL: 'https://app.test/client/delete-account?token=abc',
      Reason: 'golpe',
    });
  });

  it('cancela agora e estorna quando a equipe pede', async () => {
    const { service, cancelAccountClub, sent } = harness();
    await service.setSuspended(1, 4, true, 'golpe', { refundUnused: true });
    expect(cancelAccountClub).toHaveBeenCalledWith(4, true);
    expect(sent[0].ClubRefunded).toBe(true);
    expect(sent[0].ClubPeriodEnd).toBe(false);
  });

  it('deixa cobrando se a equipe desmarcar o cancelamento', async () => {
    const { service, cancelAccountClub, sent } = harness();
    await service.setSuspended(1, 4, true, 'golpe', { cancelSubscriptions: false });
    expect(cancelAccountClub).not.toHaveBeenCalled();
    expect(sent[0].ClubKept).toBe(true);
  });

  it('não suspende a conta se o Stripe falhar', async () => {
    const { service, cancelAccountClub, updates } = harness();
    cancelAccountClub.mockRejectedValue(new Error('stripe down'));
    await expect(service.setSuspended(1, 4, true, 'golpe')).rejects.toThrow('stripe down');
    expect(updates).toEqual([]);
  });

  it('sem assinatura, só avisa e manda o link', async () => {
    const { service, cancelAccountClub, sent } = harness([]);
    await service.setSuspended(1, 4, true, 'golpe');
    expect(cancelAccountClub).not.toHaveBeenCalled();
    expect(sent[0]).toMatchObject({
      ClubPeriodEnd: false,
      ClubRefunded: false,
      ClubKept: false,
      DeleteURL: 'https://app.test/client/delete-account?token=abc',
    });
  });

  it('o comando do backoffice cancela mesmo sem os campos antigos', async () => {
    const { service, cancelAccountClub, sent } = harness([{ id: 1 }], true);
    await service.handleExternalSuspension(4);
    expect(cancelAccountClub).toHaveBeenCalledWith(4, false);
    expect(sent[0].ClubPeriodEnd).toBe(true);
  });
});

describe('exclusão pelo link do e-mail', () => {
  it('apaga sem senha quando o token vale', async () => {
    const service = Object.create(ClientAuthService.prototype) as ClientAuthService;
    const deleteAccount = jest.fn(async () => undefined);
    Object.assign(service, {
      consumeToken: async () => ({ id: 4, deletedAt: null }),
      deleteAccount,
    });
    await service.deleteAccountByToken('tok');
    expect(deleteAccount).toHaveBeenCalledWith(4, {}, { viaLink: true });
  });
});
