import { PrismaService } from '../prisma/prisma.service';
import { idDocTaken } from './id-doc-lookup';

const RUN = `${Date.now()}`.slice(-7);

describe('idDocTaken (integração)', () => {
  const prisma = new PrismaService();
  const ids: number[] = [];

  async function user(label: string, doc: string, country: string | null) {
    const role =
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }));
    const u = await prisma.user.create({
      data: {
        email: `doc-${label}-${RUN}@test.local`,
        password: 'x',
        fullName: `Doc ${label}`,
        idDocNumber: doc,
        phone: '+5511999999999',
        gender: 'male',
        birthdate: new Date('1990-01-01'),
        readTerms: true,
        roleId: role.id,
        ...(country
          ? {
              address: {
                create: {
                  zipcode: '01000000',
                  street: 'Rua',
                  city: 'São Paulo',
                  neighborhood: 'Centro',
                  state: 'SP',
                  country,
                },
              },
            }
          : {}),
      },
    });
    ids.push(u.id);
    return u;
  }

  afterAll(async () => {
    await prisma.address.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it('CPF com e sem máscara é o mesmo; país escrito de outro jeito também', async () => {
    const cpf = `9${RUN}`.padEnd(11, '1').slice(0, 11);
    const masked = cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    await user('br', masked, 'Brasil');
    expect(await idDocTaken(prisma, cpf, 'BR')).toBe(true);
    expect(await idDocTaken(prisma, masked, 'brazil')).toBe(true);
    // Outro país: o mesmo número pode existir
    expect(await idDocTaken(prisma, cpf, 'US')).toBe(false);
  });

  it('conta sem endereço também conta, com ou sem país', async () => {
    const doc = `8${RUN}`.padEnd(11, '2').slice(0, 11);
    const u = await user('noaddr', doc, null);
    expect(await idDocTaken(prisma, doc, 'BR')).toBe(true);
    expect(await idDocTaken(prisma, doc)).toBe(true);
    // A própria conta não conta como repetida
    expect(await idDocTaken(prisma, doc, 'BR', u.id)).toBe(false);
  });

  it('passaporte (com letra) compara o texto, sem diferenciar maiúsculas', async () => {
    await user('pass', `AB${RUN}`, 'US');
    expect(await idDocTaken(prisma, `ab${RUN}`, 'us')).toBe(true);
    expect(await idDocTaken(prisma, `ab${RUN}`, 'BR')).toBe(false);
  });
});
