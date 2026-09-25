import { GraphQLString } from 'graphql';

/**
 * Datas em campos String do GraphQL saem em ISO 8601.
 *
 * Uns 90 campos de data (createdAt, startAt, birthDate...) são declarados
 * como String e recebem o Date do Prisma. O escalar String do graphql-js
 * serializa objetos pelo valueOf() — o Date virava milissegundos em texto
 * ("1790363124259"), que new Date() não entende: telas mostravam "Invalid
 * Date", "-" ou "Agora mesmo" pra sempre. Aqui o Date vira ISO antes; o
 * resto segue o comportamento padrão.
 */
const serializeString = GraphQLString.serialize.bind(GraphQLString);

GraphQLString.serialize = (value: unknown) =>
  value instanceof Date && !isNaN(value.getTime()) ? value.toISOString() : serializeString(value);
