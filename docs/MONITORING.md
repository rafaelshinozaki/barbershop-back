# Monitoramento: erros, id do request e site fora

Parte da R1 do horizonte "Registros e estabilidade" (ROADMAP). Vale para os quatro apps:

| App | Repo |
|---|---|
| App das barbearias | `barbershop-front` |
| App do backoffice | `barbershop-backoffice-front` |
| API do backoffice | `barbershop-backoffice-back` |
| API principal | `barbershop-back` |

## Id do request (`x-request-id`)

1. O front cria um id novo em cada chamada e manda no cabeçalho `x-request-id`.
2. A API do backoffice repassa esse id para o back.
3. O back devolve o mesmo id na resposta.
4. Onde o id aparece:
   - **Sentry** dos quatro apps: tag `request_id`;
   - **trilha no Axiom**: campo `requestId`;
   - **registro de ações do backoffice**: coluna `requestId`.

Se o id recebido não tiver formato de id (texto livre, script), ele é trocado por um uuid novo.

**Para investigar um erro:** abra o erro no Sentry do front, copie o `request_id` e procure o mesmo valor no Sentry do back, no Axiom (`requestId`) ou no registro de ações.

## Sentry

Crie **um projeto por app**: `front`, `backoffice-front`, `backoffice-back`, `back`. Sem DSN, cada app funciona igual, só que sem Sentry.

| App | Variáveis |
|---|---|
| `barbershop-front` e `barbershop-backoffice-front` (no build) | `VITE_SENTRY_DSN`, `VITE_SENTRY_ENVIRONMENT`, `VITE_SENTRY_RELEASE` (o commit), `VITE_SENTRY_TRACES_SAMPLE_RATE` (padrão 0.1). Para os source maps: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` (os `.map` sobem e são apagados do `dist`) |
| `barbershop-backoffice-back` e `barbershop-back` | `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `SENTRY_TRACES_SAMPLE_RATE`. No back principal também `SENTRY_SLOW_REQUEST_MS` (padrão 2000) |

**O que é reportado:**
- **Fronts:**
  - erro de tela e de rota (menos 404);
  - erro interno do GraphQL (`INTERNAL_SERVER_ERROR`);
  - API fora do ar ou 5xx;
  - Web Vitals (LCP, INP, CLS) e o tempo de cada tela.
- **API do backoffice:** back fora do ar (502) ou lento (504).
- **Back:** exceção inesperada, 5xx e request lento.

**Dado pessoal:**
- Só vai o id de quem está logado.
- Não vão cookie, corpo, cabeçalhos com segredo, query string, nem texto e variáveis do GraphQL.
- Token no caminho da URL vira `:token`.
- Replay de sessão fica desligado.

**Alertas sugeridos no Sentry** (Alerts → Create alert):
- Issue nova em produção → e-mail para o Super admin e o Administrador.
- Mais de 20 eventos do mesmo erro em 5 min → e-mail e o canal de alerta.
- Regressão (erro que volta depois de resolvido) → e-mail.
- Front: LCP p75 acima de 4 s em 1 h (Performance → alerta de métrica).

## Site fora: conferência de fora a cada minuto

Use o [UptimeRobot](https://uptimerobot.com) (grátis: 50 monitores, a cada 5 min) ou o [Better Stack](https://betterstack.com/uptime) (grátis: a cada 3 min). Crie estes monitores:

| Monitor | URL | Espera |
|---|---|---|
| App das barbearias | `https://<domínio do app>/` | 200 |
| App do backoffice | `https://<domínio do backoffice>/` | 200 |
| API principal | `https://<api>/health` | 200 |
| API do backoffice | `https://<api do backoffice>/health/ready` | 200 (503 = o back não responde) |

Configure assim:
- Alerta depois de **2 falhas seguidas**, para não disparar por um soluço.
- Contatos: e-mail, mais o app no celular ou Telegram, do Super admin e do Administrador.
- Opcional: página de status pública para os clientes.

## O que fazer quando alertar (começo do runbook)

| Alerta | Primeiro passo |
|---|---|
| API principal fora | Ver o log do serviço e o `/health` (Postgres e Redis). Se foi logo depois de um deploy, reverter |
| API do backoffice com `/health/ready` 503 | O back principal está fora: ver a linha acima |
| Erro novo depois de um deploy | Abrir no Sentry, conferir o `release` e reverter se afeta login, agenda ou pagamento |
| Muitos 504 na API do backoffice | O back está lento: ver os requests lentos no Sentry do back e o pool do Postgres |

O runbook completo, com métricas, painel e alertas de lentidão e de fila, fica para a R4.
