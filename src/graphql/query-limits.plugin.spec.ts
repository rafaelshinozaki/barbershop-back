import { ApolloServer } from '@apollo/server';
import { MAX_QUERY_DEPTH, MAX_QUERY_FIELDS, queryLimitsPlugin } from './query-limits.plugin';

// Schema pequeno com relação cíclica (loja → barbeiros → loja...), como no app
const typeDefs = `
  type Shop { id: Int! name: String! barbers: [Barber!]! }
  type Barber { id: Int! name: String! shop: Shop! }
  type Query { shop(id: Int!): Shop }
`;
const barber = { id: 1, name: 'B' };
const shop = { id: 1, name: 'S', barbers: [barber] };
Object.assign(barber, { shop });

describe('queryLimitsPlugin', () => {
  const server = new ApolloServer({
    typeDefs,
    resolvers: { Query: { shop: () => shop } },
    plugins: [queryLimitsPlugin()],
  });
  beforeAll(() => server.start());
  afterAll(() => server.stop());

  const run = async (query: string) => {
    const res = await server.executeOperation({ query });
    if (res.body.kind !== 'single') throw new Error('resposta inesperada');
    return res.body.singleResult;
  };

  it('deixa passar uma consulta normal (com __typename, que não conta)', async () => {
    const r = await run('{ shop(id: 1) { __typename id name barbers { __typename id name } } }');
    expect(r.errors).toBeUndefined();
    expect(r.data).toEqual({
      shop: {
        __typename: 'Shop',
        id: 1,
        name: 'S',
        barbers: [{ __typename: 'Barber', id: 1, name: 'B' }],
      },
    });
  });

  it('recusa a mesma consulta repetida com aliases', async () => {
    const aliases = Array.from({ length: 200 }, (_, i) => `a${i}: shop(id: 1) { id name }`).join(
      ' ',
    );
    const r = await run(`{ ${aliases} }`);
    expect(r.errors?.[0].extensions?.code).toBe('QUERY_TOO_COMPLEX');
    expect(r.data).toBeUndefined();
  });

  it('recusa aninhamento além do limite', async () => {
    let sel = 'id';
    // shop { barbers { shop { barbers ... } } } até passar do limite
    for (let i = 0; i < MAX_QUERY_DEPTH; i++)
      sel = i % 2 === 1 ? `shop { ${sel} }` : `barbers { ${sel} }`;
    const r = await run(`{ shop(id: 1) { barbers { ${sel} } } }`);
    expect(r.errors?.[0].extensions?.code).toBe('QUERY_TOO_DEEP');
  });

  it('conta campos que vêm de fragmentos', async () => {
    const fields = Array.from({ length: MAX_QUERY_FIELDS }, (_, i) => `f${i}: name`).join(' ');
    const r = await run(`fragment F on Shop { ${fields} } { shop(id: 1) { ...F } }`);
    expect(r.errors?.[0].extensions?.code).toBe('QUERY_TOO_COMPLEX');
  });

  it('no limite exato ainda passa', async () => {
    const fields = Array.from({ length: MAX_QUERY_FIELDS - 1 }, (_, i) => `f${i}: id`).join(' ');
    const r = await run(`{ shop(id: 1) { ${fields} } }`);
    expect(r.errors).toBeUndefined();
  });
});
