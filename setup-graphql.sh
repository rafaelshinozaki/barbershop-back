#!/bin/bash

echo "🚀 Configurando GraphQL no projeto..."

# Backend - Instalar dependências GraphQL
echo "📦 Instalando dependências GraphQL no backend..."
cd barbershop-back

# Verificar se pnpm está disponível
if command -v pnpm &> /dev/null; then
    echo "Usando pnpm..."
    pnpm install
else
    echo "Usando npm..."
    npm install
fi

# Frontend - Instalar dependências Apollo Client
echo "📦 Instalando dependências Apollo Client no frontend..."
cd ../barbershop-front

if command -v pnpm &> /dev/null; then
    echo "Usando pnpm..."
    pnpm install
else
    echo "Usando npm..."
    npm install
fi

echo "✅ Dependências instaladas!"

# Gerar schema GraphQL
echo "🔧 Gerando schema GraphQL..."
cd ../barbershop-back

if command -v pnpm &> /dev/null; then
    pnpm run build
else
    npm run build
fi

echo "✅ Schema GraphQL gerado!"

echo ""
echo "🎉 Configuração GraphQL concluída!"
echo ""
echo "📋 Próximos passos:"
echo "1. Inicie o backend: cd barbershop-back && npm run start:dev"
echo "2. Acesse o GraphQL Playground: http://localhost:3020/graphql"
echo "3. Teste as queries e mutations"
echo "4. Inicie o frontend: cd barbershop-front && npm run dev"
echo ""
echo "📚 Documentação: GRAPHQL_MIGRATION.md"
echo "" 