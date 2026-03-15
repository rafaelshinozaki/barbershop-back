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

exec pnpm run start:dev
