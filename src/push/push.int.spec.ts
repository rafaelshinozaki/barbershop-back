import { BadRequestException } from '@nestjs/common';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';
import { RetentionService } from '../privacy/retention.service';
import { PushService, type PushPayload } from './push.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

/** Envio falso: guarda o que iria pro serviço de push e simula expiração */
class FakePush extends PushService {
  sent: Array<{ endpoint: string; payload: PushPayload }> = [];
  expired = new Set<string>();
  protected async deliver(row: { endpoint: string }, payload: PushPayload) {
    if (this.expired.has(row.endpoint)) throw Object.assign(new Error('gone'), { statusCode: 410 });
    this.sent.push({ endpoint: row.endpoint, payload });
  }
}

/**
 * Notificação no celular (Web Push): inscrição por aparelho, texto no
 * idioma do aparelho, inscrição expirada sai, sem VAPID nada é enviado.
 */
describe('Notificação no celular (integração)', () => {
  const prisma = new PrismaService();
  const keys = webpush.generateVAPIDKeys();
  const config = (withKeys: boolean) =>
    ({
      get: (k: string) =>
        withKeys
          ? ({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey }[k] as string)
          : undefined,
    } as never);
  const push = new FakePush(prisma, config(true));
  const off = new FakePush(prisma, config(false));

  let userId: number;
  let clientId: number;
  const endpoint = (label: string) => `https://fcm.googleapis.com/fcm/send/${RUN}/${label}`;
  const sub = (label: string) => ({
    endpoint: endpoint(label),
    p256dh: 'p'.repeat(87),
    auth: 'a'.repeat(22),
  });
  const build = (lang: string) => ({
    title: lang === 'en' ? 'New message' : 'Nova mensagem',
    body: 'x',
    url: '/messages',
  });

  beforeAll(async () => {
    const role =
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }));
    userId = (
      await prisma.user.create({
        data: {
          email: `push-${RUN}@test.local`,
          password: 'x',
          fullName: 'Push Teste',
          idDocNumber: `push${RUN}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'female',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          isActive: true,
          roleId: role.id,
        },
      })
    ).id;
    clientId = (
      await prisma.clientAccount.create({
        data: { email: `push-c-${RUN}@test.local`, name: 'Cliente' },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.pushSubscription.deleteMany({ where: { endpoint: { contains: RUN } } });
    await prisma.clientAccount.deleteMany({ where: { id: clientId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('só oferece com VAPID configurado', () => {
    expect(push.publicKey()).toBe(keys.publicKey);
    expect(off.publicKey()).toBeNull();
  });

  it('inscreve por aparelho, no idioma do aparelho; expirada sai', async () => {
    await expect(
      push.subscribe({ userId }, { ...sub('x'), endpoint: 'http://inseguro' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      push.subscribe({ userId }, { ...sub('x'), endpoint: 'https://10.0.0.5/push' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      push.subscribe({ userId }, { ...sub('x'), endpoint: 'https://evil.example/push' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await push.subscribe({ userId }, sub('pt'), { language: 'pt-BR' });
    await push.subscribe({ userId }, sub('en'), { language: 'en' });
    await push.subscribe({ userId }, sub('velho'));

    push.expired.add(endpoint('velho'));
    expect(await push.sendToUsers([userId], build)).toBe(2);
    expect(push.sent.find((s) => s.endpoint === endpoint('en'))!.payload.title).toBe('New message');
    expect(push.sent.find((s) => s.endpoint === endpoint('pt'))!.payload.title).toBe(
      'Nova mensagem',
    );
    expect(await prisma.pushSubscription.count({ where: { endpoint: endpoint('velho') } })).toBe(0);

    // Sem VAPID: nada sai
    expect(await off.sendToUsers([userId], build)).toBe(0);
  });

  it('o mesmo aparelho troca de dono; desligar tira; conta suspensa não recebe', async () => {
    await push.subscribe({ clientAccountId: clientId }, sub('pt'));
    const row = await prisma.pushSubscription.findUniqueOrThrow({
      where: { endpoint: endpoint('pt') },
    });
    expect(row).toMatchObject({ clientAccountId: clientId, userId: null });
    expect(await push.sendToClient(clientId, build)).toBe(1);

    await prisma.clientAccount.update({
      where: { id: clientId },
      data: { suspendedAt: new Date() },
    });
    expect(await push.sendToClient(clientId, build)).toBe(0);
    await prisma.clientAccount.update({ where: { id: clientId }, data: { suspendedAt: null } });

    await push.unsubscribe(endpoint('pt'));
    expect(await push.sendToClient(clientId, build)).toBe(0);
  });

  it('guarda: aparelho sem uso há 6 meses sai', async () => {
    await push.subscribe({ userId }, sub('parado'));
    await prisma.pushSubscription.update({
      where: { endpoint: endpoint('parado') },
      data: { lastUsedAt: new Date(Date.now() - 200 * 86_400_000) },
    });
    await new RetentionService(prisma).run();
    expect(await prisma.pushSubscription.count({ where: { endpoint: endpoint('parado') } })).toBe(
      0,
    );
  });
});
