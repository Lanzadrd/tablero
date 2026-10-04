// API local de Tablero: lee y guarda el tablero en data/board.json.
// La usan tanto el servidor de producción (server/index.mjs) como Vite en desarrollo.
import { copyFile, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DATA_DIR = process.env.TABLERO_DATA_DIR
  ? path.resolve(process.env.TABLERO_DATA_DIR)
  : path.join(ROOT, 'data')
const BOARD_FILE = path.join(DATA_DIR, 'board.json')
const BACKUP_DIR = path.join(DATA_DIR, 'copias')
const KEEP_BACKUPS = 30
const MAX_BODY = 10 * 1024 * 1024
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

async function readStore() {
  let raw
  try {
    raw = await readFile(BOARD_FILE, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return { rev: 0, board: null }
    throw err
  }
  try {
    const data = JSON.parse(raw)
    return { rev: Number.isInteger(data.rev) ? data.rev : 0, board: data.board ?? null }
  } catch {
    // Nunca se sobrescribe un archivo que no se ha podido leer.
    throw new HttpError(500, `${BOARD_FILE} no es un JSON válido; no se ha modificado.`)
  }
}

const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Antes del primer guardado de cada día, copia el estado anterior a data/copias/. */
async function dailyBackup() {
  const target = path.join(BACKUP_DIR, `board-${localDay()}.json`)
  try {
    await mkdir(BACKUP_DIR, { recursive: true })
    await copyFile(BOARD_FILE, target, 1 /* COPYFILE_EXCL: no pisa la copia del día */)
  } catch (err) {
    if (err.code === 'EEXIST' || err.code === 'ENOENT') return
    throw err
  }
  const old = (await readdir(BACKUP_DIR)).filter((f) => /^board-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
  for (const file of old.slice(0, -KEEP_BACKUPS)) await unlink(path.join(BACKUP_DIR, file))
}

async function writeStore(rev, board) {
  await mkdir(DATA_DIR, { recursive: true })
  await dailyBackup()
  const tmp = `${BOARD_FILE}.tmp`
  const payload = { app: 'tablero', version: 1, rev, savedAt: new Date().toISOString(), board }
  await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  await rename(tmp, BOARD_FILE)
}

// Las escrituras van de una en una.
let queue = Promise.resolve()
function exclusive(fn) {
  const run = queue.then(fn)
  queue = run.catch(() => {})
  return run
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Demasiado grande'))
        req.destroy()
      } else chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new HttpError(400, 'JSON no válido'))
      }
    })
    req.on('error', reject)
  })
}

// ── Eventos en vivo (Server-Sent Events) para las ventanas abiertas y el ayudante de avisos ──

const clients = new Set()
let avisos = null

function broadcast(event, data) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const client of clients) client.res.write(message)
}

const avisosState = () => ({
  ...(avisos ?? {}),
  conectado: [...clients].some((c) => c.kind === 'avisos'),
})

async function openEvents(req, res, kind, version) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  })
  const { rev } = await readStore().catch(() => ({ rev: 0 }))
  res.write(`retry: 2000\nevent: hola\ndata: ${JSON.stringify({ rev, version })}\n\n`)
  const client = { res, kind }
  clients.add(client)
  if (kind === 'avisos') broadcast('avisos', avisosState())
  // Mantiene viva la conexión (y avisa pronto si se corta).
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000)
  req.on('close', () => {
    clearInterval(ping)
    clients.delete(client)
    if (kind === 'avisos') broadcast('avisos', avisosState())
  })
}

/** Cambia campos sueltos de una tarea sobre la versión guardada (lo usa el ayudante de avisos). */
async function patchTask(taskId, body) {
  const patch = {}
  if (typeof body?.done === 'boolean') {
    patch.done = body.done
    patch.completedAt = body.done ? (typeof body.completedAt === 'string' ? body.completedAt : new Date().toISOString()) : null
  }
  if (Object.keys(patch).length === 0) throw new HttpError(400, 'Nada que cambiar')
  return exclusive(async () => {
    const current = await readStore()
    const task = current.board?.columns?.flatMap((c) => c.tasks ?? []).find((t) => t.id === taskId)
    if (!task) throw new HttpError(404, 'Esa tarea ya no existe')
    Object.assign(task, patch)
    const rev = current.rev + 1
    await writeStore(rev, current.board)
    broadcast('rev', { rev })
    return { rev }
  })
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** Evita que otra web abierta en el navegador hable con la API (DNS rebinding). */
const isLocalHost = (req) => LOCAL_HOSTS.has((req.headers.host ?? '').replace(/:\d+$/, ''))

/** `version` identifica la compilación de la web: si cambia, las ventanas abiertas proponen recargar. */
export function createApi({ version = 'dev', appVersion = 'dev' } = {}) {
  return async function tableroApi(req, res, next) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const { pathname } = url
    if (!pathname.startsWith('/api/')) return next()
    try {
      if (!isLocalHost(req)) throw new HttpError(403, 'Solo accesible desde este ordenador')
      if (pathname === '/api/health') return send(res, 200, { app: 'tablero', ok: true, version, appVersion })
      if (pathname === '/api/eventos') return await openEvents(req, res, url.searchParams.get('cliente'), version)

      if (pathname === '/api/avisos') {
        if (req.method === 'GET') return send(res, 200, avisosState())
        if (req.method !== 'PUT') throw new HttpError(405, 'Método no permitido')
        avisos = { ...(await readJson(req)), vistoEn: new Date().toISOString() }
        broadcast('avisos', avisosState())
        return send(res, 200, { ok: true })
      }

      const taskMatch = pathname.match(/^\/api\/tareas\/([\w-]+)$/)
      if (taskMatch) {
        if (req.method !== 'PATCH') throw new HttpError(405, 'Método no permitido')
        return send(res, 200, await patchTask(taskMatch[1], await readJson(req)))
      }

      if (pathname !== '/api/board') throw new HttpError(404, 'No encontrado')

      if (req.method === 'GET') return send(res, 200, await readStore())
      if (req.method !== 'PUT') throw new HttpError(405, 'Método no permitido')

      const body = await readJson(req)
      if (!Number.isInteger(body?.baseRev) || !Array.isArray(body?.board?.columns)) {
        throw new HttpError(400, 'Tablero no válido')
      }
      await exclusive(async () => {
        const current = await readStore()
        // Otra ventana guardó antes: se devuelve lo que hay para que el cliente lo cargue.
        if (body.baseRev !== current.rev) return send(res, 409, current)
        const rev = current.rev + 1
        await writeStore(rev, body.board)
        send(res, 200, { rev })
        broadcast('rev', { rev })
      })
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500
      if (status >= 500) console.error('[tablero]', err)
      send(res, status, { error: err?.message ?? String(err) })
    }
  }
}
