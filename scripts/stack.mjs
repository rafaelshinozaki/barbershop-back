/**
 * Um comando pra stack local.
 *
 * Sobe Postgres e Redis se os containers não estiverem de pé (o volume fica).
 * Aplica só as migrations pendentes e roda o seed de novo no modo que cria o
 * que falta — sem SEED_RESET, então nada que já existe é apagado.
 * O back (3020) e o front (5173) só são iniciados se a porta ainda estiver livre.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const front = path.resolve(root, '..', 'barbershop-front')
const composeFile = path.join(root, 'infra', 'compose.yaml')

function commandLine(command, args) {
  const quote = (value) => {
    const text = String(value)
    if (!/[\s"]/.test(text)) return text
    return `"${text.replace(/"/g, '\\"')}"`
  }
  return [command, ...args.map(quote)].join(' ')
}

function run(command, args, { cwd = root, env = process.env, quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandLine(command, args), {
      cwd,
      env,
      stdio: quiet ? 'ignore' : 'inherit',
      shell: true,
      windowsHide: true,
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} saiu com código ${code}`))
    })
  })
}

function listening(port) {
  const probe = (host) =>
    new Promise((resolve) => {
      const socket = net.connect({ port, host })
      const finish = (open) => {
        socket.destroy()
        resolve(open)
      }
      socket.once('connect', () => finish(true))
      socket.once('error', () => finish(false))
      socket.setTimeout(800, () => finish(false))
    })
  return Promise.all([probe('127.0.0.1'), probe('::1')]).then((results) => results.some(Boolean))
}

async function waitForPostgres() {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      await run(
        'docker',
        ['compose', '-f', composeFile, 'exec', '-T', 'postgres', 'pg_isready', '-U', 'barbershop', '-d', 'barbershop'],
        { quiet: true },
      )
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
  throw new Error('O Postgres não ficou pronto a tempo.')
}

function startDev(command, args, cwd) {
  return spawn(commandLine(command, args), {
    cwd,
    stdio: 'inherit',
    shell: true,
    windowsHide: true,
  })
}

function stopTree(child) {
  if (!child?.pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { shell: true, stdio: 'ignore' })
    return
  }
  child.kill('SIGINT')
}

async function main() {
  console.log('Subindo Postgres e Redis...')
  await run('docker', ['compose', '-f', composeFile, 'up', '-d'])
  await waitForPostgres()

  console.log('Aplicando migrations pendentes...')
  await run('pnpm', ['exec', 'prisma', 'migrate', 'deploy'])

  console.log('Rodando o seed (cria o que falta, sem apagar o que já existe)...')
  const seedEnv = { ...process.env, SEED_DEMO: 'true' }
  delete seedEnv.SEED_RESET
  await run('pnpm', ['run', 'seed'], { env: seedEnv })

  const children = []
  const backUp = await listening(3020)
  const frontDir = existsSync(path.join(front, 'package.json'))
  const frontUp = frontDir && (await listening(5173))

  if (backUp) console.log('API já está em http://localhost:3020')
  else {
    console.log('Iniciando a API em http://localhost:3020')
    children.push(startDev('pnpm', ['run', 'start:dev'], root))
  }

  if (!frontDir) {
    console.log(`Front não encontrado em ${front}`)
  } else if (frontUp) {
    console.log('Front já está em http://localhost:5173')
  } else {
    console.log('Iniciando o front em http://localhost:5173')
    children.push(startDev('pnpm', ['run', 'dev'], front))
  }

  if (children.length === 0) {
    console.log('Stack pronta. Migrations e seed foram aplicados de novo.')
    return
  }

  const shutdown = () => {
    for (const child of children) stopTree(child)
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  await new Promise((resolve, reject) => {
    for (const child of children) {
      child.on('error', reject)
      child.on('exit', (code) => {
        if (code && code !== 0) {
          shutdown()
          reject(new Error(`Processo de desenvolvimento saiu com código ${code}`))
        }
      })
    }
  })
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
