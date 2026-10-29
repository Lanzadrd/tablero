// El MCP como lo usa Claude Code: un proceso al que se le mandan líneas JSON-RPC, que
// habla con un servidor de Tablero de verdad (puerto y carpeta de datos temporales).
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import http from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { after, before, test } from 'node:test'
import { localDay } from '../almacen.mjs'

const SERVER = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const ROOT = path.dirname(SERVER)
const today = localDay()
/** `n` días después de hoy, 'AAAA-MM-DD'. */
const inDays = (n) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return localDay(d)
}

let dir
let port
let tablero
let mcp

const task = (id, extra = {}) => ({
  id,
  title: id,
  notes: '',
  done: false,
  createdAt: '2026-10-01T08:00:00.000Z',
  completedAt: null,
  due: null,
  time: null,
  ...extra,
})

function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

async function waitForHealth() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`)
      if (res.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('El servidor de pruebas no arranca')
}

/** Un proceso MCP con el que hablar por líneas. */
function startMcp(env) {
  const child = spawn(process.execPath, [path.join(SERVER, 'mcp.mjs')], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] })
  const lines = []
  const waiting = []
  createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line)
    const i = waiting.findIndex((w) => w.match(msg))
    if (i >= 0) waiting.splice(i, 1)[0].resolve(msg)
    else lines.push(msg)
  })
  let nextId = 1
  const next = (match) =>
    new Promise((resolve, reject) => {
      const i = lines.findIndex(match)
      if (i >= 0) return resolve(lines.splice(i, 1)[0])
      waiting.push({ match, resolve })
      setTimeout(() => reject(new Error('Sin respuesta del MCP')), 5000).unref()
    })
  return {
    child,
    lines,
    send: (msg) => child.stdin.write(`${typeof msg === 'string' ? msg : JSON.stringify(msg)}\n`),
    request(method, params) {
      const id = nextId++
      this.send({ jsonrpc: '2.0', id, method, params })
      return next((m) => m.id === id)
    },
    next,
    async tool(name, args) {
      const r = await this.request('tools/call', { name, arguments: args })
      return r.result
    },
    stop: () => child.kill(),
  }
}

before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'tablero-mcp-'))
  port = await freePort()
  const board = {
    columns: [
      {
        id: 'p',
        name: 'Personal',
        color: 'blue',
        showCompleted: false,
        tasks: [
          task('p-hoy', { title: 'Pagar la luz', due: today, time: '09:00', notes: 'Con la tarjeta' }),
          task('p-futura', { title: 'Renovar DNI', due: '2099-01-01' }),
          task('p-hecha', { title: 'Canción del verano', done: true, completedAt: '2026-10-01T10:00:00.000Z' }),
          task('p-repite', { title: 'Regar plantas', due: today, repeat: { every: 'day', interval: 2 } }),
        ],
      },
      { id: 't', name: 'Trabajo', color: 'orange', showCompleted: false, tasks: [task('t-1', { title: 'Revisar PR de login' })] },
      { id: 'v', name: 'Viejo', color: 'brown', archived: true, showCompleted: false, tasks: [task('v-1', { title: 'Cancion antigua' })] },
    ],
    cards: [
      { id: 'bbva', name: 'BBVA', color: 'blue' },
      { id: 'revolut', name: 'Revolut', color: 'purple' },
    ],
    subscriptions: [
      { id: 'netflix', name: 'Netflix', amount: 1299, currency: 'EUR', period: 'month', billingDate: inDays(8), cardId: 'bbva', columnId: 'p', remind: 1, notes: 'Plan estándar', createdAt: '2026-09-01T10:00:00.000Z' },
      { id: 'icloud', name: 'iCloud+', amount: 299, currency: 'EUR', period: 'month', billingDate: inDays(1), cardId: 'revolut', columnId: 't', createdAt: '2026-09-01T10:00:00.000Z' },
      { id: 'chatgpt', name: 'ChatGPT', amount: 24000, currency: 'USD', period: 'year', billingDate: today, cardId: null, createdAt: '2026-09-01T10:00:00.000Z' },
      { id: 'spotify', name: 'Spotify', amount: 1099, currency: 'EUR', period: 'month', billingDate: inDays(-40), cardId: 'bbva', columnId: 'p', cancelledOn: inDays(-7), createdAt: '2026-01-01T10:00:00.000Z' },
      { id: 'github', name: 'GitHub', amount: 400, currency: 'USD', period: 'month', billingDate: inDays(20), cardId: 'revolut', columnId: 'p', createdAt: '2026-09-01T10:00:00.000Z' },
    ],
  }
  await writeFile(path.join(dir, 'board.json'), JSON.stringify({ app: 'tablero', version: 1, rev: 1, board }))
  tablero = spawn(process.execPath, [path.join(SERVER, 'index.mjs')], {
    cwd: ROOT,
    env: {
      ...process.env,
      TABLERO_DATA_DIR: dir,
      PORT: String(port),
      TABLERO_SIN_ACTUALIZAR: '1',
      TABLERO_SIMULAR_ABRIR: '1',
      TABLERO_SIN_AVISOS_SUSCRIPCIONES: '1', // que el aviso de Netflix no cambie el tablero a mitad de las pruebas
    },
    stdio: 'ignore',
  })
  await waitForHealth()
  mcp = startMcp({ TABLERO_PORT: String(port), PORT: '1' }) // PORT de otro proyecto: no se usa
})

after(async () => {
  mcp?.stop()
  tablero?.kill()
  await rm(dir, { recursive: true, force: true })
})

const board = async () => JSON.parse(await readFile(path.join(dir, 'board.json'), 'utf8')).board
const text = (result) => result.content.map((c) => c.text).join('\n')
/** Intl separa la cifra y el símbolo con un espacio duro: aquí, uno normal. */
const plain = (s) => s.replace(/[\u00a0\u202f]/g, ' ')

test('initialize: la versión del cliente si se conoce; si no, 2025-06-18', async () => {
  const r = await mcp.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'prueba', version: '1' } })
  assert.equal(r.jsonrpc, '2.0')
  assert.equal(r.result.protocolVersion, '2025-03-26')
  assert.equal(r.result.serverInfo.name, 'tablero')
  assert.ok(r.result.capabilities.tools)
  const otra = await mcp.request('initialize', { protocolVersion: '1999-01-01', capabilities: {} })
  assert.equal(otra.result.protocolVersion, '2025-06-18')
})

test('las notificaciones no tienen respuesta; ping sí', async () => {
  mcp.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  const pong = await mcp.request('ping')
  assert.deepEqual(pong.result, {})
  assert.deepEqual(mcp.lines, [])
})

test('tools/list', async () => {
  const r = await mcp.request('tools/list', {})
  const names = r.result.tools.map((t) => t.name)
  assert.deepEqual(names, ['tablero_listar', 'tablero_anadir', 'tablero_completar', 'tablero_buscar', 'tablero_suscripciones'])
  assert.equal(r.result.tools.find((t) => t.name === 'tablero_suscripciones').annotations.readOnlyHint, true)
  for (const tool of r.result.tools) {
    assert.equal(tool.inputSchema.type, 'object')
    assert.ok(tool.description)
  }
})

test('tablero_listar: pendientes, hoy, todo y por columna', async () => {
  const pendientes = text(await mcp.tool('tablero_listar', {}))
  assert.match(pendientes, /## Personal · 3 tareas/)
  assert.match(pendientes, /- \[ \] Pagar la luz — Hoy, 09:00 · id: p-hoy/)
  assert.match(pendientes, /Notas: Con la tarjeta/)
  assert.match(pendientes, /Revisar PR de login · id: t-1/)
  assert.doesNotMatch(pendientes, /Canción del verano|Cancion antigua/) // completada y columna archivada

  const hoy = text(await mcp.tool('tablero_listar', { filtro: 'hoy' }))
  assert.match(hoy, /Pagar la luz/)
  assert.match(hoy, /Regar plantas — Hoy · cada 2 días/)
  assert.doesNotMatch(hoy, /Renovar DNI|Trabajo/)

  const todo = text(await mcp.tool('tablero_listar', { filtro: 'todo', columna: 'perso' }))
  assert.match(todo, /- \[x\] Canción del verano/)
  assert.doesNotMatch(todo, /Trabajo/)

  const mal = await mcp.tool('tablero_listar', { columna: 'nada de nada' })
  assert.equal(mal.isError, true)
  assert.match(text(mal), /Columnas: Personal, Trabajo/)
  assert.equal((await mcp.tool('tablero_listar', { filtro: 'raro' })).isError, true)
})

test('tablero_anadir: lenguaje natural y #columna, por /api/capturar', async () => {
  const r = await mcp.tool('tablero_anadir', { texto: 'Llamar a Marta mañana 10:30 #Trabajo', notas: 'Tel. 600 000 000' })
  assert.equal(r.isError, undefined)
  const id = /id: ([\w-]+)/.exec(text(r))[1]
  assert.match(text(r), /Añadida «Llamar a Marta» en Trabajo \(Mañana, 10:30 · Trabajo\)/)
  const created = (await board()).columns.find((c) => c.id === 't').tasks.find((t) => t.id === id)
  assert.equal(created.title, 'Llamar a Marta')
  assert.equal(created.notes, 'Tel. 600 000 000')
  assert.equal(created.time, '10:30')

  const bandeja = await mcp.tool('tablero_anadir', { texto: 'Idea suelta' })
  assert.match(text(bandeja), /en Bandeja/)
  assert.equal((await mcp.tool('tablero_anadir', { texto: '' })).isError, true)
})

test('tablero_buscar: sin acentos ni mayúsculas, también completadas y archivadas', async () => {
  const r = text(await mcp.tool('tablero_buscar', { consulta: 'CANCION' }))
  assert.match(r, /2 resultados/)
  assert.match(r, /Canción del verano · id: p-hecha/)
  assert.match(r, /Cancion antigua .*\n  Columna: Viejo \(archivada\)/)
  assert.match(text(await mcp.tool('tablero_buscar', { consulta: 'tarjeta luz' })), /Pagar la luz/) // también en notas
  assert.match(text(await mcp.tool('tablero_buscar', { consulta: 'zzz' })), /No hay tareas/)
})

test('tablero_completar: por id o su principio; si se repite, avisa de la siguiente', async () => {
  const r = await mcp.tool('tablero_completar', { id: 't-1' })
  assert.match(text(r), /Completada «Revisar PR de login» \(Trabajo\)/)
  assert.equal((await board()).columns.find((c) => c.id === 't').tasks.find((t) => t.id === 't-1').done, true)
  assert.match(text(await mcp.tool('tablero_completar', { id: 't-1' })), /ya estaba completada/)

  const repite = text(await mcp.tool('tablero_completar', { id: 'p-rep' }))
  assert.match(repite, /Completada «Regar plantas»/)
  assert.match(repite, /Se repite: la siguiente es para .+ \(id: [0-9a-f-]{36}\)/)
  const personal = (await board()).columns.find((c) => c.id === 'p').tasks
  const i = personal.findIndex((t) => t.id === 'p-repite')
  assert.equal(personal[i + 1].title, 'Regar plantas')
  assert.equal(personal[i + 1].done, false)

  const ambiguo = await mcp.tool('tablero_completar', { id: 'p-' })
  assert.equal(ambiguo.isError, true)
  const nada = await mcp.tool('tablero_completar', { id: 'no-existe' })
  assert.equal(nada.isError, true)
  assert.match(text(nada), /No hay ninguna tarea/)
})

test('tablero_suscripciones: por próximo cobro, con tarjeta, columna y aviso, y los totales por moneda y por columna', async () => {
  const all = plain(text(await mcp.tool('tablero_suscripciones', {})))
  assert.match(all, new RegExp(`^Suscripciones activas — hoy es ${today}`))
  const [list, byColumn] = all.split('\nPor columna:\n')
  const lines = list.split('\n').filter((l) => l.startsWith('- '))
  assert.deepEqual(lines.map((l) => /^- ([^:]+):/.exec(l)[1]), ['ChatGPT', 'iCloud+', 'Netflix', 'GitHub'])
  assert.equal(lines[0], '- ChatGPT: 240,00 $ / año (≈ 20,00 $ / mes) · próximo cobro Hoy · sin tarjeta · sin columna · id: chatgpt')
  assert.equal(lines[1], '- iCloud+: 2,99 € / mes · próximo cobro Mañana · Revolut · columna Trabajo · id: icloud')
  assert.match(lines[2], /^- Netflix: 12,99 € \/ mes · próximo cobro \S+, \d+ \S+ \(en 8 días\) · BBVA · columna Personal · aviso 1 día antes · id: netflix$/)
  assert.match(all, /\n  Notas: Plan estándar/)
  assert.match(list, /Total: 15,98 € al mes · 191,76 € al año \(2 activas\)/)
  assert.match(list, /Total: 24,00 \$ al mes · 288,00 \$ al año \(2 activas\)/)
  assert.doesNotMatch(all, /Spotify|Dadas de baja/)
  // Por columna, en el orden del tablero y «Sin columna» al final; nunca se suman monedas distintas.
  assert.deepEqual(byColumn.trim().split('\n'), [
    '- Personal: 12,99 € al mes · 155,88 € al año (1 activa); 4,00 $ al mes · 48,00 $ al año (1 activa)',
    '- Trabajo: 2,99 € al mes · 35,88 € al año (1 activa)',
    '- Sin columna: 20,00 $ al mes · 240,00 $ al año (1 activa)',
  ])
})

test('tablero_suscripciones: por columna (sin acentos ni mayúsculas), sin columna y con tarjeta a la vez', async () => {
  const personal = plain(text(await mcp.tool('tablero_suscripciones', { columna: 'personal' })))
  assert.match(personal, /^Suscripciones activas en Personal — hoy es/)
  assert.deepEqual(personal.split('\n').filter((l) => l.startsWith('- ')).map((l) => /^- ([^:]+):/.exec(l)[1]), ['Netflix', 'GitHub'])
  assert.match(personal, /Total: 12,99 € al mes · 155,88 € al año \(1 activa\)\nTotal: 4,00 \$ al mes · 48,00 \$ al año \(1 activa\)$/)
  assert.doesNotMatch(personal, /Por columna/)

  const sin = plain(text(await mcp.tool('tablero_suscripciones', { columna: 'Sin columna' })))
  assert.match(sin, /^Suscripciones activas sin columna/)
  assert.match(sin, /- ChatGPT:/)
  assert.doesNotMatch(sin, /Netflix|iCloud|GitHub/)

  const ambos = plain(text(await mcp.tool('tablero_suscripciones', { columna: 'trabajó', tarjeta: 'revolut' })))
  assert.match(ambos, /^Suscripciones activas en Trabajo con Revolut/)
  assert.deepEqual(ambos.split('\n').filter((l) => l.startsWith('- ')).map((l) => /^- ([^:]+):/.exec(l)[1]), ['iCloud+'])

  const bajas = plain(text(await mcp.tool('tablero_suscripciones', { columna: 'Personal', tarjeta: 'BBVA', incluirBajas: true })))
  assert.match(bajas, /Dadas de baja:\n- Spotify:/)
  assert.equal(plain(text(await mcp.tool('tablero_suscripciones', { columna: 'Viejo' }))), 'No hay suscripciones activas en Viejo.')

  const mal = await mcp.tool('tablero_suscripciones', { columna: 'LTO' })
  assert.equal(mal.isError, true)
  assert.match(text(mal), /No hay ninguna columna «LTO»\. Columnas: Personal, Trabajo\./)
})

test('tablero_suscripciones: por tarjeta (sin acentos ni mayúsculas), sin tarjeta y con las bajas', async () => {
  const bbva = plain(text(await mcp.tool('tablero_suscripciones', { tarjeta: 'bbvá' })))
  assert.match(bbva, /^Suscripciones activas con BBVA/)
  assert.match(bbva, /- Netflix:/)
  assert.doesNotMatch(bbva, /iCloud|ChatGPT|GitHub|\$/)
  assert.match(bbva, /Total: 12,99 € al mes · 155,88 € al año \(1 activa\)/)

  const sin = plain(text(await mcp.tool('tablero_suscripciones', { tarjeta: 'Sin tarjeta' })))
  assert.match(sin, /- ChatGPT:/)
  assert.doesNotMatch(sin, /Netflix|iCloud/)

  const bajas = plain(text(await mcp.tool('tablero_suscripciones', { tarjeta: 'BBVA', incluirBajas: true })))
  assert.match(bajas, /Dadas de baja:\n- Spotify: 10,99 € \/ mes · baja desde el \d+ [a-z]+( \d{4})? · id: spotify/)

  const mal = await mcp.tool('tablero_suscripciones', { tarjeta: 'Visa' })
  assert.equal(mal.isError, true)
  assert.match(text(mal), /No hay ninguna tarjeta «Visa»\. Tarjetas: BBVA, Revolut\./)
})

test('errores de protocolo', async () => {
  const desconocida = await mcp.request('tools/call', { name: 'borrar_todo', arguments: {} })
  assert.equal(desconocida.error.code, -32602)
  const metodo = await mcp.request('resources/list', {})
  assert.equal(metodo.error.code, -32601)
  mcp.send('{esto no es json')
  const roto = await mcp.next((m) => m.id === null)
  assert.equal(roto.error.code, -32700)
})

test('si Tablero no está en marcha, la herramienta lo dice (isError)', async () => {
  const solo = startMcp({ TABLERO_PORT: String(await freePort()) })
  try {
    const r = await solo.tool('tablero_listar', {})
    assert.equal(r.isError, true)
    assert.match(text(r), /Tablero no responde/)
  } finally {
    solo.stop()
  }
})

test('si en ese puerto hay otro servidor, no le manda ni le lee tareas', async () => {
  const seen = []
  const otro = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, board: { columns: [] } }))
  })
  await new Promise((resolve) => otro.listen(0, '127.0.0.1', resolve))
  const solo = startMcp({ TABLERO_PORT: String(otro.address().port) })
  try {
    const r = await solo.tool('tablero_anadir', { texto: 'Secreto' })
    assert.equal(r.isError, true)
    assert.match(text(r), /no responde Tablero/)
    assert.deepEqual(seen, ['GET /api/health'])
  } finally {
    solo.stop()
    otro.closeAllConnections()
    await new Promise((resolve) => otro.close(resolve))
  }
})

test('atiende los mensajes en orden: una búsqueda justo detrás de un alta ya la ve', async () => {
  const id1 = 9001
  mcp.send({ jsonrpc: '2.0', id: id1, method: 'tools/call', params: { name: 'tablero_anadir', arguments: { texto: 'Orden de llegada zz9' } } })
  mcp.send({ jsonrpc: '2.0', id: id1 + 1, method: 'tools/call', params: { name: 'tablero_buscar', arguments: { consulta: 'zz9' } } })
  const busqueda = await mcp.next((m) => m.id === id1 + 1)
  assert.match(text(busqueda.result), /Orden de llegada zz9/)
  await mcp.next((m) => m.id === id1)
})

test('npm run mcp imprime la configuración de la app instalada', async () => {
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'mcp.mjs')], { stdio: ['ignore', 'pipe', 'inherit'] })
  let out = ''
  child.stdout.on('data', (c) => (out += c))
  await new Promise((resolve) => child.on('close', resolve))
  const app = path.join(os.homedir(), 'Library', 'Application Support', 'Tablero', 'app')
  assert.match(out, /claude mcp add --scope user tablero -- /)
  assert.ok(out.includes(`"command": ${JSON.stringify(path.join(app, 'bin', 'node'))}`))
  assert.ok(out.includes(JSON.stringify(path.join(app, 'server', 'mcp.mjs'))))
})
