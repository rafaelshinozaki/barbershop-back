/**
 * Item 251, contra o Postgres de verdade: o e-mail que a equipe digitou na
 * ficha não basta para ligar a ficha à conta de quem confirmou esse e-mail
 * (um erro de digitação entregava a ficha a outra pessoa). O telefone da
 * conta também tem de ser o da ficha. Trocar o e-mail da ficha desfaz a
 * ligação com a conta antiga.
 */
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AccountLinkService } from './account-link.service';
import { ClientAuthService } from './client-auth.service';
import { memoryRedis, presetSignupCode } from '../auth/signup-code.testing-spec';
import { BarbershopService } from '../barbershop/barbershop.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const SECRET = 'segredo-de-teste';
const PASSWORD = 'Senha#Forte1';

describe('Ficha ligada à conta do cliente (integração)', () => {
  const prisma = new PrismaService();
  const redis = memoryRedis();
  const config = {
    get: (key: string) =>
      ({ JWT_SECRET: SECRET, JWT_EXPIRATION: '3600', FRONTEND_URL: 'https://app.test' }[key]),
  };
  const sent: { template: string; to: string; context: Record<string, any> }[] = [];
  const email = {
    sendCustomerEmail: async (
      _user: number | null,
      template: string,
      context: Record<string, any>,
      _subject: unknown,
      _meta: string,
      to: string,
    ) => void sent.push({ template, to, context }),
  };
  const clients = new ClientAuthService(
    prisma,
    new JwtService({ secret: SECRET }),
    config as never,
    email as never,
    {} as never,
    new AccountLinkService(prisma, email as never),
    redis as never,
  );
  const stub = {} as never;
  const shops = new BarbershopService(
    prisma,
    stub,
    stub,
    { isConfigured: () => false } as never,
    stub,
    { email: async () => undefined, whatsapp: async () => undefined } as never,
    { notify: () => undefined } as never,
  );
  let ownerId: number;
  let networkId: number;
  let shopId: number;

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = (
      await prisma.user.create({
        data: {
          email: `r251-dona-${RUN}@test.local`,
          isActive: true,
          password: 'x',
          fullName: 'Dona',
          idDocNumber: `r251${RUN}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'female',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      })
    ).id;
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede 251 ${RUN}` } })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: 'Unidade 251',
          slug: `r251-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `r251-shop-${RUN}@test.local`,
          networkId,
          ownerUserId: ownerId,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.customer.deleteMany({ where: { networkId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.clientAccount.deleteMany({ where: { email: { endsWith: `-${RUN}@test.local` } } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  it('e-mail da ficha digitado errado não entrega a ficha a quem tem esse e-mail', async () => {
    const typo = `mariasilva-${RUN}@test.local`;
    const maria = await prisma.customer.create({
      data: { networkId, name: 'Maria Silva', phone: '+5511987650001', email: typo },
    });

    // Dono do endereço (outra pessoa) cria a conta com o código do e-mail:
    // sem o telefone da ficha, nada liga
    const other = await clients.signup(
      typo,
      PASSWORD,
      'Outra Pessoa',
      '11 91234-0002',
      undefined,
      presetSignupCode(redis, typo),
    );
    expect(
      (await prisma.customer.findUniqueOrThrow({ where: { id: maria.id } })).clientAccountId,
    ).toBeNull();

    // Com o telefone da ficha (a própria pessoa), liga
    await clients.updateProfile(other.id, 'Maria Silva', '(11) 98765-0001');
    expect(
      (await prisma.customer.findUniqueOrThrow({ where: { id: maria.id } })).clientAccountId,
    ).toBe(other.id);

    // A equipe troca o e-mail da ficha: a ligação com a conta antiga sai
    await shops.updateCustomer(ownerId, shopId, maria.id, {
      email: `maria.silva-${RUN}@test.local`,
    });
    expect(
      (await prisma.customer.findUniqueOrThrow({ where: { id: maria.id } })).clientAccountId,
    ).toBeNull();
  });
});
