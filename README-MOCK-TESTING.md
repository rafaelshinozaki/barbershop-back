# Testando Dados Mock da API de Análise

Este documento explica como testar os dados mock implementados no sistema de análise.

## Pré-requisitos

1. Servidor rodando em `localhost:3000`
2. Banco de dados populado com dados mock (execute `npx prisma db seed`)
3. Token JWT válido de um usuário cadastrado

## Como obter um token JWT

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "rafaelsinosak@gmail.com",
    "password": "pwned"
  }'
```

## Executando os testes

### Opção 1: Script automatizado

1. Edite o arquivo `test-mock-data.sh` e substitua `<SEU_TOKEN_JWT>` pelo token obtido
2. Execute o script:

```bash
./test-mock-data.sh
```

### Opção 2: Comandos individuais

#### 1. Listar análises do usuário (dados do seed)

```bash
curl -X GET http://localhost:3000/analysis \
  -H "Authorization: Bearer <SEU_TOKEN_JWT>" \
  -H "Content-Type: application/json"
```

#### 2. Simular análise LDA (Life Data Analysis)

```bash
curl -X POST http://localhost:3000/analysis/simulate/LDA \
  -H "Authorization: Bearer <SEU_TOKEN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "sampleSize": 50,
    "distribution": "weibull",
    "timeUnit": "hours"
  }'
```

#### 3. Simular análise RGA (Reliability Growth Analysis)

```bash
curl -X POST http://localhost:3000/analysis/simulate/RGA \
  -H "Authorization: Bearer <SEU_TOKEN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "testPhases": 5,
    "model": "duane",
    "totalTestTime": 1000
  }'
```

#### 4. Simular análise DA (Degradation Analysis)

```bash
curl -X POST http://localhost:3000/analysis/simulate/DA \
  -H "Authorization: Bearer <SEU_TOKEN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "sampleSize": 20,
    "measurementPoints": 10,
    "degradationModel": "linear"
  }'
```

#### 5. Simular análise RTD (Reliability Test Data)

```bash
curl -X POST http://localhost:3000/analysis/simulate/RTD \
  -H "Authorization: Bearer <SEU_TOKEN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "sampleSize": 30,
    "confidenceLevel": 0.95
  }'
```

#### 6. Simular análise WA-NRI (Weibull Analysis - No Replacement Interval)

```bash
curl -X POST http://localhost:3000/analysis/simulate/WA-NRI \
  -H "Authorization: Bearer <SEU_TOKEN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "sampleSize": 25,
    "confidenceLevel": 0.90
  }'
```

#### 7. Simular análise WA-RI (Weibull Analysis - Replacement Interval)

```bash
curl -X POST http://localhost:3000/analysis/simulate/WA-RI \
  -H "Authorization: Bearer <SEU_TOKEN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "sampleSize": 25,
    "confidenceLevel": 0.90
  }'
```

#### 8. Simular análise LTD (Life Test Data)

```bash
curl -X POST http://localhost:3000/analysis/simulate/LTD \
  -H "Authorization: Bearer <SEU_TOKEN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "sampleSize": 40,
    "confidenceLevel": 0.95
  }'
```

#### 9. Simular análise LSM (Least Squares Method)

```bash
curl -X POST http://localhost:3000/analysis/simulate/LSM \
  -H "Authorization: Bearer <SEU_TOKEN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "sampleSize": 35,
    "confidenceLevel": 0.95
  }'
```

#### 10. Buscar análise específica

```bash
curl -X GET http://localhost:3000/analysis/1 \
  -H "Authorization: Bearer <SEU_TOKEN_JWT>" \
  -H "Content-Type: application/json"
```

#### 11. Listar análises compartilhadas

```bash
curl -X GET http://localhost:3000/analysis/shared \
  -H "Authorization: Bearer <SEU_TOKEN_JWT>" \
  -H "Content-Type: application/json"
```

## Estrutura dos dados mock

### LDA (Life Data Analysis)
- Estatísticas: média, mediana, desvio padrão, confiabilidade, MTTF
- Gráficos: Weibull, confiabilidade
- Intervalos de confiança
- Teste de adequação do ajuste

### RGA (Reliability Growth Analysis)
- Estatísticas de crescimento
- Curva de crescimento
- Taxa de falha inicial e atual
- Confiabilidade atual e projetada

### DA (Degradation Analysis)
- Curvas de degradação
- Distribuição de vida útil
- Análise de threshold
- Taxa de degradação

### Outros tipos
- Estatísticas básicas (média, mediana, desvio padrão)
- Métricas de confiabilidade
- Parâmetros específicos do tipo de análise

## Dados do seed

O seed cria 15 análises mock com dados estatísticos realistas para diferentes tipos:
- LDA, RGA, DA, RTD, WA-NRI, WA-RI, LTD, LSM
- Dados salvos no campo `results` como JSON
- Algumas análises marcadas como compartilhadas
- Compartilhamentos criados entre usuários

## Endpoints disponíveis

- `GET /analysis` - Listar análises do usuário
- `GET /analysis/:id` - Buscar análise específica
- `GET /analysis/shared` - Listar análises compartilhadas
- `POST /analysis/simulate/:type` - Simular dados mock para um tipo específico
- `POST /analysis` - Criar nova análise
- `PUT /analysis/:id` - Atualizar análise
- `DELETE /analysis/:id` - Deletar análise
- `POST /analysis/:id/share` - Compartilhar análise
- `POST /analysis/share/:shareId/:action` - Responder a convite de compartilhamento 