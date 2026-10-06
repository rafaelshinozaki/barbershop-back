/**
 * Equipe da plataforma vinda da API do backoffice (S2), com o app inteiro:
 * a afirmação assinada (x-backoffice-staff) junto com o segredo do gateway
 * substitui o login de User nas operações de sistema, dentro das áreas do
 * cargo. Sem o segredo certo, ou fora do cargo, não passa.
 */
const SECRET = 'segredo-do-gateway-para-o-teste-e2e!!';
process.env.BACKOFFICE_GATEWAY_SECRET = SECRET;

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { signStaffAssertion, type StaffRole } from '../src/auth/staff-assertion';

describe('equipe pela API do backoffice (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());

  const staff = (role: StaffRole, uid: number | null = null) =>
    signStaffAssertion(
      {
        sid: 1_000_000_001,
        email: 'equipe@plataforma.test',
        name: 'Equipe Teste',
        role,
        uid,
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      SECRET,
    );
  const gql = (query: string, headers: Record<string, string>) =>
    request(app.getHttpServer())
      .post('/graphql')
      .set('content-type', 'application/json')
      .set('apollo-require-preflight', 'true')
      .set(headers)
      .send({ query });
  const errorOf = (res: request.Response) => res.body.errors?.[0]?.message as string | undefined;

  it('cargo com a área: lê sem cookie', async () => {
    const res = await gql('{ backofficeStats { totalUsers } }', {
      'x-backoffice-gateway': SECRET,
      'x-backoffice-staff': staff('growth'),
    });
    expect(errorOf(res)).toBeUndefined();
    expect(typeof res.body.data.backofficeStats.totalUsers).toBe('number');
  });

  it('fora da área do cargo: recusa', async () => {
    const res = await gql('{ usersDetailed(filters: { page: 1, limit: 1 }) { total } }', {
      'x-backoffice-gateway': SECRET,
      'x-backoffice-staff': staff('growth'),
    });
    expect(errorOf(res)).toMatch(/área do backoffice/);
  });

  it('sem o segredo do gateway, ou com outro: a afirmação não vale', async () => {
    for (const headers of <Record<string, string>[]>[
      { 'x-backoffice-staff': staff('super_admin') },
      { 'x-backoffice-gateway': 'errado', 'x-backoffice-staff': staff('super_admin') },
    ]) {
      const res = await gql('{ backofficeStats { totalUsers } }', headers);
      expect(res.body.data?.backofficeStats ?? null).toBeNull();
      expect(errorOf(res)).toBeDefined();
    }
  });

  it('conta nova da equipe (sem User antigo) não usa operação da própria conta', async () => {
    const res = await gql('{ myNotificationsCount { unreadCount } }', {
      'x-backoffice-gateway': SECRET,
      'x-backoffice-staff': staff('super_admin'),
    });
    expect(res.body.data?.myNotificationsCount ?? null).toBeNull();
    expect(errorOf(res)).toBeDefined();
  });
});
