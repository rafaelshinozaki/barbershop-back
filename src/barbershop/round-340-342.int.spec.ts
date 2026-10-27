/**
 * Itens 340 e 342, contra o Postgres de verdade (S3 simulado): a foto de
 * perfil e a logo da rede só trocam depois do envio confirmado, e a campanha
 * para a rede inteira conta nos limites de todas as unidades. O item 341
 * (aceite de vaga com trava) está em job-opening.int.spec.ts.
 */
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService, MARKETING_DAILY_LIMIT_MESSAGE } from './barbershop.service';
import { UserService } from '../auth/users/users.service';
import { NetworkResolver } from '../graphql/resolvers/network.resolver';

// O link de descadastro dos e-mails da campanha é assinado com ele
process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('Itens 340 e 342 (integração)', () => {
  const prisma = new PrismaService();
  const deleted: string[] = [];
  const s3 = {
    createImageUpload: async (keyWithoutExtension: string) => ({
      url: 'https://s3.test',
      fields: [],
      key: `${keyWithoutExtension}.jpg`,
    }),
    deleteObject: async (key: string) => void deleted.push(key),
    getDownloadUrl: async (key: string) => `https://s3.test/${key}`,
  };
  const shops = new BarbershopService(
    prisma,
    {} as never,
    {} as never,
    { isConfigured: () => false } as never,
    {} as never,
    { emailBulk: async () => undefined, whatsappBulk: async () => undefined } as never,
    { notify: () => undefined } as never,
  );
  const users = new UserService(
    prisma,
    {} as never,
    s3 as never,
    { get: () => undefined } as never,
    {} as never,
  );
  const networks = new NetworkResolver(shops, prisma, s3 as never);

  let ownerId: number;
  let networkId: number;
  const shopIds: number[] = [];

  beforeAll(async () => {
    const role =
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }));
    ownerId = (
      await prisma.user.create({
        data: {
          email: `r340-${RUN}@test.local`,
          password: 'x',
          fullName: 'Dono',
          idDocNumber: `r340${RUN}`.slice(-20),
          phone: '+5511900000000',
          gender: 'male',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId: role.id,
          photoKey: 'users/antiga/foto.jpg',
        },
      })
    ).id;
    networkId = (
      await prisma.network.create({
        data: { ownerUserId: ownerId, name: `Rede ${RUN}`, logoKey: `antiga-logo-${RUN}.png` },
      })
    ).id;
    for (const label of ['a', 'b']) {
      shopIds.push(
        (
          await prisma.barbershop.create({
            data: {
              name: `Unidade ${label} ${RUN}`,
              slug: `r340-${label}-${RUN}`,
              address: 'Rua 1',
              city: 'SP',
              state: 'SP',
              country: 'BR',
              postalCode: '01000000',
              phone: '11999999999',
              email: `r340-${label}-${RUN}@test.local`,
              networkId,
              ownerUserId: ownerId,
            },
          })
        ).id,
      );
    }
    await prisma.customer.create({
      data: {
        networkId,
        name: 'Cliente',
        email: `cli-r340-${RUN}@test.local`,
        phone: '11988887777',
      },
    });
  });

  afterAll(async () => {
    await prisma.marketingCampaign.deleteMany({ where: { barbershopId: { in: shopIds } } });
    await prisma.customer.deleteMany({ where: { networkId } });
    await prisma.barbershop.deleteMany({ where: { id: { in: shopIds } } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE id = ${ownerId}`;
    await prisma.$disconnect();
  });

  describe('340: foto de perfil e logo da rede', () => {
    it('gerar o link não troca a foto; confirmar troca e apaga a anterior; chave de outra conta é recusada', async () => {
      const upload = await users.generatePhotoUploadUrl(ownerId, 'image/jpeg');
      expect(upload.key.startsWith(`users/${ownerId}/`)).toBe(true);
      // Envio que não aconteceu: a foto continua a de antes
      expect((await prisma.user.findUniqueOrThrow({ where: { id: ownerId } })).photoKey).toBe(
        'users/antiga/foto.jpg',
      );

      await expect(users.setPhoto(ownerId, 'users/999999/outra.jpg')).rejects.toThrow(
        'Arquivo inválido',
      );
      await expect(users.setPhoto(ownerId, `users/${ownerId}/../x.jpg`)).rejects.toThrow(
        'Arquivo inválido',
      );

      await expect(users.setPhoto(ownerId, upload.key)).resolves.toBe(
        `https://s3.test/${upload.key}`,
      );
      expect((await prisma.user.findUniqueOrThrow({ where: { id: ownerId } })).photoKey).toBe(
        upload.key,
      );
      expect(deleted).toContain('users/antiga/foto.jpg');

      // Tirar a foto também apaga o arquivo
      await users.setPhoto(ownerId, null);
      expect(deleted).toContain(upload.key);
    });

    it('logo: o link não troca a logo; cada envio tem nome novo; confirmar apaga a anterior', async () => {
      const user = { id: ownerId } as never;
      const first = await networks.getNetworkLogoUploadUrl(user, 'image/png');
      const second = await networks.getNetworkLogoUploadUrl(user, 'image/png');
      expect(first.key).not.toBe(second.key);
      expect(first.key.startsWith(`networks/${networkId}/logo-`)).toBe(true);
      expect((await prisma.network.findUniqueOrThrow({ where: { id: networkId } })).logoKey).toBe(
        `antiga-logo-${RUN}.png`,
      );

      await expect(
        networks.setNetworkLogo(user, `networks/${networkId + 1000000}/x.png`),
      ).rejects.toThrow('Arquivo inválido');
      await networks.setNetworkLogo(user, first.key);
      const row = await prisma.network.findUniqueOrThrow({ where: { id: networkId } });
      expect(row.logoKey).toBe(first.key);
      expect(row.logoUrl).toBeNull();
      expect(deleted).toContain(`antiga-logo-${RUN}.png`);

      await networks.removeNetworkLogo(user);
      expect(deleted).toContain(first.key);
      expect(
        (await prisma.network.findUniqueOrThrow({ where: { id: networkId } })).logoKey,
      ).toBeNull();
    });
  });

  it('342: a campanha da rede inteira por uma unidade bloqueia a outra no mesmo dia', async () => {
    const blast = (shopId: number) =>
      shops.sendMarketingBlast(ownerId, shopId, {
        subject: 'Promoção',
        message: 'Corte com 20% off',
        segment: 'ALL',
        sendEmail: true,
        sendWhatsapp: false,
      });
    await blast(shopIds[0]);
    const campaign = await prisma.marketingCampaign.findFirstOrThrow({
      where: { barbershopId: shopIds[0] },
    });
    expect(campaign.networkWide).toBe(true);
    await expect(blast(shopIds[1])).rejects.toThrow(MARKETING_DAILY_LIMIT_MESSAGE);
  });
});
