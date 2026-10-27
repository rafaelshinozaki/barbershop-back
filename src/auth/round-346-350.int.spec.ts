/**
 * Itens 346 a 350, contra o Postgres de verdade: o cadastro social termina
 * só na conta da sessão, a troca de e-mail pelo backoffice tira a
 * confirmação, a conta de cliente criada pela equipe herda o e-mail
 * confirmado e o "1 mês grátis" vale um mês também no plano anual.
 */
import { BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { UserService } from './users/users.service';
import { AuthResolver } from '../graphql/resolvers/auth.resolver';
import { AccountLinkService } from '../client-auth/account-link.service';
import { ClientAuthService } from '../client-auth/client-auth.service';
import { CouponsService } from '../payments/coupons.service';
import { Role } from './interfaces/roles';
import { memoryRedis } from './signup-code.testing-spec';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const PASSWORD = 'Equipe#Forte1';
const mail = (label: string) => `r346-${label}-${RUN}@test.local`;

describe('Itens 346 a 350 (integração)', () => {
  const prisma = new PrismaService();
  const sent: { template: string; to: string }[] = [];
  const email = {
    sendTemplateEmail: async () => undefined,
    sendCustomerEmail: async (
      _u: number | null,
      template: string,
      _c: unknown,
      _s: unknown,
      _m: string,
      to: string,
    ) => void sent.push({ template, to }),
  };
  const users = new UserService(
    prisma,
    email as never,
    {} as never,
    { get: () => undefined } as never,
    memoryRedis() as never,
  );
  const config = {
    get: (key: string) =>
      ({ JWT_SECRET: 'segredo', JWT_EXPIRATION: '3600', FRONTEND_URL: 'https://app.test' }[key]),
  };
  const link = new AccountLinkService(prisma, email as never);
  const clients = new ClientAuthService(
    prisma,
    new JwtService({ secret: 'segredo' }),
    config as never,
    email as never,
    {} as never,
    link,
  );
  const coupons = new CouponsService(prisma);
  let ownerRoleId: number;
  let planIds: number[] = [];
  let couponId: number;

  const staff = async (label: string, verified: boolean) =>
    prisma.user.create({
      data: {
        email: mail(label),
        password: await bcrypt.hash(PASSWORD, 10),
        fullName: `Equipe ${label}`,
        idDocNumber: `r346${label}${RUN}`.slice(-20),
        phone: '+5511988887777',
        gender: 'female',
        birthdate: new Date('1990-01-01'),
        readTerms: true,
        isActive: true,
        roleId: ownerRoleId,
        emailVerifiedAt: verified ? new Date() : null,
      },
    });

  beforeAll(async () => {
    for (const name of [Role.BARBERSHOP_OWNER, Role.BARBERSHOP_EMPLOYEE]) {
      if (!(await prisma.role.findFirst({ where: { name } }))) {
        await prisma.role.create({ data: { name } });
      }
    }
    ownerRoleId = (await prisma.role.findFirstOrThrow({ where: { name: Role.BARBERSHOP_OWNER } }))
      .id;
  });

  afterAll(async () => {
    const where = { user: { email: { endsWith: `-${RUN}@test.local` } } };
    await prisma.linkedSocialAccount.deleteMany({ where });
    await prisma.userSystemConfig.deleteMany({ where });
    await prisma.address.deleteMany({ where });
    await prisma.notificationPreference.deleteMany({ where });
    await prisma.customer.deleteMany({ where: { email: { endsWith: `-${RUN}@test.local` } } });
    await prisma.clientAccountToken.deleteMany({
      where: { clientAccount: { email: { endsWith: `-${RUN}@test.local` } } },
    });
    await prisma.clientAccount.deleteMany({ where: { email: { endsWith: `-${RUN}@test.local` } } });
    if (couponId) await prisma.coupon.delete({ where: { id: couponId } });
    if (planIds.length) await prisma.plan.deleteMany({ where: { id: { in: planIds } } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  describe('346 e 347: cadastro pelo login social', () => {
    it('as mutations que aceitavam qualquer e-mail não existem mais', () => {
      const proto = AuthResolver.prototype as unknown as Record<string, unknown>;
      expect(proto.startSocialSignup).toBeUndefined();
      expect(proto.completeSocialSignup).toBeUndefined();
      expect(typeof proto.completeSocialProfile).toBe('function');
    });

    it('a conta social completa os dados uma vez, com o e-mail da sessão', async () => {
      const social = await users.findOrCreateSocialUser(
        mail('google'),
        'Pelo Google',
        'google',
        `pid-${RUN}`,
      );
      const done = await users.completeSocialProfile(social.id, {
        fullName: 'Nome Completo',
        idDocNumber: `soc${RUN}`.slice(-11),
        phone: ' +5512999990000 ',
        gender: 'male',
        birthdate: '1991-02-03',
        readTerms: true,
        roleName: Role.BARBERSHOP_EMPLOYEE,
      });
      expect(done).toMatchObject({
        email: mail('google'),
        fullName: 'Nome Completo',
        phone: '+5512999990000',
      });
      expect(done.termsAcceptedAt).not.toBeNull();
      expect(done.role?.name).toBe(Role.BARBERSHOP_EMPLOYEE);
      expect((done as { password?: string }).password).toBeUndefined();

      // Já completo: não refaz (nem troca os dados)
      await expect(
        users.completeSocialProfile(social.id, {
          idDocNumber: '1',
          phone: '+5511000000000',
          gender: 'male',
          birthdate: '1990-01-01',
          readTerms: true,
        }),
      ).rejects.toThrow('já está completo');

      // Barbearia falhou: volta a pedir os dados
      await users.reopenSocialProfile(social.id);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: social.id } })).phone).toBe('');
    });

    it('conta com senha, termos sem aceite e documento de outra conta são recusados', async () => {
      const local = await staff('local', true);
      const base = {
        idDocNumber: '',
        phone: '+5511911112222',
        gender: 'male',
        birthdate: '1990-01-01',
        readTerms: true,
      };
      await expect(users.completeSocialProfile(local.id, base)).rejects.toThrow('login social');
      const social = await users.findOrCreateSocialUser(mail('fb'), 'Pelo Facebook', 'facebook');
      await expect(
        users.completeSocialProfile(social.id, { ...base, readTerms: false }),
      ).rejects.toThrow('Aceite os termos');
      await expect(
        users.completeSocialProfile(social.id, { ...base, idDocNumber: local.idDocNumber }),
      ).rejects.toThrow('Registration data already in use');
      expect((await prisma.user.findUniqueOrThrow({ where: { id: social.id } })).phone).toBe('');
    });
  });

  describe('348: troca de e-mail pelo backoffice', () => {
    it('e-mail novo fica normalizado e sem confirmação; o de outra conta é recusado', async () => {
      const u = await staff('troca', true);
      const other = await staff('outra', true);
      // Mesmo e-mail com outra caixa: nada muda
      await users.updateUser({ id: u.id, email: mail('troca').toUpperCase() } as never);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).emailVerifiedAt,
      ).not.toBeNull();

      await expect(users.updateUser({ id: u.id, email: other.email } as never)).rejects.toThrow(
        'Outra conta já usa este e-mail',
      );

      await users.updateUser({ id: u.id, email: `  ${mail('nova').toUpperCase()} ` } as never);
      const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
      expect(row.email).toBe(mail('nova'));
      expect(row.emailVerifiedAt).toBeNull();
    });
  });

  describe('349: área do cliente aberta pela conta da equipe', () => {
    it('equipe com e-mail confirmado: a conta de cliente já nasce confirmada e liga a ficha', async () => {
      const u = await staff('confirmada', true);
      const network = await prisma.network.create({
        data: { ownerUserId: u.id, name: `Rede ${RUN}` },
      });
      const ficha = await prisma.customer.create({
        data: { networkId: network.id, name: 'Eu', email: mail('confirmada'), phone: u.phone },
      });
      const before = sent.length;
      const account = await clients.validateCredentials(mail('confirmada'), PASSWORD);
      expect(account.emailVerifiedAt).not.toBeNull();
      expect(sent.slice(before).some((m) => m.template === 'verify_email')).toBe(false);
      expect(
        (await prisma.customer.findUniqueOrThrow({ where: { id: ficha.id } })).clientAccountId,
      ).toBe(account.id);
      await prisma.customer.update({ where: { id: ficha.id }, data: { clientAccountId: null } });
      await prisma.network.delete({ where: { id: network.id } });
    });

    it('equipe sem e-mail confirmado: continua recebendo o link', async () => {
      const u = await staff('sem', false);
      const { account, created } = await link.clientAccountForStaff(u.id);
      expect(created).toBe(true);
      expect(account.emailVerifiedAt).toBeNull();
      const before = sent.length;
      await clients.welcomeLinkedAccount(account);
      expect(sent.slice(before)).toEqual([{ template: 'verify_email', to: mail('sem') }]);
    });
  });

  describe('350: "1 mês grátis" no plano anual', () => {
    it('no mensal zera; no anual desconta um doze avos', async () => {
      const monthly = await prisma.plan.create({
        data: { name: `Mensal ${RUN}`, price: 100, billingCycle: 'MONTHLY' },
      });
      const yearly = await prisma.plan.create({
        data: { name: `Anual ${RUN}`, price: 1000, billingCycle: 'YEARLY' },
      });
      planIds = [monthly.id, yearly.id];
      const coupon = await prisma.coupon.create({
        data: { code: `MES${RUN}`, name: 'Mês grátis', type: 'FREE_MONTH', value: 1 },
      });
      couponId = coupon.id;
      const u = await staff('cupom', true);
      const m = await coupons.validateCoupon(coupon.code, u.id, monthly.id, 100);
      expect(m).toMatchObject({ isValid: true, discountAmount: 100 });
      const y = await coupons.validateCoupon(coupon.code, u.id, yearly.id, 1000);
      expect(y).toMatchObject({ isValid: true, discountAmount: 83.33 });
    });
  });

  it('erro de validação é BadRequest (não 500)', async () => {
    const social = await users.findOrCreateSocialUser(mail('apple'), 'Apple', 'apple');
    await expect(
      users.completeSocialProfile(social.id, {
        idDocNumber: '',
        phone: '   ',
        gender: 'male',
        birthdate: '1990-01-01',
        readTerms: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
