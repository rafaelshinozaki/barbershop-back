# Teste de carga da busca e da agenda

Mede quanto a API aguenta nas telas mais usadas antes do piloto: busca de
unidades e de profissionais, página da unidade, horários livres e agenda da
equipe.

## Como rodar

```bash
# 1. Banco próprio, migrado, com o seed base
createdb barbershop_load
DATABASE_URL=postgresql://.../barbershop_load npx prisma migrate deploy
DATABASE_URL=postgresql://.../barbershop_load SEED_DEMO=true pnpm run seed

# 2. Volume: 3.000 unidades (metade em São Paulo), 9.000 profissionais com
#    página pública, 15.000 serviços, 60.000 clientes, 360.000 agendamentos.
#    Recusa sem LOAD_TEST_DB=true e em NODE_ENV=production.
LOAD_TEST_DB=true DATABASE_URL=postgresql://.../barbershop_load \
  npx ts-node --transpile-only scripts/load/generate.ts
# → imprime "run=<id>"

# 3. API apontando para esse banco; depois:
LOAD_RUN=<id> LOAD_API=http://localhost:3040 node scripts/load/run.mjs
# um cenário só: node scripts/load/run.mjs busca-unidades-sp
```

Variáveis: `LOAD_SHOPS`, `LOAD_BARBERS`, `LOAD_APPOINTMENTS` (gerador);
`LOAD_CONCURRENCY` (20), `LOAD_SECONDS` (20) (execução). Cada requisição
sai com um user-agent próprio: o limite por IP + navegador vale por cliente,
e aqui cada requisição faz o papel de um cliente diferente. O teste mede o
custo no servidor, não o limite.

## Toda semana, no GitHub Actions

O `.github/workflows/load-test.yml` roda toda segunda às 03:17 (Brasília), ou à mão em Actions → "Teste de carga semanal" → Run workflow. Faz os passos acima com 15 s por cenário e passa `LOAD_THRESHOLDS=scripts/load/thresholds.json`:
- o run quebra se algum cenário der erro ou passar do p95 máximo;
- os limites ficam em cerca de 2,5× o medido, para pegar regressão grande sem quebrar por variação do runner.

O resultado sai no resumo do run e no artefato `load-result-<n>` (`LOAD_RESULT_JSON`, guardado por 90 dias).

Rodada local de referência (2026-10-05, já com o cache da busca, 10 s por cenário): busca de unidades SP com p95 de 107 ms, horários livres 420 ms, agenda da semana 186 ms, nenhum erro.

## Resultado (2026-09-28)

Uma instância da API (Node, um processo) e o Postgres 16 na mesma máquina
(4 vCPU, 15 GB), 20 usuários simultâneos, 20 s por cenário, nenhum erro.

| Cenário | Antes req/s | Antes p95 ms | Depois req/s | Depois p95 ms |
|---|---:|---:|---:|---:|
| Busca de unidades, São Paulo, raio 10 km (~540 no raio) | 31 | 861 | 99 | 252 |
| Busca de unidades, Rio, 25 km, categoria, por nota | 44 | 593 | 130 | 192 |
| Busca de unidades sem filtro (todas as 3.000) | 31¹ | 860 | 28 | 863 |
| Busca de unidades por nome | 199 | 141 | 182 | 149 |
| Busca de profissionais, São Paulo, 10 km | 46 | 576 | 43–47 | 533–579 |
| Busca de profissionais sem filtro (9.000) | 42 | 607 | 47–58 | 415–527 |
| Busca de profissionais por nome | 152 | 192 | 130–162 | 173–222 |
| Página pública da unidade | 200 | 136 | 194 | 140 |
| Horários livres de um dia | 105 | 243 | 106 | 234 |
| Próximo horário livre | 105 | 236 | 98 | 261 |
| Agenda da semana (equipe logada) | 232 | 119 | 209 | 132 |

¹ Antes, rápida porque errada: considerava só 500 unidades quaisquer e
ordenava entre elas.

Variação entre execuções de ±10%; nas linhas com faixa, duas rodadas.

## O que foi corrigido

- **Cidade densa perdia resultados.** A busca de unidades pegava 500
  candidatas quaisquer do retângulo e só depois calculava distância, nota e
  ordem. Em São Paulo (~540 no raio) a mais perto podia ficar de fora; sem
  filtro, a ordem "relevância" valia só entre as 500 primeiras. Agora ela
  filtra e ordena todas (teto de 5.000), com teste de integração que falha no
  código antigo.
- **Duas fases.** A primeira consulta traz só o que filtra e ordena. Os
  dados do card (endereço, foto, rede, horário) vêm depois, só das 30 que
  aparecem.
- **Serviços agregados no banco.** Categorias e menor preço saem numa
  linha por unidade (`getServiceOffers`) em vez de uma por serviço. Esse
  era o maior custo em memória na busca de unidades e de profissionais.
- **Profissionais com localização:** o retângulo do raio passou a ser
  aplicado no banco (antes, todos os perfis públicos eram carregados e
  filtrados em memória).
- **Ordem por nome** com um `Intl.Collator` reutilizado.

## Leitura

- No banco, cada busca leva de 5 a 15 ms. O resto é a API montando
  objetos, e cresce com o número de candidatos. Por isso a busca sem filtro
  (todas as unidades do país) é a mais cara.
- Para o piloto (uma cidade, centenas de unidades), tudo fica com folga:
  a pior tela aguenta dezenas de buscas por segundo por instância, e dá para
  pôr mais instâncias atrás do load balancer (o rate limit já é
  compartilhado no Redis).
- Próximos passos, se o volume crescer:
  - cache curto (30–60 s) da lista sem filtro, que é a mesma para todo
    visitante;
  - PostGIS (ou um índice geográfico) em vez do retângulo lat/lng;
  - paginação por cursor na busca.
