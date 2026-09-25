import {
  GraphQLFieldResolver,
  GraphQLSchema,
  defaultFieldResolver,
  getNamedType,
  isObjectType,
  isScalarType,
} from 'graphql';

// Muitos ObjectTypes declaram datas como `@Field() createdAt: string`, mas os
// resolvers devolvem o `Date` do Prisma. O escalar String do graphql-js
// serializa `Date` via valueOf() — o cliente recebia ms em texto
// ("1790363124259") em vez de ISO. Aqui todo campo cujo tipo nomeado é String
// ganha um resolve que converte `Date` para ISO 8601; o schema não muda.
// Campos DateTime (GraphQLISODateTime) não passam por aqui: já serializam ISO.
const toIso = (value: unknown): unknown => {
  if (value instanceof Date) {
    // Date inválido segue como estava (o escalar String rejeita, como antes)
    return Number.isNaN(value.getTime()) ? value : value.toISOString();
  }
  if (Array.isArray(value)) return value.map(toIso);
  return value;
};

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as PromiseLike<unknown> | null)?.then === 'function';

export function serializeDatesAsIso(schema: GraphQLSchema): GraphQLSchema {
  for (const type of Object.values(schema.getTypeMap())) {
    if (!isObjectType(type) || type.name.startsWith('__')) continue;
    for (const field of Object.values(type.getFields())) {
      const named = getNamedType(field.type);
      if (!isScalarType(named) || named.name !== 'String') continue;
      const resolve: GraphQLFieldResolver<unknown, unknown> = field.resolve ?? defaultFieldResolver;
      // Síncrono quando o resolve original é síncrono: não cria Promise por campo
      field.resolve = (source, args, context, info) => {
        const value = resolve(source, args, context, info);
        return isPromiseLike(value) ? Promise.resolve(value).then(toIso) : toIso(value);
      };
    }
  }
  return schema;
}
