import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CareerService } from './career.service';
import { ProfessionalReviewService } from './professional-review.service';
import { documentNameMatches, IdentityVerificationService } from './identity-verification.service';

const RUN = `${Date.now()}`.slice(-9);

describe('Nome do documento x nome da conta', () => {
  it('primeiro nome igual e o último sobrenome do documento no nome da conta', () => {
    const doc = { first_name: 'João', last_name: 'da Silva Souza' };
    expect(documentNameMatches('Joao Souza', doc)).toBe(true);
    expect(documentNameMatches('JOÃO PEDRO SILVA SOUZA', doc)).toBe(true);
    expect(documentNameMatches('Maria Souza', doc)).toBe(false);
    expect(documentNameMatches('João Silva', doc)).toBe(false);
    expect(documentNameMatches('João', doc)).toBe(false);
    expect(documentNameMatches('João Souza', null)).toBe(false);
  });
});

/**
 * Verificação de identidade de quem atende a domicílio (Stripe Identity):
 * só com "Atendo a domicílio" ligado, verificado só com o nome batendo, e o
 * domicílio só aparece no perfil depois de verificado.
 */
describe('Verificação de identidade (integração)', () => {
  const prisma = new PrismaService();
  const stripeCalls: string[] = [];
  const stripe = {
    createIdentitySession: async (p: { userId: number; returnUrl: string }) => {
      stripeCalls.push(`create:${p.userId}`);
      return { id: `vs_${RUN}_${stripeCalls.length}`, url: 'https://verify.stripe.com/start/x' };
    },
    retrieveIdentitySession: async (id: string) => ({
      id,
      status: 'verified',
      last_error: null,
      verified_outputs: { first_name: 'Carla', last_name: 'Teixeira' },
    }),
    redactIdentitySession: async (id: string) => void stripeCalls.push(`redact:${id}`),
  };
  const config = (provider: string) =>
    ({
      get: (k: string) =>
        ({ IDENTITY_PROVIDER: provider, FRONTEND_URL: 'https://app.test', NODE_ENV: 'test' }[k]),
    } as never);
  const fake = new IdentityVerificationService(prisma, stripe as never, config('fake'));
  const real = new IdentityVerificationService(prisma, stripe as never, config('stripe'));
  const career = new CareerService(prisma, new ProfessionalReviewService(prisma));

  let roleId: number;
  const userIds: number[] = [];

  const professional = async (label: string, fullName: string, offersHomeService = true) => {
    const user = await prisma.user.create({
      data: {
        email: `idv-${label}-${RUN}@test.local`,
        password: 'x',
        fullName,
        idDocNumber: `idv${label}${RUN}`.slice(-20),
        phone: `+55113${RUN}`.slice(0, 20),
        gender: 'female',
        birthdate: new Date('1990-01-01'),
        readTerms: true,
        roleId,
      },
    });
    userIds.push(user.id);
    await prisma.professional.create({
      data: {
        userId: user.id,
        slug: `idv-${label}-${RUN}`,
        visibility: 'public',
        isPublic: true,
        offersHomeService,
      },
    });
    return user;
  };
  const sessionOf = (url: string) => new URL(url).searchParams.get('session')!;

  beforeAll(async () => {
    roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
  });

  afterAll(async () => {
    await prisma.identityVerification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.professional.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('só quem atende a domicílio verifica', async () => {
    const u = await professional('sem-domicilio', 'Ana Lima', false);
    await expect(fake.start(u.id)).rejects.toBeInstanceOf(BadRequestException);
    expect(await fake.status(u.id)).toMatchObject({ offersHomeService: false, verified: false });
  });

  it('verificado com o nome batendo: selo e domicílio no perfil', async () => {
    const u = await professional('ok', 'Bruna Costa Alves');
    // Antes de verificar, o domicílio não aparece
    expect(await career.publicProfile(`idv-ok-${RUN}`)).toMatchObject({
      homeService: false,
      identityVerified: false,
    });

    const { url } = await fake.start(u.id);
    expect(url).toMatch(/^https:\/\/app\.test\/identity\/fake\?session=fake_/);
    expect(await fake.status(u.id)).toMatchObject({ status: 'pending', verified: false });

    await fake.completeFake(u.id, sessionOf(url), 'verified');
    expect(await fake.status(u.id)).toMatchObject({ status: 'verified', verified: true });
    expect(await career.publicProfile(`idv-ok-${RUN}`)).toMatchObject({
      homeService: true,
      identityVerified: true,
    });
    // Já verificada: não abre outra
    await expect(fake.start(u.id)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('documento de outra pessoa não verifica; pedir de novo guarda o motivo', async () => {
    const u = await professional('outra', 'Clara Nunes');
    const first = await fake.start(u.id);
    await fake.completeFake(u.id, sessionOf(first.url), 'other_person');
    expect(await fake.status(u.id)).toMatchObject({ status: 'name_mismatch', verified: false });

    const second = await fake.start(u.id);
    await fake.completeFake(u.id, sessionOf(second.url), 'requires_input');
    expect(await fake.status(u.id)).toMatchObject({
      status: 'requires_input',
      lastErrorCode: 'document_unverified_other',
      verified: false,
    });

    // Terceira tentativa no dia é a última
    await fake.start(u.id);
    await expect(fake.start(u.id)).rejects.toBeInstanceOf(BadRequestException);
    // Sessão de outra pessoa não é aceita
    const other = await professional('alheia', 'Duda Reis');
    await expect(fake.completeFake(other.id, sessionOf(second.url), 'verified')).rejects.toThrow();
  });

  it('Stripe: o webhook busca a sessão e aplica; a exclusão apaga no Stripe', async () => {
    const u = await professional('stripe', 'Carla Teixeira');
    const { url } = await real.start(u.id);
    expect(url).toBe('https://verify.stripe.com/start/x');
    const record = await prisma.identityVerification.findFirstOrThrow({ where: { userId: u.id } });
    expect(record).toMatchObject({ provider: 'stripe', status: 'pending' });
    // O fornecedor falso não vale em sessão do Stripe
    await expect(real.completeFake(u.id, record.sessionId, 'verified')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    await real.handleStripeSession(record.sessionId);
    expect(await real.status(u.id)).toMatchObject({ status: 'verified', verified: true });
    // Evento repetido não muda nada
    await real.handleStripeSession(record.sessionId);

    await real.forgetUser(u.id);
    expect(stripeCalls).toContain(`redact:${record.sessionId}`);
    expect(await prisma.identityVerification.count({ where: { userId: u.id } })).toBe(0);
  });

  it('em produção é sempre o Stripe', () => {
    const prod = new IdentityVerificationService(
      prisma,
      stripe as never,
      {
        get: (k: string) => ({ IDENTITY_PROVIDER: 'fake', NODE_ENV: 'production' }[k]),
      } as never,
    );
    expect(prod.provider()).toBe('stripe');
  });
});
