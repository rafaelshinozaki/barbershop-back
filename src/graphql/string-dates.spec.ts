import { GraphQLObjectType, GraphQLSchema, GraphQLString, graphql } from 'graphql';
import './string-dates';

describe('datas em campos String do GraphQL', () => {
  it('Date vira ISO (antes: milissegundos em texto)', () => {
    expect(GraphQLString.serialize(new Date('2026-09-25T12:00:00Z'))).toBe(
      '2026-09-25T12:00:00.000Z',
    );
  });

  it('o resto continua igual', () => {
    expect(GraphQLString.serialize('texto')).toBe('texto');
    expect(GraphQLString.serialize(42)).toBe('42');
    expect(GraphQLString.serialize(true)).toBe('true');
  });

  it('numa consulta de verdade o campo sai em ISO', async () => {
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'Query',
        fields: {
          createdAt: { type: GraphQLString, resolve: () => new Date('1989-10-01T12:00:00Z') },
        },
      }),
    });
    const res = await graphql({ schema, source: '{ createdAt }' });
    expect(res.data).toEqual({ createdAt: '1989-10-01T12:00:00.000Z' });
  });
});
