/**
 * Teste de carga da busca e da agenda (sem dependências: fetch do Node).
 *
 *   LOAD_API=http://localhost:3040 LOAD_RUN=<run do generate> \
 *     node scripts/load/run.mjs [cenário...]
 *
 * Cada cenário roda por LOAD_SECONDS (padrão 20) com LOAD_CONCURRENCY (20)
 * usuários ao mesmo tempo, e mede latência (p50/p95/p99), requisições por
 * segundo e erros. Cada requisição sai com um user-agent próprio: o limite
 * por IP + navegador da API vale por cliente, e aqui cada requisição é um
 * cliente diferente (mede o custo do servidor, não o limite).
 *
 * Com LOAD_THRESHOLDS=<arquivo .json> (ex.: scripts/load/thresholds.json),
 * sai com erro se algum cenário passar do p95 máximo ou tiver erro: é o que
 * o teste de carga semanal (.github/workflows/load-test.yml) usa.
 * LOAD_RESULT_JSON=<arquivo> grava o resultado pra comparar semana a semana.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'

const API = process.env.LOAD_API ?? 'http://localhost:3040'
const RUN = process.env.LOAD_RUN
const SECONDS = Number(process.env.LOAD_SECONDS ?? 20)
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY ?? 20)
const SHOPS = Number(process.env.LOAD_SHOPS ?? 3000)
if (!RUN) throw new Error('Defina LOAD_RUN (o "run=" impresso pelo generate.ts)')

const SP = { lat: -23.5505, lng: -46.6333 }
const RJ = { lat: -22.9068, lng: -43.1729 }
const rand = (n) => Math.floor(Math.random() * n)
const dayKey = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
let seq = 0

async function gql(query, variables, headers = {}) {
  const res = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': `load-test-${process.pid}-${seq++}`,
      'apollo-require-preflight': 'true',
      ...headers
    },
    body: JSON.stringify({ query, variables })
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.errors) {
    throw new Error(`${res.status} ${body.errors?.[0]?.message ?? ''}`.trim())
  }
  return { body, res }
}

// Dados que os cenários usam: ids de unidades e serviços do volume gerado
async function fixtures() {
  const slugs = Array.from({ length: 50 }, () => `load-${RUN}-${rand(SHOPS)}`)
  const shops = []
  for (const slug of slugs) {
    const { body } = await gql(
      'query($slug: String!) { publicBarbershop(slug: $slug) { id services { id } barbers { id } } }',
      { slug }
    )
    const b = body.data.publicBarbershop
    shops.push({ slug, id: b.id, serviceId: b.services[0].id, barberId: b.barbers[0]?.id })
  }
  // Agenda: o dono da unidade 0 entra; o cookie de sessão segue nas chamadas
  const login = await gql(
    'mutation($i: LoginInput!) { login(input: $i) { id } }',
    { i: { email: `load-${RUN}-0-0@load.test`, password: 'load-test-password' } },
    { origin: 'http://localhost:5174' }
  )
  const cookie = (login.res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  const { body } = await gql(
    'query($slug: String!) { publicBarbershop(slug: $slug) { id } }',
    { slug: `load-${RUN}-0` }
  )
  return { shops, cookie, ownShopId: body.data.publicBarbershop.id }
}

const SEARCH_SHOPS = `query($i: SearchBarbershopsInput!) { searchBarbershops(input: $i) { id name distanceKm averageRating minPrice isFeatured imageUrl } }`
const SEARCH_PROS = `query($i: SearchProfessionalsInput!) { searchProfessionals(input: $i) { slug name distanceKm averageRating } }`

const scenarios = {
  'busca-unidades-sp': () =>
    gql(SEARCH_SHOPS, { i: { lat: SP.lat + (Math.random() - 0.5) * 0.1, lng: SP.lng, radiusKm: 10 } }),
  'busca-unidades-rj-categoria': () =>
    gql(SEARCH_SHOPS, { i: { lat: RJ.lat, lng: RJ.lng, radiusKm: 25, category: 'BEARD', sort: 'rating' } }),
  'busca-unidades-sem-filtro': () => gql(SEARCH_SHOPS, { i: {} }),
  'busca-unidades-texto': () => gql(SEARCH_SHOPS, { i: { query: `Barbearia ${rand(SHOPS)}` } }),
  'busca-profissionais-sp': () =>
    gql(SEARCH_PROS, { i: { lat: SP.lat + (Math.random() - 0.5) * 0.1, lng: SP.lng, radiusKm: 10 } }),
  'busca-profissionais-sem-filtro': () => gql(SEARCH_PROS, { i: {} }),
  'busca-profissionais-texto': () => gql(SEARCH_PROS, { i: { query: `Profissional ${rand(SHOPS)}` } }),
  'pagina-unidade': (f) =>
    gql('query($slug: String!) { publicBarbershop(slug: $slug) { id name services { id name price } barbers { id name } } }', {
      slug: f.shops[rand(f.shops.length)].slug
    }),
  'horarios-livres': (f) => {
    const s = f.shops[rand(f.shops.length)]
    return gql(
      'query($b: Int!, $d: String!, $s: [Int!]) { publicAvailableSlots(barbershopId: $b, date: $d, serviceIds: $s) }',
      { b: s.id, d: dayKey(1 + rand(10)), s: [s.serviceId] }
    )
  },
  'proximo-horario': (f) => {
    const s = f.shops[rand(f.shops.length)]
    return gql(
      'query($b: Int!, $s: [Int!]!) { publicNextAvailableSlot(barbershopId: $b, serviceIds: $s) { startAt } }',
      { b: s.id, s: [s.serviceId] }
    )
  },
  'agenda-da-semana': (f) => {
    const start = dayKey(-3 + rand(7))
    return gql(
      'query($b: Int!, $s: String, $e: String) { barbershopAppointments(barbershopId: $b, startAt: $s, endAt: $e) { id startAt endAt status } }',
      { b: f.ownShopId, s: `${start}T00:00:00.000Z`, e: `${dayKey(7)}T00:00:00.000Z` },
      { cookie: f.cookie, origin: 'http://localhost:5174' }
    )
  }
}

function pct(sorted, p) {
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

async function runScenario(name, fn, f) {
  const times = []
  const errors = new Map()
  const end = Date.now() + SECONDS * 1000
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (Date.now() < end) {
        const t = performance.now()
        try {
          await fn(f)
          times.push(performance.now() - t)
        } catch (err) {
          const key = String(err.message).slice(0, 80)
          errors.set(key, (errors.get(key) ?? 0) + 1)
        }
      }
    })
  )
  times.sort((a, b) => a - b)
  const errCount = [...errors.values()].reduce((a, b) => a + b, 0)
  return {
    name,
    rps: Math.round((times.length / SECONDS) * 10) / 10,
    p50: Math.round(pct(times, 50)),
    p95: Math.round(pct(times, 95)),
    p99: Math.round(pct(times, 99)),
    ok: times.length,
    errors: errCount,
    firstError: errors.size ? [...errors.keys()][0] : ''
  }
}

const wanted = process.argv.slice(2)
const f = await fixtures()
console.log(`API ${API} · ${CONCURRENCY} simultâneos · ${SECONDS}s por cenário\n`)
console.log('| Cenário | req/s | p50 ms | p95 ms | p99 ms | ok | erros | limite p95 |')
console.log('|---|---:|---:|---:|---:|---:|---:|---:|')
const thresholds = process.env.LOAD_THRESHOLDS
  ? JSON.parse(readFileSync(process.env.LOAD_THRESHOLDS, 'utf8'))
  : null
const results = []
const lines = [
  `API ${API} · ${CONCURRENCY} simultâneos · ${SECONDS}s por cenário`,
  '',
  '| Cenário | req/s | p50 ms | p95 ms | p99 ms | ok | erros | limite p95 |',
  '|---|---:|---:|---:|---:|---:|---:|---:|'
]
const failures = []
for (const [name, fn] of Object.entries(scenarios)) {
  if (wanted.length && !wanted.includes(name)) continue
  const r = await runScenario(name, fn, f)
  const limit = thresholds?.[name]
  results.push({ ...r, limit: limit ?? null })
  if (r.errors > 0) failures.push(`${name}: ${r.errors} erro(s) (${r.firstError})`)
  if (limit != null && r.p95 > limit) failures.push(`${name}: p95 ${r.p95} ms > ${limit} ms`)
  const line = `| ${r.name} | ${r.rps} | ${r.p50} | ${r.p95} | ${r.p99} | ${r.ok} | ${r.errors}${r.firstError ? ` (${r.firstError})` : ''} | ${limit ?? '—'} |`
  lines.push(line)
  console.log(line)
}
if (failures.length) lines.push('', '**Fora do limite:**', ...failures.map((x) => `- ${x}`))
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`)
if (process.env.LOAD_RESULT_JSON) {
  writeFileSync(
    process.env.LOAD_RESULT_JSON,
    JSON.stringify({ at: new Date().toISOString(), api: API, concurrency: CONCURRENCY, seconds: SECONDS, results }, null, 2)
  )
}
if (thresholds && failures.length) {
  console.error(`\nFora do limite:\n${failures.join('\n')}`)
  process.exit(1)
}
