#!/bin/sh
set -e

echo "Aguardando postgres (healthcheck garante que já está pronto)..."
sleep 3

echo "Rodando migrations..."
pnpm exec prisma migrate deploy

echo "Verificando seed..."
if [ "$SKIP_SEED" != "true" ]; then
  pnpm run seed || true
fi

# Produção roda o build compilado (node direto, pra receber os sinais de
# parada do container); fora dela, o modo watch de desenvolvimento.
if [ "$NODE_ENV" = "production" ]; then
  exec node dist/src/main
fi
exec pnpm run start:dev
