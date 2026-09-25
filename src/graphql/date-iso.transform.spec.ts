import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import {
  Field,
  GraphQLISODateTime,
  GraphQLModule,
  GraphQLSchemaHost,
  Int,
  ObjectType,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { GraphQLSchema, graphql, printSchema } from 'graphql';
import { serializeDatesAsIso } from './date-iso.transform';

const CREATED = new Date('2026-09-25T13:45:12.259Z');
const ISO = '2026-09-25T13:45:12.259Z';

// Igual aos tipos do app: data declarada como string, resolver devolve Date
@ObjectType()
class Item {
  @Field(() => Int)
  id: number;

  @Field()
  name: string;

  @Field()
  createdAt: string;

  @Field({ nullable: true })
  deletedAt?: string;

  @Field({ description: 'YYYY-MM-DD' })
  day: string;

  @Field(() => GraphQLISODateTime)
  startAt: Date;

  @Field(() => [String])
  history: string[];

  @Field()
  asyncAt: string;
}

@Resolver(() => Item)
class ItemResolver {
  @Query(() => [Item])
  items() {
    return [
      {
        id: 1,
        name: 'Corte',
        createdAt: CREATED,
        deletedAt: null,
        day: '2026-09-25',
        startAt: CREATED,
        history: [CREATED, 'texto'],
      },
    ];
  }

  @Query(() => String)
  serverTime(): string {
    return CREATED as unknown as string;
  }

  @ResolveField(() => String)
  async asyncAt() {
    return CREATED;
  }
}

// Sobe o GraphQLModule de verdade (ApolloDriver, schema em memória)
const bootSchema = async (transform: boolean) => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      GraphQLModule.forRoot<ApolloDriverConfig>({
        driver: ApolloDriver,
        autoSchemaFile: true,
        ...(transform ? { transformSchema: serializeDatesAsIso } : {}),
      }),
    ],
    providers: [ItemResolver],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, schema: app.get(GraphQLSchemaHost).schema };
};

describe('serializeDatesAsIso', () => {
  let app: INestApplication;
  let raw: INestApplication;
  let schema: GraphQLSchema;
  let rawSchema: GraphQLSchema;

  beforeAll(async () => {
    ({ app, schema } = await bootSchema(true));
    ({ app: raw, schema: rawSchema } = await bootSchema(false));
  });
  afterAll(async () => {
    await app?.close();
    await raw?.close();
  });

  const run = async (source: string, target = schema) => {
    const res = await graphql({ schema: target, source, contextValue: {} });
    expect(res.errors).toBeUndefined();
    return res.data;
  };

  it('devolve Date em campo String como ISO 8601', async () => {
    const data = await run('{ items { createdAt deletedAt } serverTime }');
    expect(data).toEqual({
      items: [{ createdAt: ISO, deletedAt: null }],
      serverTime: ISO,
    });
  });

  it('sem a transformação o mesmo campo sai em ms (o bug que corrige)', async () => {
    const data = await run('{ items { createdAt } }', rawSchema);
    expect(data).toEqual({ items: [{ createdAt: String(CREATED.getTime()) }] });
  });

  it('não mexe em strings, DateTime e outros escalares', async () => {
    const data = await run('{ items { id name day startAt } }');
    expect(data).toEqual({
      items: [{ id: 1, name: 'Corte', day: '2026-09-25', startAt: ISO }],
    });
  });

  it('converte listas de String e resolvers assíncronos', async () => {
    const data = await run('{ items { history asyncAt } }');
    expect(data).toEqual({ items: [{ history: [ISO, 'texto'], asyncAt: ISO }] });
  });

  it('não altera o SDL do schema', () => {
    expect(printSchema(schema)).toBe(printSchema(rawSchema));
  });
});
