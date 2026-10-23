import { BarbershopService, resolveShopLocale } from './barbershop.service';

const shop = {
  name: '  Casa do Corte  ',
  slug: 'Barbearia-X',
  address: 'Rua A, 10',
  city: 'São Paulo',
  state: 'SP',
  country: 'BR',
  postalCode: '01000000',
  phone: '11999990000',
  email: 'Casa@test.local',
};

describe('cadastro da unidade', () => {
  const findUnique = jest.fn();
  const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 4,
    ...data,
  }));

  function service() {
    const created = Object.create(BarbershopService.prototype) as BarbershopService;
    Object.assign(created, {
      prisma: {
        barbershop: { findUnique, count: async () => 0, create },
        subscription: { findFirst: async () => ({ plan: { name: 'Basic' } }) },
        user: { findUnique: async () => null },
        $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            $executeRaw: async () => 1,
            network: { findFirst: async () => ({ id: 2, currency: 'EUR' }) },
          }),
      },
    });
    return created;
  }

  beforeEach(() => {
    findUnique.mockReset();
    create.mockClear();
  });

  it('recusa endereço com espaço, curto ou hífen na ponta, antes de consultar', async () => {
    const created = service();
    await expect(created.createBarbershop(1, { ...shop, slug: 'Barbearia X' })).rejects.toThrow(
      /Endereço da página inválido/,
    );
    await expect(created.createBarbershop(1, { ...shop, slug: 'ab' })).rejects.toThrow(
      /Endereço da página inválido/,
    );
    await expect(created.createBarbershop(1, { ...shop, slug: 'barbearia-' })).rejects.toThrow(
      /Endereço da página inválido/,
    );
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('recusa fuso inexistente e moeda inventada, antes de consultar', async () => {
    const created = service();
    await expect(created.createBarbershop(1, { ...shop, timezone: 'Narnia' })).rejects.toThrow(
      'Fuso horário inválido',
    );
    await expect(created.createBarbershop(1, { ...shop, currency: 'GOLD' })).rejects.toThrow(
      /Moeda inválida/,
    );
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('recusa nome longo, e-mail sem formato e telefone sem DDD', async () => {
    const created = service();
    await expect(created.createBarbershop(1, { ...shop, name: 'x'.repeat(121) })).rejects.toThrow(
      /Nome da unidade inválido/,
    );
    await expect(created.createBarbershop(1, { ...shop, email: 'sem-arroba' })).rejects.toThrow(
      /E-mail da unidade inválido/,
    );
    await expect(created.createBarbershop(1, { ...shop, phone: '123' })).rejects.toThrow(
      /Telefone da unidade inválido/,
    );
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('grava o endereço em minúsculas e sugere fuso e moeda pelo país', async () => {
    findUnique.mockResolvedValue(null);
    const created = service();
    await created.createBarbershop(1, shop);
    expect(findUnique).toHaveBeenCalledWith({ where: { slug: 'barbearia-x' } });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        slug: 'barbearia-x',
        name: 'Casa do Corte',
        email: 'casa@test.local',
        phone: '+5511999990000',
        timezone: 'America/Sao_Paulo',
        currency: 'BRL',
      }),
    });
  });

  it('a edição também limita nome e telefone e não grava', async () => {
    const update = jest.fn();
    const created = Object.create(BarbershopService.prototype) as BarbershopService;
    Object.assign(created, {
      ensureBarbershopAccess: async () => ({
        id: 3,
        isActive: true,
        accessLevel: 'owner',
        country: 'BR',
      }),
      prisma: { barbershop: { update } },
    });
    await expect(created.updateBarbershop(1, 3, { name: 'x'.repeat(121) })).rejects.toThrow(
      /Nome da unidade inválido/,
    );
    await expect(created.updateBarbershop(1, 3, { phone: '123' })).rejects.toThrow(
      /Telefone da unidade inválido/,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('sem fuso nem moeda, o país sugere os dois', () => {
    expect(resolveShopLocale({ country: 'BR', state: 'SP' })).toEqual({
      timezone: 'America/Sao_Paulo',
      currency: 'BRL',
    });
    expect(resolveShopLocale({ country: 'BR', state: 'SP', timezone: 'Europe/Lisbon' })).toEqual({
      timezone: 'Europe/Lisbon',
      currency: 'BRL',
    });
  });
});
