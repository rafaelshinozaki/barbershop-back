# Dockerfile para backend
# Node 22 LTS — a imagem anterior (node:20.1) estava fora de suporte desde
# abril/2026.
FROM node:22-alpine

WORKDIR /app

# O Prisma precisa do OpenSSL, que as imagens alpine recentes não trazem mais
# (sem ele o `prisma migrate deploy` falha ao carregar o schema engine)
RUN apk add --no-cache openssl

# Mesma versão do "packageManager" do package.json (antes instalava a mais
# recente, que podia não bater com o lockfile)
RUN npm install -g pnpm@9.5.0

COPY package*.json pnpm-lock.yaml ./
COPY prisma ./prisma
# Inclui devDependencies de propósito: o entrypoint roda `prisma migrate
# deploy` e o seed (ts-node-dev), que estão em devDependencies.
RUN pnpm install --frozen-lockfile

# Gera o cliente do Prisma (não precisa de DB)
RUN pnpm exec prisma generate

COPY . .

# Compila pra dist/ — em produção o entrypoint roda `node dist/src/main` em
# vez do `nest start --watch` (modo desenvolvimento) de antes.
RUN pnpm build

EXPOSE 3020
EXPOSE 5555

# Migrate e seed rodam em runtime (precisam do postgres)
COPY infra/entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
