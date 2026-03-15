REST Endpoints
[x] Criar análise (POST /analysis)
[x] Listar análises do usuário (GET /analysis)
[x] Buscar análise específica (GET /analysis/:id)
[x] Atualizar análise (PUT /analysis/:id)
[x] Deletar análise (DELETE /analysis/:id)
[x] Listar análises compartilhadas recebidas (GET /analysis/shared)
[x] Compartilhar análise (POST /analysis/:id/share)
[x] Responder convite de compartilhamento (POST /analysis/share/:shareId/:action)

GraphQL Endpoints
[x] Mutation: createAnalysis(input): Analysis
[x] Query: myAnalyses(filters): [Analysis]
[x] Query: analysis(id): Analysis
[x] Mutation: updateAnalysis(id, input): Analysis
[x] Mutation: deleteAnalysis(id): Boolean
[x] Query: sharedAnalyses: [AnalysisShare]
[x] Mutation: shareAnalysis(id, emails, message): [AnalysisShare]
[x] Mutation: respondToShare(shareId, action): AnalysisShare

2. Compartilhamento de Análises
[x] Modelos no banco (AnalysisShare)
[x] Templates de email
[x] Endpoint REST para compartilhar
[x] Endpoint GraphQL para compartilhar
[ ] Endpoint para aceitar convite (usuário externo)
[x] Endpoint para listar recebidas (GraphQL)
[x] Endpoint para marcar convite como aceito/recusado (GraphQL)

3. Restrições de acesso por plano/trial/viewer
[x] Middleware/guard para bloquear criação/edição se for viewer
[ ] Middleware/guard para bloquear módulos premium para planos básicos

4. Mock de cálculo estatístico (MVP)
[x] MockStatisticsService com dados fake para diferentes tipos de análise
[x] Integração do MockStatisticsService no AnalysisModule
[x] Geração de dados realistas para LDA, RGA, DA e outros tipos
[ ] Endpoint para simular cálculo (retornar dados fake)
[ ] Salvar resultados no campo results da análise

5. Implementações Concluídas
[x] AnalysisService com CRUD completo
[x] GraphQL types e resolvers para Analysis e AnalysisShare
[x] Integração com sistema de email para compartilhamento
[x] Verificação de trial/viewer mode no createAnalysis
[x] Tipagem correta do Prisma Client
[x] MockStatisticsService com dados fake para diferentes tipos de análise