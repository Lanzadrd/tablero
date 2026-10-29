// La API de verdad, en un puerto y una carpeta de datos temporales. «Abrir» no abre nada:
// solo anota qué se habría abierto.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, test } from 'node:test'

const dir = await mkdtemp(path.join(os.tmpdir(), 'tablero-api-'))
process.env.TABLERO_DATA_DIR = path.join(dir, 'datos')
const { createApi, subscriptionReminders } = await import('../api.mjs')
const { localDay } = await import('../almacen.mjs')

const project = path.join(dir, 'mi proyecto')
const opened = []
let server
let port

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

function fixture() {
  return {
    columns: [
      { id: 'p', name: 'Personal', color: 'blue', showCompleted: false, tasks: [task('p1')] },
      {
        id: 't',
        name: 'Trabajo',
        color: 'orange',
        showCompleted: false,
        project: { folder: project },
        tasks: [
          task('t1', { title: 'Arreglar login', notes: 'Falla con Safari' }),
          task('t2', { done: true, completedAt: '2026-10-02T10:00:00.000Z' }),
          task('t3', { done: true, completedAt: '2026-10-03T10:00:00.000Z' }),
          task('t4', { title: 'Larga', notes: 'ñ'.repeat(10_000) }),
        ],
      },
      { id: 'v', name: 'Viejo', color: 'brown', archived: true, showCompleted: false, tasks: [] },
      { id: 'h', name: 'Casa', color: 'green', showCompleted: false, project: { folder: '~' }, tasks: [task('h1', { done: true })] },
      { id: 'n', name: 'Nada', color: 'gray', showCompleted: false, project: { folder: path.join(dir, 'no-existe') }, tasks: [task('n1')] },
      { id: 'f', name: 'Fichero', color: 'gray', showCompleted: false, project: { folder: path.join(dir, 'fichero.txt') }, tasks: [] },
      { id: 'a', name: 'App', color: 'gray', showCompleted: false, project: { folder: path.join(dir, 'Algo.app') }, tasks: [] },
      { id: 'r', name: 'Relativa', color: 'gray', showCompleted: false, project: { folder: 'proyectos/x' }, tasks: [] },
    ],
  }
}

async function reset(board = fixture()) {
  await rm(process.env.TABLERO_DATA_DIR, { recursive: true, force: true })
  await mkdir(process.env.TABLERO_DATA_DIR, { recursive: true })
  await writeFile(path.join(process.env.TABLERO_DATA_DIR, 'board.json'), JSON.stringify({ app: 'tablero', version: 1, rev: 1, board }))
  opened.length = 0
}

const stored = async () => JSON.parse(await readFile(path.join(process.env.TABLERO_DATA_DIR, 'board.json'), 'utf8'))
const column = (data, id) => data.board.columns.find((c) => c.id === id)

/** Petición con control total de las cabeceras (Host, Origin…). */
function call(method, pathname, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: pathname,
        headers: { ...(payload !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json = null
          try {
            json = JSON.parse(text)
          } catch {}
          resolve({ status: res.statusCode, body: json })
        })
      },
    )
    req.on('error', reject)
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}
const post = (pathname, body, headers) => call('POST', pathname, { body, headers })

before(async () => {
  await mkdir(project, { recursive: true })
  await mkdir(path.join(dir, 'Algo.app'), { recursive: true })
  await writeFile(path.join(dir, 'fichero.txt'), 'x')
  const api = createApi({
    abrir: async (target) => {
      opened.push(target)
    },
  })
  server = http.createServer((req, res) => api(req, res, () => res.writeHead(404).end()))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = server.address().port
})

after(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(dir, { recursive: true, force: true })
})

beforeEach(() => reset())

// ── Archivo de completadas ──

test('archivar mueve las completadas a archivo.json, sube la revisión y avisa', async () => {
  const events = await listen()
  const r = await post('/api/archivar', { columnId: 't' })
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, { rev: 2, archivadas: 2 })
  const data = await stored()
  assert.equal(data.rev, 2)
  assert.deepEqual(column(data, 't').tasks.map((t) => t.id), ['t1', 't4'])
  const archivo = JSON.parse(await readFile(path.join(process.env.TABLERO_DATA_DIR, 'archivo.json'), 'utf8'))
  assert.deepEqual(archivo.tareas.map((t) => [t.id, t.columnId, t.columnName, t.done]), [
    ['t2', 't', 'Trabajo', true],
    ['t3', 't', 'Trabajo', true],
  ])
  assert.ok(archivo.tareas.every((t) => !Number.isNaN(Date.parse(t.archivedAt))))
  assert.match(await events.until(/event: rev\ndata: \{"rev":2\}/), /rev/)
  events.close()

  // Sin completadas: no se escribe nada.
  assert.deepEqual((await post('/api/archivar', { columnId: 't' })).body, { rev: 2, archivadas: 0 })
  assert.equal((await stored()).rev, 2)

  await post('/api/archivar', { columnId: 'h' })
  const todas = await call('GET', '/api/archivo')
  assert.deepEqual(todas.body.tareas.map((t) => t.id).sort(), ['h1', 't2', 't3'])
  assert.equal(todas.body.tareas[0].id, 'h1') // las últimas archivadas primero
  const deTrabajo = await call('GET', '/api/archivo?columna=t')
  assert.deepEqual(deTrabajo.body.tareas.map((t) => t.id).sort(), ['t2', 't3'])
})

test('archivar: columna que no existe o petición incompleta', async () => {
  assert.equal((await post('/api/archivar', { columnId: 'zzz' })).status, 404)
  assert.equal((await post('/api/archivar', {})).status, 400)
  assert.equal((await post('/api/archivar', 'null')).status, 400)
  assert.deepEqual((await call('GET', '/api/archivo')).body, { tareas: [] })
})

// ── Abrir la carpeta y Claude Code ──

test('abrir: la carpeta del tablero, nunca la de la petición', async () => {
  const r = await post('/api/abrir', { columnId: 't', folder: '/etc' })
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, { ok: true })
  assert.deepEqual(opened, [project])
  assert.equal((await post('/api/abrir', { columnId: 'h' })).status, 200)
  assert.equal(opened[1], os.homedir()) // «~»
})

test('abrir: errores claros', async () => {
  const casos = [
    ['p', 400, 'sin-carpeta'],
    ['n', 404, 'carpeta-no-existe'],
    ['f', 400, 'no-es-carpeta'],
    ['a', 400, 'no-es-carpeta'],
    ['r', 400, 'carpeta-no-valida'],
    ['zzz', 404, 'columna-no-existe'],
  ]
  for (const [columnId, status, error] of casos) {
    const r = await post('/api/abrir', { columnId })
    assert.equal(r.status, status, columnId)
    assert.equal(r.body.error, error, columnId)
    assert.ok(r.body.mensaje, columnId)
  }
  assert.deepEqual(opened, [])
})

test('claude: con tarea, título + notas + proyecto; con columna, sin texto', async () => {
  assert.equal((await post('/api/claude', { taskId: 't1' })).status, 200)
  const link = new URL(opened[0])
  assert.equal(link.protocol, 'claude:')
  assert.ok(opened[0].startsWith('claude://code/new?folder='))
  assert.equal(link.searchParams.get('folder'), project)
  assert.equal(link.searchParams.get('q'), 'Arreglar login\n\nFalla con Safari\n\nProyecto: Trabajo')
  // encodeURIComponent: espacios como %20, no «+».
  assert.ok(opened[0].includes(encodeURIComponent(project)))

  assert.equal((await post('/api/claude', { columnId: 't' })).status, 200)
  assert.equal(opened[1], `claude://code/new?folder=${encodeURIComponent(project)}`)

  await post('/api/claude', { taskId: 't4' })
  assert.equal(Array.from(new URL(opened[2]).searchParams.get('q')).length, 4000)
})

test('claude: sin carpeta → 400 sin-carpeta; y demás errores', async () => {
  let r = await post('/api/claude', { taskId: 'p1' })
  assert.deepEqual([r.status, r.body.error], [400, 'sin-carpeta'])
  r = await post('/api/claude', { columnId: 'p' })
  assert.deepEqual([r.status, r.body.error], [400, 'sin-carpeta'])
  r = await post('/api/claude', { taskId: 'n1' })
  assert.deepEqual([r.status, r.body.error], [404, 'carpeta-no-existe'])
  r = await post('/api/claude', { taskId: 'zzz' })
  assert.deepEqual([r.status, r.body.error], [404, 'tarea-no-existe'])
  assert.equal((await post('/api/claude', {})).status, 400)
  assert.deepEqual(opened, [])
})

// ── Captura ──

test('capturar con vista previa no guarda nada', async () => {
  const r = await post('/api/capturar', { texto: 'Llamar a Marta mañana 10:30 #Trabajo', vistaPrevia: true })
  assert.deepEqual(r.body, { titulo: 'Llamar a Marta', resumen: 'Mañana, 10:30 · Trabajo', columna: 'Trabajo' })
  const sinEtiqueta = await post('/api/capturar', { texto: 'Leer luego', vistaPrevia: true })
  assert.deepEqual(sinEtiqueta.body, { titulo: 'Leer luego', resumen: '', columna: 'Bandeja' })
  const data = await stored()
  assert.equal(data.rev, 1)
  assert.ok(!data.board.columns.some((c) => c.inbox))
})

test('capturar en la columna de la #etiqueta', async () => {
  const r = await post('/api/capturar', { texto: 'Llamar a Marta mañana 10:30 #trab', url: 'https://example.com/x' })
  assert.equal(r.status, 200)
  assert.equal(r.body.rev, 2)
  assert.equal(r.body.columna, 'Trabajo')
  assert.equal(r.body.columnId, 't')
  assert.equal(r.body.titulo, 'Llamar a Marta')
  assert.equal(r.body.resumen, 'Mañana, 10:30 · Trabajo')
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const created = column(await stored(), 't').tasks.find((t) => t.id === r.body.id)
  assert.deepEqual(
    { title: created.title, notes: created.notes, due: created.due, time: created.time, done: created.done },
    { title: 'Llamar a Marta', notes: 'https://example.com/x', due: localDay(tomorrow), time: '10:30', done: false },
  )
  // Detrás de la última pendiente.
  assert.deepEqual(column(await stored(), 't').tasks.map((t) => t.id), ['t1', 't2', 't3', 't4', r.body.id])
})

test('capturar sin etiqueta crea la Bandeja (la primera) y luego la reutiliza', async () => {
  const a = await post('/api/capturar', { texto: 'Regar plantas cada 3 días' })
  assert.equal(a.body.columna, 'Bandeja')
  let data = await stored()
  const bandeja = data.board.columns[0]
  assert.deepEqual(
    { name: bandeja.name, color: bandeja.color, inbox: bandeja.inbox, showCompleted: bandeja.showCompleted },
    { name: 'Bandeja', color: 'gray', inbox: true, showCompleted: false },
  )
  assert.deepEqual(bandeja.tasks[0].repeat, { every: 'day', interval: 3 })
  assert.equal(bandeja.tasks[0].due, localDay())

  const b = await post('/api/capturar', { texto: 'Leer Sapiens algún día', notas: 'Me lo recomendó Ana' })
  data = await stored()
  assert.equal(data.board.columns.filter((c) => c.inbox).length, 1)
  assert.equal(b.body.columnId, bandeja.id)
  const leer = data.board.columns[0].tasks[1]
  assert.deepEqual({ title: leer.title, someday: leer.someday, due: leer.due, notes: leer.notes }, {
    title: 'Leer Sapiens',
    someday: true,
    due: null,
    notes: 'Me lo recomendó Ana',
  })
  assert.equal(data.rev, 3)
})

test('capturar una página: sin texto, su título; con solo indicaciones, también', async () => {
  const a = await post('/api/capturar', { url: 'https://example.com/a', tituloPagina: 'Un artículo' })
  assert.equal(a.body.titulo, 'Un artículo')
  const b = await post('/api/capturar', { texto: '#trabajo mañana', url: 'https://example.com/b', tituloPagina: 'Otro artículo' })
  assert.equal(b.body.titulo, 'Otro artículo')
  assert.equal(b.body.columna, 'Trabajo')
  const c = await post('/api/capturar', { url: 'https://example.com/c' })
  assert.equal(c.body.titulo, 'https://example.com/c')
  // Una columna archivada no vale como etiqueta.
  const d = await post('/api/capturar', { texto: 'Algo #viejo' })
  assert.deepEqual([d.body.titulo, d.body.columna], ['Algo #viejo', 'Bandeja'])
})

test('capturar: sin texto, 400; sin tablero, 409', async () => {
  assert.equal((await post('/api/capturar', { texto: '  ' })).status, 400)
  await rm(path.join(process.env.TABLERO_DATA_DIR, 'board.json'))
  assert.equal((await post('/api/capturar', { texto: 'Hola' })).status, 409)
  assert.equal((await post('/api/capturar', { texto: 'Hola', vistaPrevia: true })).body.columna, 'Bandeja')
})

// ── Operaciones del ayudante ──

test('operaciones: #columna y repetición también por HTTP', async () => {
  const r = await post('/api/operaciones', {
    ops: [
      { op: 'crearTarea', id: 'siri-1', columna: 'p', tarea: { title: 'Comprar bombillas #casa' } },
      { op: 'actualizarTarea', id: 'p1', cambios: { title: 'Informe #trabajo' } },
    ],
  })
  assert.deepEqual(r.body, { rev: 2, aplicadas: 2 })
  const data = await stored()
  assert.equal(column(data, 'h').tasks[0].title, 'Comprar bombillas')
  assert.ok(column(data, 't').tasks.some((t) => t.id === 'p1' && t.title === 'Informe'))
})

test('PATCH /api/tareas/:id completa una que se repite y crea la siguiente', async () => {
  const board = fixture()
  board.columns[0].tasks[0].repeat = { every: 'day' }
  board.columns[0].tasks[0].due = localDay()
  await reset(board)
  const r = await call('PATCH', '/api/tareas/p1', { body: { done: true } })
  assert.deepEqual(r.body, { rev: 2 })
  const tasks = column(await stored(), 'p').tasks
  assert.equal(tasks.length, 2)
  assert.equal(tasks[0].done, true)
  assert.equal(tasks[0].repeat, undefined)
  assert.equal(tasks[1].done, false)
  assert.deepEqual(tasks[1].repeat, { every: 'day' })
  assert.equal((await call('PATCH', '/api/tareas/zzz', { body: { done: true } })).status, 404)
})

// ── Avisos de las suscripciones ──

test('avisos de suscripciones: crea la tarea en la Bandeja una sola vez, y solo entonces guarda', async () => {
  const board = fixture()
  board.columns.unshift({ id: 'bandeja', name: 'Bandeja', color: 'gray', inbox: true, showCompleted: false, tasks: [task('b1')] })
  board.cards = [{ id: 'bbva', name: 'BBVA', color: 'blue' }]
  board.subscriptions = [
    {
      id: 'netflix',
      name: 'Netflix',
      amount: 1299,
      currency: 'EUR',
      period: 'month',
      billingDate: '2026-09-15',
      cardId: 'bbva',
      remind: 1,
      createdAt: '2026-09-01T10:00:00.000Z',
    },
  ]
  await reset(board)

  // Aún pronto: nada (y no se escribe).
  assert.deepEqual(await subscriptionReminders({ today: '2026-10-11' }), { rev: 1, creadas: 0 })
  assert.equal((await stored()).rev, 1)

  const events = await listen()
  let n = 0
  const r = await subscriptionReminders({ today: '2026-10-12', newId: () => `aviso-${++n}` })
  assert.deepEqual(r, { rev: 2, creadas: 1 })
  assert.match(await events.until(/event: rev\ndata: \{"rev":2\}/), /rev/)
  events.close()
  const data = await stored()
  assert.equal(data.rev, 2)
  const bandeja = column(data, 'bandeja')
  assert.deepEqual(bandeja.tasks.map((t) => t.id), ['b1', 'aviso-1'])
  assert.equal(bandeja.tasks[1].title.replace(/\s/g, ' '), 'Netflix se cobra el 15 oct · 12,99 € · BBVA')
  assert.equal(bandeja.tasks[1].due, '2026-10-14')
  assert.equal(bandeja.tasks[1].subscriptionId, 'netflix')
  assert.equal(data.board.subscriptions[0].remindedFor, '2026-10-15')

  // Otra vez (el siguiente cuarto de hora, o al reiniciar): nada.
  assert.deepEqual(await subscriptionReminders({ today: '2026-10-12', newId: () => 'otra' }), { rev: 2, creadas: 0 })
  assert.deepEqual(await subscriptionReminders({ today: '2026-10-13', newId: () => 'otra' }), { rev: 2, creadas: 0 })
  assert.equal((await stored()).rev, 2)
  assert.equal(column(await stored(), 'bandeja').tasks.length, 2)
})

test('guardar: una ventana con la web de antes no borra las tarjetas ni las suscripciones', async () => {
  const board = fixture()
  board.cards = [{ id: 'bbva', name: 'BBVA', color: 'blue' }]
  board.subscriptions = [{ id: 'netflix', name: 'Netflix', amount: 1299, currency: 'EUR', period: 'month', billingDate: '2026-09-15', cardId: 'bbva', createdAt: 'x' }]
  await reset(board)
  // La web de antes no las conoce: guarda el tablero sin ellas.
  const viejo = { columns: fixture().columns }
  viejo.columns[0].tasks[0].done = true
  assert.equal((await call('PUT', '/api/board', { body: { baseRev: 1, board: viejo } })).status, 200)
  const data = await stored()
  assert.equal(data.rev, 2)
  assert.equal(column(data, 'p').tasks[0].done, true)
  assert.deepEqual(data.board.cards, board.cards)
  assert.deepEqual(data.board.subscriptions, board.subscriptions)
  // La de ahora siempre las manda: si las vacía, se vacían.
  assert.equal((await call('PUT', '/api/board', { body: { baseRev: 2, board: { ...data.board, cards: [], subscriptions: [] } } })).status, 200)
  const vacio = await stored()
  assert.deepEqual([vacio.board.cards, vacio.board.subscriptions], [[], []])
  // Y una revisión vieja sigue siendo un 409.
  assert.equal((await call('PUT', '/api/board', { body: { baseRev: 1, board: viejo } })).status, 409)
})

test('avisos de suscripciones: sin tablero o sin suscripciones, nada', async () => {
  assert.deepEqual(await subscriptionReminders({ today: '2026-10-12' }), { rev: 1, creadas: 0 })
  assert.equal((await stored()).rev, 1)
  await rm(path.join(process.env.TABLERO_DATA_DIR, 'board.json'))
  assert.deepEqual(await subscriptionReminders(), { rev: 0, creadas: 0 })
})

// ── Título de enlaces ──

test('titulo: valida el enlace y no llama a direcciones locales', async () => {
  let r = await call('GET', '/api/titulo')
  assert.deepEqual([r.status, r.body.error], [400, 'url-no-valida'])
  r = await call('GET', `/api/titulo?url=${encodeURIComponent('ftp://example.com/')}`)
  assert.deepEqual([r.status, r.body.error], [400, 'url-no-valida'])
  for (const target of [`http://127.0.0.1:${port}/api/board`, `http://localhost:${port}/api/board`, 'http://169.254.169.254/', 'http://[::1]/']) {
    r = await call('GET', `/api/titulo?url=${encodeURIComponent(target)}`)
    assert.deepEqual([r.status, r.body.error], [403, 'direccion-no-permitida'], target)
  }
  assert.equal((await post('/api/titulo', {})).status, 405)
})

// ── Solo la propia app ──

test('checkCaller protege los endpoints nuevos', async () => {
  const endpoints = [
    ['GET', `/api/titulo?url=${encodeURIComponent('https://example.com/')}`],
    ['GET', '/api/archivo'],
    ['POST', '/api/archivar', { columnId: 't' }],
    ['POST', '/api/abrir', { columnId: 't' }],
    ['POST', '/api/claude', { taskId: 't1' }],
    ['POST', '/api/capturar', { texto: 'Intruso' }],
  ]
  const ajenas = [
    { origin: 'https://malo.example' },
    { origin: 'null' },
    { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'same-site' },
    { host: 'malo.example' },
    { host: `malo.example:${port}` },
  ]
  for (const [method, pathname, body] of endpoints) {
    for (const headers of ajenas) {
      const r = await call(method, pathname, { body, headers })
      assert.equal(r.status, 403, `${method} ${pathname} ${JSON.stringify(headers)}`)
    }
    if (method === 'POST') {
      // Un formulario de otra web no puede mandar JSON.
      const r = await call(method, pathname, { body: JSON.stringify(body), headers: { 'content-type': 'text/plain' } })
      assert.equal(r.status, 415, pathname)
    }
  }
  assert.deepEqual(opened, [])
  assert.equal((await stored()).rev, 1)
  // La propia app sí.
  const propia = await post('/api/archivar', { columnId: 't' }, { origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' })
  assert.equal(propia.status, 200)
})

/** Escucha /api/eventos hasta ver un texto. */
function listen() {
  return new Promise((resolve, reject) => {
    let text = ''
    const waiting = []
    const req = http.get({ host: '127.0.0.1', port, path: '/api/eventos' }, (res) => {
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        text += chunk
        for (const w of waiting) if (w.re.test(text)) w.resolve(text)
      })
      // Esperar al saludo inicial para no perder eventos.
      const ready = () => (text.includes('event: hola') ? resolve(api) : setTimeout(ready, 10))
      ready()
    })
    req.on('error', reject)
    const api = {
      until: (re) =>
        new Promise((ok, fail) => {
          if (re.test(text)) return ok(text)
          waiting.push({ re, resolve: ok })
          setTimeout(() => fail(new Error(`No llegó ${re}: ${text}`)), 2000).unref()
        }),
      close: () => req.destroy(),
    }
  })
}
