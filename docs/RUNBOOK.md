# Runbook: o que fazer quando alertar

Para quem estiver de plantão: o Super admin e o Administrador. Os alertas chegam:
- do Sentry: erro, request lento e os alertas de métrica abaixo;
- do monitor de fora (UptimeRobot ou Better Stack): site fora.

Ver `docs/MONITORING.md` para ligar cada um.

**Antes de mexer em qualquer coisa:**
1. Abra a **Saúde do sistema** (backoffice, só o admin; consulta `systemHealth`) para ver o último minuto: requests, p95, erros, banco, Redis e filas.
2. Abra o **Sentry**. O erro traz o `request_id`, e o mesmo id está na trilha do Axiom (`requestId`) e no registro de ações do backoffice.
3. **Foi logo depois de um deploy?** A primeira opção é reverter o deploy. Investigue depois.
4. Anote no canal da equipe o que viu e o que fez, com hora. É o que vira o relato do incidente.

## Alertas de métrica (Sentry, tag `alert`)

Vêm do `MetricsService`, que confere a cada minuto. Cada tipo alerta no máximo uma vez a cada 15 min. Os limites ficam em variáveis de ambiente (`ALERT_*`, ver `.env.example`).

| `alert` | Quer dizer | Primeiro passo | Depois |
|---|---|---|---|
| `slow` | p95 do minuto acima de 1 s (com 50+ requests) | Ver em "mais lenta" qual operação. Se é uma só, é consulta ruim; se são todas, é a máquina ou o banco | CPU e event loop altos na Saúde do sistema significam instância no limite: subir mais uma ou escalar. Banco lento (ping alto, pool cheio): ver as consultas no Postgres (`pg_stat_activity`) |
| `errors` | Mais de 2% de erro de verdade (bug ou falha; senha errada e sem permissão não contam) | Abrir o Sentry no mesmo minuto e achar o erro que mais aparece | Erro novo depois de deploy: reverter. Erro de serviço de fora (Stripe, e-mail): ver o status deles |
| `db-pool` | Consulta esperando conexão do pool do Prisma | Ver o `poolBusy` e quais operações estão lentas | Pool pequeno para o movimento: subir `connection_limit` na `DATABASE_URL` (padrão 10), sem passar do `max_connections` do Postgres dividido pelas instâncias |
| `db-down` | Postgres não respondeu ao `SELECT 1` | Ver se o Postgres está de pé (provedor ou container) e se o disco encheu | Sem banco, o app não funciona: avisar no status. Voltando, conferir se as migrações estão aplicadas |
| `redis-down` | Redis não respondeu | Ver se o Redis está de pé e a memória dele | Sem Redis: a busca vai direto ao banco (mais lenta), filas param (e-mail, lembrete), limite de tentativas vale por instância. Voltando, as filas retomam sozinhas |
| `queue-stuck` | Job esperando há mais de 10 min numa fila | Ver na Saúde do sistema qual fila e quantos jobs | Nenhum worker consumindo (instância caída ou travada): reiniciar a API. Fila de e-mail/WhatsApp travada pelo provedor: ver o status do Mailgun/Meta |
| `backup-stale` | O último backup do Postgres no S3 tem mais de 26 h (ou nenhum desde que o backup foi ligado) | Ver na Saúde do sistema a data do último e, na fila `backup`, se o job falhou (o erro do `pg_dump` ou do S3 vai pro log e pro alerta `queue-failed`) | `pg_dump` ausente ou mais velho que o Postgres: subir a imagem com o `postgresql-client` da mesma versão (`PG_CLIENT` no Dockerfile). Erro do S3: conferir a credencial e a permissão na pasta. Depois, "Fazer backup agora" na Saúde do sistema |
| `queue-failed` | Job que falhou de vez (esgotou as 5 tentativas) | Ver no Sentry e no log o erro do job | E-mail não entregue: o motivo costuma ser endereço inválido ou provedor fora. Cobrança: conferir no painel da Stripe antes de rodar de novo |

## Outros alertas

| Alerta | Primeiro passo |
|---|---|
| **Site fora** (monitor de fora) | `curl` no `/health` da API. Fora: ver o log e reiniciar. De pé: o problema é o front (deploy, DNS, CDN) |
| **API do backoffice com `/health/ready` 503** | O back principal está fora: ver a linha acima |
| **Muitos 502/504 na API do backoffice** (Sentry, tag `upstream`) | 504: o back está lento (ver `slow`). 502: o back está fora ou recusando conexão |
| **Erro novo depois de deploy** (Sentry) | Ver o `release`. Se afeta login, agenda ou pagamento, reverter na hora |
| **Teste de carga semanal vermelho** (GitHub Actions) | Abrir o resumo do run: qual cenário passou do limite. Comparar com o artefato da semana anterior e achar o PR da semana que mexeu naquela consulta. Não é incidente em produção, mas é a regressão que vira o próximo |

## Ações rápidas

- **Reiniciar a API:** reinicie pelo provedor. O SIGTERM fecha as conexões, e o que estava na fila continua no Redis.
- **Pausar uma fila que está causando estrago** (ex.: e-mail em loop): no Redis, `redis-cli -u $REDIS_URL SET "barbershop:<fila>:meta" ...`. O mais simples é desligar o envio pela variável do provedor (sem `MAILGUN_*`, nada sai) e reiniciar.
- **Reverter o deploy:** volte ao commit anterior no provedor. Migração não volta sozinha. As migrações deste projeto só acrescentam (coluna, tabela, gatilho), então o código anterior continua funcionando com o banco novo.
- **Aliviar a busca:** o cache da busca (45 s) já segura o grosso. Se a busca está derrubando o banco, suba mais uma instância da API antes de mexer em código.

## Restaurar o banco a partir do backup

Os backups ficam em `s3://<BACKUP_S3_BUCKET>/<BACKUP_S3_PREFIX>/AAAA/MM/DD/barbershop-<data>.dump`, um por dia, guardados por `BACKUP_RETENTION_DAYS` dias. O formato é o do `pg_restore`.

1. **Restaure primeiro num banco novo**, nunca por cima do de produção:
   ```bash
   aws s3 cp s3://<bucket>/backups/postgres/2026/10/05/barbershop-2026-10-05T06-30-00Z.dump ./b.dump
   createdb barbershop_restore
   pg_restore --no-owner --dbname barbershop_restore ./b.dump
   ```
2. **Confira** os dados que importam (o último agendamento, os usuários, `_prisma_migrations`).
3. **Troque o app para o banco restaurado.** Aponte a `DATABASE_URL` e reinicie. As migrações que vieram depois do backup rodam sozinhas na subida.
4. **O que entrou depois do backup se perde.** A cobrança da Stripe e o pagamento pelo app estão na Stripe: confira lá o que foi pago nesse intervalo.

Teste a restauração de tempos em tempos (a cada 3 meses, por exemplo). O teste automático (`src/backup/backup.int.spec.ts`) já faz o backup e o restaura num banco novo a cada CI.

## Depois do incidente

Escreva um relato curto, até no próprio canal:
- o que aconteceu;
- quanto tempo durou;
- quem foi afetado;
- a causa;
- o que muda para não repetir: um teste, um limite de alerta, uma linha neste runbook.
