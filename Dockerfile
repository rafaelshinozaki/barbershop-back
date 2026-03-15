# Dockerfile para backend
FROM node:20.1-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

COPY package*.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm install

# Gera o cliente do Prisma (não precisa de DB)
RUN pnpm exec prisma generate

COPY . .

EXPOSE 3020
EXPOSE 5555

# Migrate e seed rodam em runtime (precisam do postgres)
COPY infra/entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
